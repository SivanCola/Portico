import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { PORTICO_REMOTE_DIR } from '@shared/constants.js'
import {
  APP_NAME,
  RELEASE_CHANNEL,
  appName,
  updateChannel
} from '@shared/channel.js'
import { IPC, type ConnectResult, type ConnStatePayload, type PasteImageArgs, type StatusPayload } from '@shared/ipc.js'
import { ok } from '@shared/result.js'
import type {
  AppInfo,
  ProviderId,
  ProviderSession,
  PortForwardRule,
  PortForwardStatus,
  ConnectionState,
  Result,
  ShelfItem,
  SshTarget,
  UpdateStatus,
  UploadedBlob
} from '@shared/types.js'
import { PorticoController } from './portico-controller.js'
import { UpdateService } from './update-service.js'
import { getLogger } from './logger.js'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const log = getLogger()

// ---- runtime isolation by release channel --------------------------------
// Beta must be a fully independent app: different display name, different
// userData dir (so renderer localStorage / recent targets never collide with
// stable), and different identity. This runs as early as possible, before any
// window is created or `app.getPath('userData')` is read.
if (RELEASE_CHANNEL === 'beta') {
  app.setName(APP_NAME.beta)
  // Force a distinct userData path keyed off the app name. Without this, two
  // builds with different appId could still land in the same default dir.
  app.setPath('userData', join(app.getPath('appData'), APP_NAME.beta))
}

// ---- global crash guards -------------------------------------------------
// Catch anything that escapes the normal control flow so a bug becomes a
// diagnostic log line instead of a silent process death.
process.on('uncaughtException', (err) => {
  log.error('app', 'uncaughtException', { err })
})
process.on('unhandledRejection', (reason) => {
  log.error('app', 'unhandledRejection', { err: reason instanceof Error ? reason : String(reason) })
})

// Emit a startup banner once, after the channel/name has been settled so the
// log dir reflects the right app identity.
log.info('app', 'starting Portico', {
  channel: RELEASE_CHANNEL,
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  packaged: (() => {
    try {
      return app.isPackaged
    } catch {
      return false
    }
  })()
})
try {
  log.info('app', 'log path resolved', { path: app.getPath('logs') })
} catch {
  /* logs path not resolvable in this env — console-only */
}

let mainWindow: BrowserWindow | null = null
let controller: PorticoController | null = null
let updates: UpdateService | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0e1116',
    title: appName(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Open external links in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Drop the stale reference when this window closes so activate can recreate.
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // electron-vite dev server in DEV; built file in PROD.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** Ensure the auto-updater is alive (re-init after macOS window-all-closed dispose). */
function ensureUpdates(): void {
  if (!updates) {
    updates = new UpdateService()
    updates.listeners.add((s: UpdateStatus) =>
      mainWindow?.webContents.send(IPC.UPDATE_STATUS, s)
    )
  }
  void updates.init()
}

app.whenReady().then(() => {
  log.info('app', 'ready, creating window')
  mainWindow = createWindow()
  controller = new PorticoController(() => mainWindow)

  // Forward controller events to the renderer over one-way channels.
  // Closures always read the current `mainWindow`, so recreate-on-activate works.
  controller.outputListeners.add((data) =>
    mainWindow?.webContents.send(IPC.TERM_OUTPUT, data)
  )
  controller.statusListeners.add((s: StatusPayload) =>
    mainWindow?.webContents.send(IPC.STATUS, s)
  )
  controller.shelfListeners.add((item: ShelfItem) =>
    mainWindow?.webContents.send(IPC.SHELF_ITEM_UPDATED, item)
  )
  controller.connStateListeners.add((payload: ConnStatePayload) =>
    mainWindow?.webContents.send(IPC.CONN_STATE, payload)
  )
  controller.pfListeners.add((forwards: PortForwardStatus[]) =>
    mainWindow?.webContents.send(IPC.PF_CHANGED, forwards)
  )
  controller.sessionListeners.add((session) =>
    mainWindow?.webContents.send(IPC.SESSION_CHANGED, session)
  )

  registerIpc(controller)

  // ---- auto-updater -----------------------------------------------------
  ensureUpdates()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      // On macOS, window-all-closed disposed the updater without quitting.
      ensureUpdates()
    }
  })
})

app.on('window-all-closed', () => {
  log.info('app', 'all windows closed')
  updates?.dispose()
  updates = null
  if (process.platform !== 'darwin') app.quit()
})

