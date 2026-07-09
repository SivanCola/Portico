/**
 * Auto-update service.
 *
 * Wraps electron-updater so the rest of main doesn't talk to the library
 * directly. Responsibilities:
 *
 *   - Configure the feed per compile-time release channel (stable -> latest,
 *     no prereleases; beta -> beta + prereleases). Both channels auto-download.
 *   - Only run when packaged; in dev, manual checks return a friendly message.
 *   - Translate electron-updater events into the app's `UpdateStatus` shape and
 *     fan them out to listeners (which index.ts forwards to the renderer).
 *   - Expose imperative `checkForUpdates` / `installUpdate` for the IPC layer.
 *
 * The updater is created lazily and only when packaged, so importing this
 * module in dev (or unit tests) has no side effects.
 */
import { app } from 'electron'
import { allowPrerelease, updateChannel } from '@shared/channel.js'
import { ok, err } from '@shared/result.js'
import type { Result, UpdateStatus } from '@shared/types.js'
import { getLogger } from './logger.js'

const log = getLogger()

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
}

export class UpdateService {
  private autoUpdater: AutoUpdater | null = null
  private current: UpdateStatus = { state: 'idle' }
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  /** Bound handlers so dispose can detach them from the electron-updater singleton. */
  private boundHandlers: Array<{ event: string; listener: (...args: unknown[]) => void }> = []

  /** Listeners receive every status transition (main forwards these to UI). */
  readonly listeners = new Set<(s: UpdateStatus) => void>()

  constructor(private readonly opts: UpdateServiceOptions = {}) {}

  /**
   * Initialize the updater. No-op in dev (`!app.isPackaged`); in packaged
   * builds it wires up the channel config, event listeners, and schedules one
   * automatic check shortly after launch.
   */
  async init(): Promise<void> {
    if (!app.isPackaged) {
      log.info('updater', 'updates disabled in dev')
      return
    }
    // Idempotent: skip if already wired (e.g. activate after a no-op dispose).
    if (this.autoUpdater) return

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
      return
    }
    this.autoUpdater = autoUpdater

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
      log.error('updater', 'update error', { err: e as Error })
      this.set({ state: 'error', message: (e as Error)?.message ?? 'Update check failed.' })
    })

    const delay = this.opts.startupDelayMs ?? 10_000
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      void this.checkForUpdates()
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
   * In dev this returns a descriptive status instead of touching the network,
   * so the command palette can surface "updates disabled in dev".
   */
  async checkForUpdates(): Promise<Result<UpdateStatus>> {
    if (!this.autoUpdater) {
      // Dev / unpackaged: never check.
      const devStatus: UpdateStatus = {
        state: 'not-available',
        message: 'Updates are disabled in development.'
      }
      this.set(devStatus)
      return ok(devStatus)
    }
    try {
      await this.autoUpdater.checkForUpdates()
      return ok(this.current)
    } catch (e) {
      const message = (e as Error)?.message ?? 'Update check failed.'
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
      return err('UPDATES_DISABLED', 'Updates are disabled in development.')
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
