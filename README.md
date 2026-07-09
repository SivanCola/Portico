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
- `⌘/Ctrl + Shift + V` — paste clipboard image into the active provider

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

- Clipboard paste (bitmap + copied file): `src/main/clipboard.ts`
- Spaces / non-ASCII paths: `src/shared/hash.test.ts` (`shellQuote`, `blobPath`)
- Reconnect-safe teardown: `src/main/ssh-session.ts` (`disconnect`)
- Claude path reference: `src/shared/adapters.test.ts` (claude adapter)
- Codex `-i` vs interactive: `src/shared/adapters.test.ts` (codex adapter)
- Oversized-image compression/rejection: `src/main/clipboard.ts` (`normalizeNative`) + `blob-uploader.ts`
- Normal text paste behaves like a terminal: terminal `onData` → `sendInput`
