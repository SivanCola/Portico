/**
 * Auto-update service.
 *
 * Wraps electron-updater so the rest of main doesn't talk to the library
 * directly. Responsibilities:
 *
 *   - Configure the feed per compile-time release channel (stable -> latest,
 *     no prereleases; beta -> beta + prereleases). Both channels auto-download.
 *   - Only run when packaged; in dev, manual checks return a friendly message.
 *   - Local `electron-builder --dir` packs often lack `app-update.yml` — skip
 *     the feed and never surface ENOENT as a red error banner.
 *   - Translate electron-updater events into the app's `UpdateStatus` shape and
 *     fan them out to listeners (which index.ts forwards to the renderer).
 *   - Expose imperative `checkForUpdates` / `installUpdate` for the IPC layer.
 *
 * The updater is created lazily and only when packaged, so importing this
 * module in dev (or unit tests) has no side effects.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { allowPrerelease, updateChannel } from '@shared/channel.js'
import { ok, err } from '@shared/result.js'
import type { Result, UpdateStatus } from '@shared/types.js'
import { getLogger } from './logger.js'

const log = getLogger()

/** Friendly copy when this install has no updater feed (local --dir pack). */
const LOCAL_PACK_MESSAGE = 'Updates are not available for this local build.'

/**
 * The updater is imported lazily so that dev / test environments never pull in
 * the native bits of electron-updater. The dynamic import also keeps this
 * module's top level side-effect free.
 */
type AutoUpdater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  channel: string | null
  logger: unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown
  removeAllListeners?(event?: string): unknown
}

export interface UpdateServiceOptions {
  /** Delay before the automatic startup check, in ms. */
  startupDelayMs?: number
  /**
   * Optional override for the app-update.yml probe (tests). When omitted,
   * resolves `process.resourcesPath/app-update.yml`.
   */
  hasUpdateMetadata?: () => boolean
}

/**
 * True when an error is expected for local / incomplete packs and should not
 * be shown as a failure banner (e.g. missing app-update.yml after `--dir`).
 * Pure — exported for unit tests.
 */
export function isBenignUpdateError(message: string): boolean {
  if (!message) return false
  // electron-updater opens Resources/app-update.yml; --dir packs omit it.
  if (/app-update\.yml/i.test(message)) return true
  if (/ENOENT/i.test(message) && /update/i.test(message)) return true
  // No publish config / channel metadata in the bundle.
  if (/ERR_UPDATER_(NO_PUBLISH_CONFIG|CHANNEL_FILE_NOT_FOUND)/i.test(message)) return true
  return false
}

/**
 * Whether this packaged install ships updater feed metadata.
 * Pure enough for tests when `resourcesPath` is injected via opts.
 */
export function hasAppUpdateYml(resourcesPath = process.resourcesPath): boolean {
  if (!resourcesPath) return false
  try {
    return existsSync(join(resourcesPath, 'app-update.yml'))
  } catch {
    return false
  }
}

export class UpdateService {
  private autoUpdater: AutoUpdater | null = null
  private current: UpdateStatus = { state: 'idle' }
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  /** Bound handlers so dispose can detach them from the electron-updater singleton. */
  private boundHandlers: Array<{ event: string; listener: (...args: unknown[]) => void }> = []
  /**
   * When set, updater is intentionally off for this install (dev or local pack
   * without feed metadata). Manual checks return not-available with this text.
   */
  private disabledMessage: string | null = null
  /** User/feature-flag kill switch (Terminal only / disable auto-update). */
  private userEnabled = true

  /** Listeners receive every status transition (main forwards these to UI). */
  readonly listeners = new Set<(s: UpdateStatus) => void>()

  constructor(private readonly opts: UpdateServiceOptions = {}) {}

