# RedGifs Downloader — Electron + React Rewrite (Design Spec)

**Date:** 2026-07-02
**Status:** Approved (design)
**Supersedes:** Go/Wails v3 implementation (kept in repo root as reference until parity)

## 1. Problem & Motivation

The Go/Wails app's login never worked. Root cause: RedGifs authenticates via **Kinde OAuth**, which only redirects to a fixed allowlist of callback URLs registered to RedGifs' own Kinde application (client `e06c34dac7654821bcb37e0393b54350`). The Wails design served the RedGifs SPA through a local reverse proxy on `http://localhost:<port>`, so the SPA asked Kinde to redirect to that localhost URL and Kinde rejected it ("Invalid callback URL"). No localhost port can ever be in RedGifs' allowlist, so proxy-based token capture is architecturally impossible.

**Electron solves this:** it ships real Chromium, so login happens on the genuine `redgifs.com` origin (Kinde callback valid). The main process captures the resulting bearer token directly from the login session. Leaving Go also removes the no-CGO cross-compile constraint that shaped the old stack.

## 2. Goals & Non-Goals

**Goal:** full feature parity with the Go app — public browse/search, per-user downloads, likes, private collections, settings, download history, statistics, concurrency + adaptive rate limiting — as an Electron + React + TypeScript desktop app with working in-app login.

**Built MVP-first:** ship a working vertical slice (browse + download) before layering the rest.

**Non-goals (this spec):** mobile/React-Native targets; auto-update infrastructure; multi-account; a pixel-level visual redesign (a dedicated `frontend-design` pass comes in Phase 3).

## 3. Architecture

Electron three-layer split:

- **main** (Node/TypeScript) — all business logic. Modules:
  - `index.ts` — app + window lifecycle, wiring.
  - `storage.ts` — `Storage` interface + `SqliteStorage` (better-sqlite3).
  - `api.ts` — `RedgifsApi` HTTP client.
  - `auth.ts` — `AuthManager` login window + token capture.
  - `ratelimit.ts` — `RateLimiter` (spacing + 429 backoff; absorbs the old circuit-breaker role).
  - `downloader.ts` — `Downloader` task engine.
  - `ipc.ts` — registers `ipcMain.handle` per channel; pushes events.
- **preload** (`preload/index.ts`) — `contextBridge` exposes typed `window.api` (no `nodeIntegration`, `contextIsolation` on).
- **renderer** (React/TS/Vite) — UI only; talks to main exclusively through `window.api`.
- **shared** — `types.ts` (domain types) and `ipc.ts` (channel constants + `RedgifsApi` interface) imported by all three layers.

Build: `electron-vite` (separate main/preload/renderer bundles). `@electron/rebuild` compiles the `better-sqlite3` native module against Electron's ABI.

## 4. Authentication (login capture)

`AuthManager.login()`:
1. Opens a `BrowserWindow` with `partition: 'persist:redgifs'` loading real `https://www.redgifs.com/`.
2. Registers `session.webRequest.onBeforeSendHeaders({ urls: ['*://api.redgifs.com/*'] })`. For each request it reads the `Authorization` header, extracts `Bearer <jwt>`, base64url-decodes the payload, and **accepts the token only if `sub` does not start with `client/`** (i.e. a real user, not an anonymous temp token).
3. Fallback: on `did-finish-load` and on a short interval, `executeJavaScript` scans `localStorage` for a `eyJ…` JWT passing the same user-token test.
4. On capture: persist token (storage), set it on `RedgifsApi`, emit `auth:changed`, close the window, resolve `AuthStatus`.
5. If the user closes the window without a captured token: resolve `{ authenticated: false }`.

The `persist:redgifs` partition keeps RedGifs cookies, so subsequent logins are fast. `logout()` clears the stored token and the partition's storage data. `authStatus()` reports `authenticated` from token presence; the renderer may additionally call `getProfile()` (`/me`) to confirm and show the username.

**User-token detection is shared logic** (`isUserToken(jwt)`), unit-tested, used by both header sniff and localStorage scan.

## 5. API Client

`fetch`-based (`RedgifsApi`), base `https://api.redgifs.com/v2`.

