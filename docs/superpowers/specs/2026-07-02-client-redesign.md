# RedGifs Client + Downloader — Full Redesign Spec ("Midnight Press")

**Date:** 2026-07-02
**Status:** Approved (design + scope)
**Builds on:** the Electron rewrite (Phase 1 MVP + Phase 2 auth, both shipped on branch `electron-rewrite`).

## 1. Vision

Turn the downloader into a full **RedGifs desktop client** with a distinctive editorial aesthetic. Browse and watch RedGifs content in-app (real video playback), navigate the same feeds the site offers (For You, Discover, Following, Niches, a creator's gifs, collections, likes), and download anything — single item, a whole feed/user/collection — from anywhere. Auth (Phase 2) unlocks personal feeds; anonymous still works for public browsing.

## 2. Aesthetic — "Midnight Press"

Vault-dark canvas + magazine editorial + restrained ember accent (fusion of the approved directions A × C).

- **Palette (dark, mandatory):** bg `#0c0b0e`, panel `#121016`, hairlines `#221f2a`/`#2c2833`, ink `#efe9e1`, cream display `#f5efe6`, muted `#8f887e`, dim `#645e57`, accent ember `#d8563d` (+ soft `#ef8a6d`), success `#7fae5a`.
- **Type:** display = `Fraunces` (characterful serif, section titles + creator names); body/UI = `Hanken Grotesk`; numbers, kickers, meta, readouts = `Space Mono`. Bundled via `@fontsource` (offline; no runtime CDN).
- **Motifs:** editorial kickers (`№ 03 — trending`), hairline rules under titles, asymmetric layouts, generous air, mono captions, thin ember progress rules. Media-forward.
- Fix the placeholder look entirely, including the oversized empty-state icon (constrain empty-state SVGs to a fixed size).

## 3. Navigation & screens

Sidebar grouped:
- **Feeds:** For you (`/v2/feeds/for-you`), Discover (`/v2/gifs/search?type=g|i&order=trending`), Following (`/v2/me/following` → their content), Niches (`/v2/niches/trending/search`, `/categories`, `/my`, `/following`).
- **Library:** Collections (`/v2/users/{me}/collections`, `/v2/me/collections/{id}/gifs`), Likes (`/v2/feeds/liked`), Downloads, History.
- **Account chip** (avatar + `@username` from `/v1/me`) → Account/Settings.

Screens: For You, Discover, Following, Niches (+ niche detail), Creator page (`/v2/users/{u}/search?type=g|i&tags=`, tabs gifs/images, `/creators/{u}/tags`), Collection detail, Likes, Downloads, History, Statistics, Settings, Account (profile + preferences via `PATCH /v1/me`), Login.

## 4. View modes

Every content listing supports a mode toggle (persisted in settings):
- **Editorial** — asymmetric magazine grid (feature tile + captions). For browsing/overview.
- **Grid** — dense portrait (9:16) cards, N across, vertically scrollable, hover plays the silent mp4, download affordance on hover. Default for video feeds.
- **Feed** — opens the immersive player directly.

## 5. Immersive player (the core new feature)

Click any card (or choose Feed mode) → a full-stage vertical player.
- Portrait video (`urls.hd`/`sd` or `silent` for hover; full with audio in player), centered on a dark stage; prev/next peeks.
- **Scroll wheel = next/prev video** (scroll-snap), staying within the **source feed** the user launched from (For You / Discover / a creator / a collection / likes / niche). The player receives the ordered list + an index + a "load more" callback for pagination.
- Right action rail: like, **ember Save = download this item**, follow creator, creator avatar/@ (click → creator page). Meta: views, duration, tags. Source chip top-left (`▸ For you · 14/220`), close top-right.
- **Niche context only:** an up/down "fits this niche?" control (`POST /v2/niches/{id}/feedback` `{gif, state:'up'|'down'}`). Not shown for general videos.
- No generic down-arrow control (removed).

## 6. Backend additions (`RedgifsApi`, main process)

Add, mapping to shared types: `getForYou(page)`, `searchGifs({type,order,page,verified,tags})`, `searchCreators({order,page,verified})`, `creatorPreviews(...)`, `getCreatorContent(u,{type,order,page,tags})`, `getCreatorTags(u)`, `getUser(u)` (`/v1/users/{u}`), `getMyContent({type,order,page})`, `getFollowing/Followers(page)`, `getFollows()`, `getNiches*` (trending/categories/my/following/related/suggest), `nicheFeedback(id,gif,state)`, `getCollections`, `getCollectionContent`, `getLikesV2`, `updatePreferences(ops)` (`PATCH /v1/me`). `type=g` video, `type=i` image. All go through the existing rate limiter + expiry-aware auth; absolute-URL support already added for v1.

Downloads: reuse the existing `Downloader`; add a "download single content" path used by the player Save action (the `Content` is already in hand, no re-fetch needed).

## 7. Architecture (unchanged shape)

Electron main (all logic) + preload (contextBridge) + React renderer. New IPC channels for each API method + events already in place. Renderer state per-feed with pagination + a shared player overlay that any feed can open with `(items, index, source, loadMore)`. Real `<video>` playback with autoplay/mute-on-hover in grids, audio in the player. Persisted view-mode + settings in SQLite.

## 8. Build order (single expanded effort, subagent-driven)

1. **Design system** — bundle fonts, `styles/tokens.css` + base + primitives (Button, Kicker, Rule, MediaCard/VideoTile, StatLine, EmptyState, Toasts), redesigned shell + grouped nav + account chip.
2. **API + IPC expansion** — all endpoints above + shared types + preload + handlers.
3. **Feeds & pages** — For You, Discover, Following, Niches (+ detail), Creator page, Collections, Likes, with Editorial/Grid modes.
4. **Immersive player** — video stage, scroll-snap, contextual feed + pagination, actions (like/save/follow), niche feedback in niche context.
5. **Account & the rest** — Login screen, Account + preferences (`PATCH /v1/me`), Downloads (redesigned ledger), History, Statistics, Settings (incl. view-mode + quality + folder).
6. **Verify & polish** — build/tests green; manual pass in the real app.

## 9. Non-goals (for now)
Kinde refresh-token flow (token still ~1h; re-login when expired), uploading/managing own content, advert slots, comments. Image galleries (`type:2`/`gallery`) download the primary asset only.