  /**
   * Enable/disable update checks at runtime. When disabled, cancels the
   * startup timer and returns a soft not-available on manual checks.
   */
  setEnabled(enabled: boolean): void {
    this.userEnabled = enabled
    if (!enabled && this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    log.info('updater', enabled ? 'auto-update enabled' : 'auto-update disabled by user')
  }

  /**
   * Initialize the updater. No-op in dev (`!app.isPackaged`); in packaged
   * builds it wires up the channel config, event listeners, and schedules one
   * automatic check shortly after launch — unless `app-update.yml` is missing
   * (local `pack:*` / `--dir` builds).
   */
  async init(): Promise<void> {
    if (!app.isPackaged) {
      log.info('updater', 'updates disabled in dev')
      this.disabledMessage = 'Updates are disabled in development.'
      return
    }
    // Idempotent: skip if already wired (e.g. activate after a no-op dispose).
    if (this.autoUpdater) return

    const metadataOk = this.opts.hasUpdateMetadata
      ? this.opts.hasUpdateMetadata()
      : hasAppUpdateYml()
    if (!metadataOk) {
      // electron-builder --dir does not embed app-update.yml; checking would
      // only throw ENOENT and paint a red banner. Stay quiet instead.
      log.info('updater', 'no app-update.yml; updates disabled for this install')
      this.disabledMessage = LOCAL_PACK_MESSAGE
      return
    }

    const mod = (await import('electron-updater')) as {
      autoUpdater?: AutoUpdater
      default?: { autoUpdater?: AutoUpdater }
    }
    // electron-updater ships as CommonJS. Under our ESM main process the CJS
    // named export isn't always re-exposed on the dynamic import namespace
    // (cjs-module-lexer may miss it), so fall back to the default-export shape.
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
    if (!autoUpdater) {
      log.error('updater', 'electron-updater did not expose autoUpdater; updates disabled')
      this.disabledMessage = LOCAL_PACK_MESSAGE
      return
    }
    this.autoUpdater = autoUpdater
    this.disabledMessage = null

    // Auto-download on both channels so "available" immediately progresses to
    // a real download (stable previously left users stuck on a fake "downloading…" UI).
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = allowPrerelease()
    autoUpdater.channel = updateChannel()
    // Silence electron-updater's default console logging.
    autoUpdater.logger = null
    log.info('updater', 'initialized', {
      channel: updateChannel(),
      allowPrerelease: allowPrerelease(),
      autoDownload: autoUpdater.autoDownload
    })

    this.bind(autoUpdater, 'checking-for-update', () => {
      log.info('updater', 'checking for updates')
      this.set({ state: 'checking' })
    })
    this.bind(autoUpdater, 'update-available', (info: unknown) => {
      const version = (info as { version?: string })?.version
      log.info('updater', 'update available', { version })
      this.set({ state: 'available', version, percent: undefined, message: undefined })
    })
    this.bind(autoUpdater, 'update-not-available', () => {
      log.info('updater', 'no update available')
      this.set({ state: 'not-available', message: 'You are on the latest version.' })
    })
    this.bind(autoUpdater, 'download-progress', (progress: unknown) => {
      const percent = (progress as { percent?: number })?.percent
      this.set({ state: 'downloading', percent })
    })
    this.bind(autoUpdater, 'update-downloaded', (info: unknown) => {
      const version = (info as { version?: string })?.version
      log.info('updater', 'update downloaded', { version })
      this.set({ state: 'downloaded', version, percent: 100, message: 'Update ready. Restart to install.' })
    })
    this.bind(autoUpdater, 'error', (e: unknown) => {
      const message = (e as Error)?.message ?? 'Update check failed.'
      if (isBenignUpdateError(message)) {
        // Still defend against racey ENOENT if metadata disappeared mid-check.
        log.info('updater', 'benign update error suppressed', { message })
        this.set({ state: 'not-available', message: LOCAL_PACK_MESSAGE })
        return
      }
      log.error('updater', 'update error', { err: e as Error })
      this.set({ state: 'error', message })
    })

    if (!this.userEnabled) {
      log.info('updater', 'skipping startup check (disabled by user)')
      return
    }
    const delay = this.opts.startupDelayMs ?? 10_000
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      if (this.userEnabled) void this.checkForUpdates()
    }, delay)
  }

  /** Tear down timers and detach electron-updater singleton listeners. */
  dispose(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    // electron-updater's autoUpdater is a module singleton — must remove our
    // handlers or macOS activate → init() stacks duplicate fan-out.
    if (this.autoUpdater) {
      for (const { event, listener } of this.boundHandlers) {
        this.autoUpdater.removeListener?.(event, listener)
      }
    }
    this.boundHandlers = []
    this.autoUpdater = null
    // Keep disabledMessage so a re-init can re-probe; clear so next init is clean.
    this.disabledMessage = null
  }

  private bind(
    autoUpdater: AutoUpdater,
    event: string,
    listener: (...args: unknown[]) => void
  ): void {
    autoUpdater.on(event, listener)
    this.boundHandlers.push({ event, listener })
  }

  /**
   * Manually trigger an update check.
   *
   * In dev / local packs without feed metadata this returns a descriptive
   * not-available status instead of touching the network or throwing ENOENT.
   */
  async checkForUpdates(): Promise<Result<UpdateStatus>> {
    if (!this.userEnabled) {
      const status: UpdateStatus = {
        state: 'not-available',
        message: 'Auto-update is disabled in settings.'
      }
      this.set(status)
      return ok(status)
    }
    if (!this.autoUpdater) {
      const message = this.disabledMessage ?? 'Updates are disabled in development.'
      const status: UpdateStatus = { state: 'not-available', message }
      this.set(status)
      return ok(status)
    }
    try {
      await this.autoUpdater.checkForUpdates()
      return ok(this.current)
    } catch (e) {
      const message = (e as Error)?.message ?? 'Update check failed.'
      if (isBenignUpdateError(message)) {
        log.info('updater', 'benign update check failure suppressed', { message })
        const status: UpdateStatus = { state: 'not-available', message: LOCAL_PACK_MESSAGE }
        this.set(status)
        return ok(status)
      }
      this.set({ state: 'error', message })
      return err('UPDATE_CHECK_FAILED', message)
    }
  }

  /**
   * Install a previously downloaded update by restarting the app.
   * Returns an error if nothing has been downloaded yet.
   */
  installUpdate(): Result<true> {
    if (this.current.state !== 'downloaded') {
      return err('NO_DOWNLOADED_UPDATE', 'No downloaded update to install.')
    }
    if (!this.autoUpdater) {
      return err('UPDATES_DISABLED', this.disabledMessage ?? 'Updates are disabled in development.')
    }
    // quitAndInstall closes all windows, quits, and relaunches into the update.
    // setImmediate lets the IPC response flush back to the renderer first.
    setImmediate(() => this.autoUpdater?.quitAndInstall())
    return ok(true)
  }

  /** Current status snapshot (e.g. for initial renderer sync). */
  status(): UpdateStatus {
    return this.current
  }

  private set(next: UpdateStatus): void {
    this.current = next
    for (const cb of this.listeners) cb(next)
  }
}