- **Tokens:** returns the captured user token when logged in; otherwise fetches and caches an anonymous temp token from `GET /auth/temporary` (with expiry). `IsAuthenticated` = a real *user* token is present (temp tokens don't count — matches the fix already made in Go).
- **Endpoints:** `GET /users/search`, `GET /users/{u}/search`, `GET /me`, `GET /feeds/liked`, `GET /users/{u}/collections`, `GET /me/collections`, `GET /me/collections/{id}/gifs`, `GET /gifs/{id}`.
- **Response handling:** 200 → parse; 401 (authed) → drop token, retry once; 429 → `RateLimiter.note429(delay)` then retry; 404 → typed not-found; other → error. All requests pass through `RateLimiter.wait()` first.
- **Conversion:** raw API gif → shared `Content` (unit-tested).

## 6. Downloader

`Downloader` holds a `Map<id, DownloadTask>`.

- `startDownload(request)`: resolve the content list for the type — `user` (iterate `settings.searchOrders`, dedupe), `collection` (`/me/collections/{id}/gifs` paged), `likes` (`/feeds/liked` paged), `single` (`/gifs/{id}` each).
- Download items through a concurrency pool sized to `settings.maxConcurrentDownloads`.
- Skip items already in history (`storage.hasDownloaded`) unless `overwriteExisting`.
- Each item: `RateLimiter.wait()`, stream response body to a temp file with an `AbortController`, `rename` on success, record in storage.
- Filename: `NNNN_{id}_{username}.{ext}` (rank zero-padded), sanitized; ext parsed from the URL path (query string stripped — a bug fixed in the Go version).
- Task controls: `pause` (stop launching new items + abort in-flight), `resume` (continue over remaining; skip handles idempotency), `cancel` (abort + mark cancelled). Status strings and the pause/resume state machine are consistent (a Go bug where checks used `"running"` vs `"downloading"` is not reproduced).
- Emits `download:progress` and `download:updated` via injected callbacks → IPC events.

## 7. Storage

`Storage` interface; `SqliteStorage` via `better-sqlite3` at `app.getPath('userData')/redgifs.db`, WAL mode.

Tables:
- `settings` — single row (`id = 1`) holding the typed `Settings` (one column per field).
- `downloads` — history (`id, username, content_id, content_name, file_path, file_size, duration, width, height, has_audio, downloaded_at, thumbnail, search_order, rank`), `UNIQUE(username, content_id)`.
- `tokens` — persisted user token (single row).

> **Note on the existing scaffold:** prior scaffolding wrote `src/main/store.ts` as an atomic-JSON store and omitted the `better-sqlite3`/`@electron/rebuild` dependencies. The implementation plan converts that file to `src/main/storage.ts` (`SqliteStorage`) behind the `Storage` interface and adds the native-module build wiring.

Stats (`getStats`) are SQL aggregates (counts, total size, top users, recent). The interface boundary means a different backend could replace SQLite without touching callers.

## 8. IPC & Events

Request/response (`ipcRenderer.invoke` ↔ `ipcMain.handle`) channels and main→renderer event channels are defined once in `shared/ipc.ts` (`IPC`, `EVT`) and exposed through the typed `RedgifsApi` on `window.api`. Events: `auth:changed`, `download:progress`, `download:updated`, `toast`. `window.api.on(channel, cb)` returns an unsubscribe function. This fully replaces the Go `UIEventManager`/websocket layer.

## 9. Data Flow

Renderer component → `window.api.method()` → preload `invoke` → main `ipc.ts` handler → module (`api`/`downloader`/`storage`/`auth`) → result back to the promise. Live updates (download progress, auth changes) flow the other way as `EVT` events the renderer subscribes to on mount.

## 10. Error Handling

- API/module errors reject the IPC promise; the renderer catches and shows a toast.
- Downloader: per-item failures increment `task.failed` and continue; the task fails only on list-resolution errors.
- 429 → backoff via `RateLimiter`; 401 → token refresh/relogin prompt.
- Login: window closed without token → non-fatal `{ authenticated: false }`.

## 11. Testing

`vitest` unit tests in main:
- `isUserToken` JWT detection (user vs `client/` vs garbage).
- API gif→`Content` conversion + pagination (`nextPage`).
- `RateLimiter` spacing and 429 backoff timing.
- Downloader filename generation + ext parsing + skip/dedupe logic.
- `SqliteStorage` round-trip (settings, record insert, `hasDownloaded`, stats aggregates).

Manual GUI validation: in-app login captures a token; a small download writes real files and records history. Verified via `npm run dev`.

## 12. Build Phases (parity goal, MVP-first)

- **Phase 1 (MVP):** scaffold, `SqliteStorage`, `RedgifsApi`, `RateLimiter`, IPC wiring, renderer shell + nav, public browse/search, `Downloader` (user type), downloads queue UI with live progress, settings read/write. Anonymous token only.
- **Phase 2 (auth + gated content):** `AuthManager` in-app login capture, `authStatus`/profile, likes, private collections, download types `likes`/`collection`.
- **Phase 3 (parity + polish):** history view, statistics dashboard, ranked filenames/thumbnails, adaptive-backoff parity, `single` downloads, and a dedicated `frontend-design` pass (resolves the oversized empty-state icon and general sizing). Remove the Go implementation once parity is confirmed.

## 13. Layout

```
desktop/
  package.json  electron.vite.config.ts  tsconfig*.json
  src/
    shared/    types.ts  ipc.ts
    preload/   index.ts  index.d.ts
    main/      index.ts  storage.ts  api.ts  auth.ts  ratelimit.ts  downloader.ts  ipc.ts
    renderer/  index.html  src/  (React app, pages, components, styles)
```

The Go app remains at repo root until Phase 3 parity, then is removed.
