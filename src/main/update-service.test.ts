/**
 * Focused unit tests for the auto-update service.
 *
 * These cover the decisions that matter most:
 *   - In dev (unpackaged) the updater is never started, and manual checks
 *     return a "disabled" status instead of touching the network.
 *   - Event translation + listener fan-out works for each lifecycle state.
 *   - installUpdate() only calls quitAndInstall when an update has actually
 *     been downloaded.
 *
 * electron and electron-updater are mocked so the suite runs in plain Node.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---- mocks --------------------------------------------------------------

/**
 * A mutable fake updater that records calls and lets tests emit events. We
 * attach it to the global so the mocked `electron-updater` import can return
 * the same instance the test drives.
 */
interface FakeAutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  channel: string | null
  logger: unknown
  checkForUpdates: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}

let fakeUpdater: FakeAutoUpdater

vi.mock('electron', () => ({
  app: {
    isPackaged: false, // overridden per-test via setIsPackaged
    getPath: (key: string) => `/tmp/fake-${key}`,
    getVersion: () => '0.1.0',
    setName: vi.fn(),
    setPath: vi.fn()
  }
}))

const electronApp = (await import('electron')).app as unknown as {
  isPackaged: boolean
  getPath: (key: string) => string
  getVersion: () => string
  setName: (v: string) => void
  setPath: (key: string, v: string) => void
}

vi.mock('electron-updater', () => ({
  // Lazily return whatever fakeUpdater currently points at.
  get autoUpdater() {
    return fakeUpdater
  }
}))

function makeFakeUpdater(): FakeAutoUpdater {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    channel: null,
    logger: undefined,
    checkForUpdates: vi.fn().mockResolvedValue(null),
    quitAndInstall: vi.fn(),
    on: vi.fn()
  }
}

function setIsPackaged(value: boolean): void {
  electronApp.isPackaged = value
}

// Reset the module-level state between tests so each starts clean.
beforeEach(async () => {
  setIsPackaged(false)
  fakeUpdater = makeFakeUpdater()
  vi.resetModules()
})

describe('UpdateService — dev (unpackaged)', () => {
  it('init() is a no-op and never imports electron-updater', async () => {
    const { UpdateService } = await import('./update-service.js')
    const svc = new UpdateService({ startupDelayMs: 0 })
    await svc.init()
    // No updater was created; checkForUpdates stays on the dev path.
    expect(fakeUpdater.on).not.toHaveBeenCalled()
  })

  it('checkForUpdates returns a "disabled in development" status', async () => {
    const { UpdateService } = await import('./update-service.js')
    const svc = new UpdateService()
    const r = await svc.checkForUpdates()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state).toBe('not-available')
      expect(r.value.message).toMatch(/disabled/i)
    }
    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('installUpdate errors when nothing is downloaded', async () => {
    const { UpdateService } = await import('./update-service.js')
    const svc = new UpdateService()
    const r = svc.installUpdate()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NO_DOWNLOADED_UPDATE')
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('UpdateService — packaged', () => {
  it('configures the feed and wires event handlers on init', async () => {
    setIsPackaged(true)
    const { UpdateService } = await import('./update-service.js')
    const svc = new UpdateService({ startupDelayMs: 100000 }) // avoid the auto-check
    await svc.init()

    // The handlers we care about were subscribed.
    const events = fakeUpdater.on.mock.calls.map((c) => c[0])
    for (const ev of [
      'checking-for-update',
      'update-available',
      'update-not-available',
      'download-progress',
      'update-downloaded',
      'error'
    ]) {
      expect(events).toContain(ev)
    }
  })

  it('fans out status transitions to listeners via events', async () => {
    setIsPackaged(true)
    const { UpdateService } = await import('./update-service.js')
    const svc = new UpdateService({ startupDelayMs: 100000 })
    await svc.init()

    const seen: string[] = []
    svc.listeners.add((s) => seen.push(s.state))

    // Helper to emit an event that was registered via .on(event, handler).
    const emit = (event: string, ...args: unknown[]) => {
      const call = fakeUpdater.on.mock.calls.find((c) => c[0] === event)
      if (call) (call[1] as (...a: unknown[]) => void)(...args)
    }

    emit('checking-for-update')
    emit('update-available', { version: '0.2.0' })
    emit('download-progress', { percent: 42 })
    emit('update-downloaded', { version: '0.2.0' })

    expect(seen).toEqual(['checking', 'available', 'downloading', 'downloaded'])
    // The current snapshot reflects the last transition.
    expect(svc.status().state).toBe('downloaded')
    expect(svc.status().version).toBe('0.2.0')
    expect(svc.status().percent).toBe(100)
  })

  it('checkForUpdates delegates to electron-updater when packaged', async () => {
    setIsPackaged(true)
    const { UpdateService } = await import('./update-service.js')
    const svc = new UpdateService({ startupDelayMs: 100000 })
    await svc.init()

    const r = await svc.checkForUpdates()
    expect(r.ok).toBe(true)
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('installUpdate calls quitAndInstall only after a download', async () => {
    setIsPackaged(true)
    const { UpdateService } = await import('./update-service.js')
    const svc = new UpdateService({ startupDelayMs: 100000 })
    await svc.init()

    // Nothing downloaded yet.
    expect(svc.installUpdate().ok).toBe(false)

    // Simulate a completed download.
    const call = fakeUpdater.on.mock.calls.find((c) => c[0] === 'update-downloaded')!
    ;(call[1] as (...a: unknown[]) => void)({ version: '0.2.0' })

    const r = svc.installUpdate()
    expect(r.ok).toBe(true)
    // quitAndInstall is deferred via setImmediate; flush microtasks/timers.
    await new Promise((resolve) => setImmediate(resolve))
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('dispose cancels the scheduled startup check', async () => {
    vi.useFakeTimers()
    try {
      setIsPackaged(true)
      const { UpdateService } = await import('./update-service.js')
      const svc = new UpdateService({ startupDelayMs: 5000 })
      await svc.init()

      svc.dispose()
      // Advancing past the delay must NOT trigger checkForUpdates.
      vi.advanceTimersByTime(10_000)
      expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