/** Register every IPC channel against the controller. */
function registerIpc(c: PorticoController): void {
  // Wrap handlers so any returned Result.err is logged once for diagnosis,
  // without leaking into the renderer. Thrown errors are logged and re-thrown
  // so the existing error semantics are unchanged.
  const logIfError = (ch: string, r: unknown): void => {
    if (r && typeof r === 'object' && 'ok' in r && (r as { ok: unknown }).ok === false) {
      const error = (r as { error?: { code?: string; message?: string } }).error
      if (error) log.warn('ipc', `handler error: ${ch}`, error)
    }
  }
  const handle = <T>(ch: string, fn: () => T | Promise<T>) =>
    ipcMain.handle(ch, async () => {
      try {
        const r = await fn()
        logIfError(ch, r)
        return r
      } catch (e) {
        log.error('ipc', `handler threw: ${ch}`, { err: e as Error })
        throw e
      }
    })
  const handleArg = <A, T>(ch: string, fn: (a: A) => T | Promise<T>) =>
    ipcMain.handle(ch, async (_e, a: A) => {
      try {
        const r = await fn(a)
        logIfError(ch, r)
        return r
      } catch (e) {
        log.error('ipc', `handler threw: ${ch}`, { err: e as Error })
        throw e
      }
    })

  // Connection
  handleArg<SshTarget, Result<ConnectResult>>(IPC.CONNECT, (t) => c.connect(t))
  handle(IPC.DISCONNECT, () => c.disconnect())
  handle(IPC.IS_CONNECTED, () => c.isConnected())
  handle(IPC.CLIPBOARD_HAS_IMAGE, () => c.clipboardHasImage())

  // Terminal
  ipcMain.on(IPC.TERM_INPUT, (_e, data: string) => c.sendInput(data))
  ipcMain.on(IPC.TERM_RESIZE, (_e, cols: number, rows: number) => c.resize(cols, rows))

  // Image bridge
  handleArg<PasteImageArgs, Result<UploadedBlob>>(IPC.PASTE_IMAGE, (a) => c.pasteImage(a))
  handle(IPC.UPLOAD_CLIPBOARD, () => c.uploadClipboard())
  handleArg<{ remotePath: string; prompt?: string }, Result<true>>(IPC.PASTE_REMOTE_PATH, (a) =>
    c.pasteRemotePath(a.remotePath, a.prompt)
  )

  // Session
  handle(IPC.GET_SESSION, () => c.getSession())
  handleArg<ProviderId, Result<ProviderSession>>(IPC.SET_PROVIDER, (p) => c.setProvider(p))
  handle(IPC.DETECT_PROVIDER, () => c.detectProvider())

  // Shelf
  handle(IPC.SHELF_LIST, () => c.shelfList())
  handle(IPC.SHELF_CLEAR, () => c.shelfClear())

  // Remote cache
  handle(IPC.CLEAR_REMOTE_CACHE, () => c.clearRemoteCache())

  // Connection state
  handle(IPC.CONN_STATE, () => c.getConnectionState())
  handle(IPC.CANCEL_RECONNECT, () => c.cancelReconnect())

  // Port forwarding
  handleArg<{ localPort: number; remoteHost: string; remotePort: number }, Result<PortForwardRule>>(
    IPC.PF_ADD, (rule) => c.addPortForward(rule)
  )
  handleArg<string, Result<true>>(IPC.PF_REMOVE, (id) => c.removePortForward(id))
  handle(IPC.PF_LIST, () => c.listPortForwards())

  // App info & updates
  handle(IPC.GET_APP_INFO, getAppInfo)
  handle(IPC.CHECK_FOR_UPDATES, () => (updates ? updates.checkForUpdates() : ok({ state: 'not-available' as const, message: 'Updates are disabled.' })))
  handle(IPC.INSTALL_UPDATE, () => (updates ? updates.installUpdate() : ok(true)))

  // Private-key file picker (ConnectionForm Browse button)
  handle(IPC.PICK_PRIVATE_KEY, async () => {
    const opts = {
      title: 'Select SSH private key',
      defaultPath: join(homedir(), '.ssh'),
      properties: ['openFile' as const]
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) {
      return ok(null as string | null)
    }
    return ok(result.filePaths[0] as string)
  })
}

/** Static app identity for the renderer (name, version, channels, packaged). */
function getAppInfo(): Result<AppInfo> {
  return ok({
    name: appName(),
    version: app.getVersion(),
    releaseChannel: RELEASE_CHANNEL,
    updateChannel: updateChannel(),
    isPackaged: app.isPackaged
  })
}

// Surface the remote dir convention for any introspection needs.
export { PORTICO_REMOTE_DIR, ok }
