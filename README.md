# RedGifs Downloader

![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)
![Node](https://img.shields.io/badge/node-18%2B-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

Fast, resumable downloader for RedGifs content — with adaptive rate‑limit handling, proxy rotation, and ranked file organization.

Two ways to use it:

| | Best for | Needs |
|---|---|---|
| **CLI** (`redgifs-dl.mjs`) | Quick, scriptable, headless bulk downloads | Just **Node 18+** — one file, zero `npm install` |
| **Desktop app** (`desktop/`) | Browsing, search, likes/collections, a nice UI | Node + npm (run from source) or a prebuilt binary |

---

## CLI — one file, no install

The whole downloader is a single self‑contained file. **No `git clone`, no `npm install`.** If you have Node 18 or newer, download the one file and run it.

**macOS / Linux:**

```bash
curl -O https://raw.githubusercontent.com/privacytop/redgifs-downloader/main/redgifs-dl.mjs
node redgifs-dl.mjs -u <username>
```

**Windows (PowerShell):**

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/privacytop/redgifs-downloader/main/redgifs-dl.mjs -OutFile redgifs-dl.mjs
node redgifs-dl.mjs -u <username>
```

**Windows (cmd.exe):**

```bat
curl.exe -O https://raw.githubusercontent.com/privacytop/redgifs-downloader/main/redgifs-dl.mjs
node redgifs-dl.mjs -u <username>
```

That's it. It uses only Node built‑ins (no dependencies to install). Re‑run the same command any time to resume — already‑downloaded gifs are skipped.

> On Windows, use `curl.exe` (not bare `curl`) — in PowerShell `curl` is an alias for `Invoke-WebRequest` and won't accept `-O`. Or just download the raw file in your browser and `node redgifs-dl.mjs` from that folder.

> Don't have Node? Install it from [nodejs.org](https://nodejs.org) (v18+), or via your package manager (`brew install node`, `apt install nodejs`, `winget install OpenJS.NodeJS`).

### Examples

```bash
# a single creator
node redgifs-dl.mjs -u somecreator

# a creator's profile URL works too
node redgifs-dl.mjs -u https://www.redgifs.com/users/somecreator

# many creators at once (comma list or a file with one name per line)
node redgifs-dl.mjs -b alice,bob,carol
node redgifs-dl.mjs -b creators.txt

# save somewhere specific
node redgifs-dl.mjs -u somecreator -o ~/Videos/redgifs

# preview what would download, without saving anything
node redgifs-dl.mjs -u somecreator --dry-run

# number files by newest instead of most‑popular
node redgifs-dl.mjs -u somecreator --orders latest

# route through rotating proxies to spread out rate limits
node redgifs-dl.mjs -u somecreator \
  --proxy http://user:pass@host1:8080 \
  --proxy http://user:pass@host2:8080
node redgifs-dl.mjs -u somecreator --proxy-file proxies.txt
```

### Options

```
Main:
  -u, --username <user>      Username or profile URL to download
  -b, --batch <file|list>    Path to a file with usernames, or comma-separated list
  -o, --root-path <dir>      Root path for downloaded files
  -d, --database-path <file> Path for the download-history JSON (default: redgifs-dl.json)

Ordering:
      --orders <list>        Comma-separated search orders, highest priority first —
                             this drives the rank/number prefix on files.
                             (default: top,trending,recent,best,latest)
                             e.g. --orders latest   or   --orders latest,top

Performance:
  -c, --max-concurrency <n>  Maximum concurrent downloads (default: 50)
  -t, --timeout <sec>        Download timeout in seconds (default: 60)
  -r, --retries <n>          Retry attempts for failed downloads (default: 5)
      --quality <hd|sd>      Download quality (default: hd)

Proxy (rotates across the pool to spread rate limits):
      --proxy <url>          Proxy URL, repeatable. http/https, optional auth:
                             --proxy http://user:pass@host:port  (repeat for more)
      --proxy-file <file>    File with one proxy URL per line (# comments ok)

Other:
      --dry-run              Don't download, just show what would be downloaded
      --skip-history         Download files even if they are in the history
      --verbose              Enable verbose (debug) logging
      --version              Print version and exit
  -h, --help                 Show this help
```

### How it works

- **Ranked filenames** — files are prefixed with a zero‑padded rank (e.g. `007_Abc.mp4`) so your file manager sorts them by the chosen order. The **first** order in `--orders` decides the ranking; the others just add any gifs the first missed. So `--orders latest` numbers newest‑first, the default `top,...` numbers most‑popular‑first.
- **Complete by design** — on a 429 it reads the server's requested delay and waits it out, then retries; it won't silently skip content. Concurrency and request rate adapt to how the API is responding.
- **Resumable** — a small JSON history (`redgifs-dl.json` by default) records what's been fetched, so re‑runs skip existing files. If a later run finds a gif at a *better* rank, it renames the existing file instead of re‑downloading. Use `--skip-history` to force re‑download.
- **Proxies** — supplied proxies are used round‑robin, one per request, which spreads load across IPs and eases per‑IP rate limits. Supports `http`/`https` proxies with optional basic auth (HTTP‑CONNECT tunneling for the HTTPS API).

> The CLI downloads a creator's **public** gifs (no login needed). Liked videos and private collections live behind your account — use the desktop app for those.

---

## Desktop app — the GUI

A full RedGifs client (Electron + React): browse For‑You / Discover / niches, follow creators, view and manage your collections and likes, an immersive YouTube‑Shorts‑style player, an offline library indexer with search/sort, blocked‑tag filtering, and in‑app login (with silent token refresh so you're not re‑logging‑in every hour).

### Run from source

```bash
git clone https://github.com/privacytop/redgifs-downloader
cd redgifs-downloader/desktop
npm install
npm run dev        # hot-reload dev build
# or
npm run build      # production bundle
```

Requires Node + npm. First `npm install` compiles a native SQLite module for your platform automatically.

### Download a prebuilt executable

No building required — grab the file for your OS from the **[Releases](https://github.com/privacytop/redgifs-downloader/releases)** page:

| OS | File | How to run |
|---|---|---|
| **Windows** | `RedGifs-Downloader-<version>-Setup.exe` | Run the installer. |
| **Windows** (no install) | `RedGifs-Downloader-<version>-portable.exe` | Double‑click — runs directly, nothing installed. |
| **Linux** | `RedGifs-Downloader-<version>.AppImage` | `chmod +x` it, then run it. |
| **Linux** (Debian/Ubuntu) | `RedGifs-Downloader-<version>.deb` | `sudo apt install ./RedGifs-Downloader-<version>.deb` |

### Releasing (maintainers)

Every push to `main` triggers the [`Release` workflow](.github/workflows/release.yml): it builds on Windows + Linux runners and publishes a new GitHub Release automatically, auto-incrementing the version as `v4.0.<run-number>`.

To cut a specific version instead, push a tag — the release uses that version:

```bash
git tag v4.1.0
git push origin v4.1.0
```

---

## Requirements

- **CLI:** Node.js **18+** (for built‑in `fetch`). Nothing else.
- **Desktop app:** Node.js + npm to run from source, or a prebuilt binary.

## Notes

- For personal use. Respect creators and RedGifs' terms of service.
- Content is adult; you must be of legal age in your jurisdiction.

## License

MIT
