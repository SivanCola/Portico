# Portico

A cross-platform desktop SSH terminal whose first feature is **local-image
paste into remote AI coding CLIs** (Claude Code, Codex). Copy a screenshot
locally → Portico uploads it to the remote host and injects the right
provider-aware prompt into your terminal. Cloudless by default: every byte
travels over your own SSH connection.

## Status

MVP. The reliable baseline is **file-path-based** image handoff (the remote AI
reads `~/.portico/blobs/<sha>.<ext>`). Native clipboard simulation and a remote
`portico-agent` helper are explicitly out of scope for this version.

## Architecture

```
src/
  shared/            types, IPC contract, constants, adapters, hashing (env-agnostic, unit-tested)
  main/              Electron main: SSH/SFTP session, clipboard, blob upload, IPC handlers
  preload/           contextBridge: typed window.portico API
  renderer/src/      React + xterm.js UI: connection form, terminal, image shelf, command palette
```

Provider adapters (`shared/adapters.ts`) decide how a remote path becomes text:

| Provider | Interactive session              | Command mode                          |
| -------- | -------------------------------- | ------------------------------------- |
| Claude   | `Analyze this image: <path>`     | (same)                                |
| Codex    | `<prompt>: <path>` (path fallback) | `codex -i <path> "<prompt>"`          |
| Shell    | `# image uploaded to <path>`     | (same)                                |

Detection is heuristic (banner / process name) and can be overridden from the
top-bar provider pills.

## Develop

```bash
npm install
npm run dev          # electron-vite dev — launches the stable Electron app
npm run dev:beta     # same, but built for the beta channel
npm run build        # build main + preload + renderer to out/ (stable)
npm run build:beta   # build for the beta channel
npm run typecheck    # tsc --noEmit for both node and web configs
npm test             # vitest unit tests for pure logic
```

## Key bindings

- `⌘/Ctrl + Shift + P` — command palette
- `⌘/Ctrl + Shift + V` — **stage** clipboard image(s) locally (no upload yet; repeat for more)
- Enter in the Image Shelf commit bar — upload all staged images, inject paths, and submit to Claude/Codex
- `⌘/Ctrl + \` — toggle the tool sidebar (image shelf + port forwards)

## Port forwarding

SSH sessions support **local** (`-L`) and **remote** (`-R`) port forwards from the
right-hand tool sidebar (enable under **Settings → Port forwarding**).

| Mode | Meaning | Typical use |
| ---- | ------- | ----------- |
| Local (−L) | Mac listens → tunnel to host:port **on the server** | Claude Code / Vite / Next preview on the remote machine |
| Remote (−R) | Server listens → tunnel back to a service **on your Mac** | Webhooks, local agents |
| SOCKS (−D) | Mac runs a **SOCKS5** proxy; each request is forwarded over SSH | Browse / curl as if from the remote host |

**SOCKS example:** add a dynamic forward on local port `1080`, then:

```bash
curl --socks5-hostname 127.0.0.1:1080 https://ifconfig.me
# or configure the system / browser proxy to socks5://127.0.0.1:1080
```

Each rule shows live **traffic counters** (↑ local→remote, ↓ remote→local). Click a
row counter to reset that rule, or **Reset traffic** for the whole session.

**Workflow for remote dev servers**

1. Connect over SSH and start a server (e.g. Claude Code opens `localhost:5173` on the host).
2. Portico sniffs terminal output for URLs like `http://localhost:5173` and offers **one-click Forward**.
3. Or add a rule manually: local port → `127.0.0.1` : remote port (defaults to same port both sides).
4. Click the browser icon on a listening local forward, or use the command palette **Open port forward in browser**.

Rules are **persisted per session tab** (with host/tmux restore), survive intentional disconnect
(shown as *stopped*), and rebind on reconnect. Options:

- **Same port both sides** / **Auto local port** when the preferred local port is busy
- **Pause / resume** a single rule without deleting it
- **Advanced**: label, bind address (`127.0.0.1` default; `0.0.0.0` exposes LAN — use carefully)
- Cross-tab collision detection for the same local listen port

Disable the feature under **Settings → Port forwarding**, or use **Terminal only** mode to
turn off image bridge + port forwards + provider detect together.

## Session restore

Portico saves the left-rail tab layout to `userData/sessions.json` (no passwords).
On launch it can reopen tabs and auto-reconnect SSH (key or agent) and
`tmux attach` to each tab’s last tmux session, and restore that tab’s **port-forward rules**.
Toggle under **Settings → Restore sessions on launch**.

## Storage convention

Remote blobs live at `~/.portico/blobs/<sha256>.<ext>` (content-addressed, so
re-pasting the same image is a no-op). `Clear Remote Portico Cache` in the
palette deletes them.

## Release channels

Portico ships in two parallel channels, selected at build time via
`PORTICO_RELEASE_CHANNEL` (`stable` is the default):

| Channel | App name | appId | Remote blob dir | Update feed | Output dir |
| ------- | -------- | ----- | ---------------- | ----------- | ---------- |
| stable  | Portico | `com.portico.app` | `~/.portico/blobs` | `latest` | `dist/stable` |
| beta    | Portico Beta | `com.portico.app.beta` | `~/.portico-beta/blobs` | `beta` | `dist/beta` |

Stable and Beta are fully isolated: different app identity, independent local
`userData`/`localStorage`, and separate remote caches, so both can be installed
side by side.

### Packaging

```bash
npm run dist:stable   # package the stable build into dist/stable
npm run dist:beta     # package the beta build into dist/beta
```

### Auto-updates

Packaged builds check for updates on the GitHub Releases feed of this repo
(`SivanCola/Portico`). Beta auto-downloads new prereleases and prompts to
restart; stable only receives `latest` releases. In development, update checks
report "updates disabled in dev." The command palette exposes
`Check for Updates` and, once a download is ready, `Restart to Install Update`.

### Releasing

Tag-driven releases (see `.github/workflows/release.yml`):

- `vX.Y.Z` (e.g. `v0.1.1`) → stable, published as a normal GitHub Release, feeds `latest`.
- `vX.Y.Z-beta.N` (e.g. `v0.1.1-beta.1`) → beta, published as a **prerelease** GitHub Release, feeds `beta`.

The workflow validates that `package.json` `version` equals the tag (minus the
`v`) before building, so updater metadata never carries the wrong version.

## Test plan mapping

- Clipboard stage (bitmap + copied file(s)) then commit on Enter: `src/main/clipboard.ts`, `portico-controller.ts` (`stage` / `commitStaged`)
- Spaces / non-ASCII paths: `src/shared/hash.test.ts` (`shellQuote`, `blobPath`)
- Reconnect-safe teardown: `src/main/ssh-session.ts` (`disconnect`)
- Claude path reference: `src/shared/adapters.test.ts` (claude adapter)
- Codex `-i` vs interactive: `src/shared/adapters.test.ts` (codex adapter)
- Oversized-image compression/rejection: `src/main/clipboard.ts` (`normalizeNative`) + `blob-uploader.ts`
- Normal text paste behaves like a terminal: terminal `onData` → `sendInput`
