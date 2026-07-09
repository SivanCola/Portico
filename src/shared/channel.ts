/**
 * Release-channel configuration.
 *
 * A single source of truth for everything that varies between the `stable` and
 * `beta` builds of Portico. The compile-time channel is injected here by the
 * build (`PORTICO_RELEASE_CHANNEL` -> `__PORTICO_CHANNEL__`) so that main,
 * preload, and renderer all read the same value without runtime env plumbing.
 *
 * Pure, environment-agnostic helpers (channel detection, mapping) live here too
 * so they can be unit-tested without booting Electron.
 */

/** Which build of the app this is. Drives identity, storage, and UI. */
export type ReleaseChannel = 'stable' | 'beta'

/** Which electron-updater feed the build subscribes to. */
export type UpdateChannel = 'latest' | 'beta'

/**
 * The channel the current bundle was built for.
 *
 * Replaced at build time by `define` (see `electron.vite.config.ts`). Defaults
 * to `'stable'` when undefined, so dev/`electron-vite dev` behaves as stable.
 */
export const RELEASE_CHANNEL: ReleaseChannel =
  (globalThis as { __PORTICO_CHANNEL__?: string }).__PORTICO_CHANNEL__ === 'beta'
    ? 'beta'
    : 'stable'

/** Human-readable product name per channel. */
export const APP_NAME: Record<ReleaseChannel, string> = {
  stable: 'Portico',
  beta: 'Portico Beta'
}

/** macOS bundle / Windows appId per channel. */
export const APP_ID: Record<ReleaseChannel, string> = {
  stable: 'com.portico.app',
  beta: 'com.portico.app.beta'
}

/** electron-updater feed channel per release channel. */
export const UPDATE_CHANNEL: Record<ReleaseChannel, UpdateChannel> = {
  stable: 'latest',
  beta: 'beta'
}

/**
 * Home-relative directory on the *remote* host where uploaded blobs live, per
 * channel. Beta uses its own directory so caches never collide.
 */
export const REMOTE_BLOB_DIR: Record<ReleaseChannel, string> = {
  stable: '~/.portico/blobs',
  beta: '~/.portico-beta/blobs'
}

/**
 * Resolve the remote blob dir for the *current* build. Main uses this at
 * runtime; tests import the `REMOTE_BLOB_DIR` map directly.
 */
export function remoteBlobDir(channel: ReleaseChannel = RELEASE_CHANNEL): string {
  return REMOTE_BLOB_DIR[channel]
}

/** Resolve the app name for the current build. */
export function appName(channel: ReleaseChannel = RELEASE_CHANNEL): string {
  return APP_NAME[channel]
}

/** Resolve the electron-updater feed channel for the current build. */
export function updateChannel(channel: ReleaseChannel = RELEASE_CHANNEL): UpdateChannel {
  return UPDATE_CHANNEL[channel]
}

/**
 * Parse a git tag / version string into the release channel it belongs to.
 *
 *   `0.1.1`        -> stable
 *   `v0.1.1`       -> stable
 *   `0.1.1-beta.3` -> beta
 *   `v0.1.1-beta`  -> beta
 *
 * Pure + side-effect-free so it can be unit-tested and used from CI scripts.
 */
export function channelFromVersion(versionOrTag: string): ReleaseChannel {
  const stripped = versionOrTag.replace(/^v/, '')
  // A prerelease suffix begins at the first `-` following the semver core.
  const dashIdx = stripped.indexOf('-')
  if (dashIdx === -1) return 'stable'
  const suffix = stripped.slice(dashIdx + 1).toLowerCase()
  return suffix.startsWith('beta') ? 'beta' : 'stable'
}

/** True when the running build is allowed to consume prerelease updates. */
export function allowPrerelease(channel: ReleaseChannel = RELEASE_CHANNEL): boolean {
  return channel === 'beta'
}
