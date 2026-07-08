import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTICO_REMOTE_DIR } from '@shared/constants.js'
import { IPC, type ConnectResult, type ConnStatePayload, type PasteImageArgs, type StatusPayload } from '@shared/ipc.js'
import { ok } from '@shared/result.js'
import type {
  ProviderId,
  ProviderSession,
  PortForwardRule,
  PortForwardStatus,
  ConnectionState,
  Result,
  ShelfItem,
  SshTarget,
  UploadedBlob
} from '@shared/types.js'
import { PorticoController } from './portico-controller.js'

const __dirname = join(fileURLToPath(import.meta.url), '..')

let mainWindow: BrowserWindow | null = null
let controller: PorticoController | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0e1116',
    title: 'Portico',
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

  // electron-vite dev server in DEV; built file in PROD.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  mainWindow = createWindow()
  controller = new PorticoController(() => mainWindow)

  // Forward controller events to the renderer over one-way channels.
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

  registerIpc(controller)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** Register every IPC channel against the controller. */
function registerIpc(c: PorticoController): void {
  const handle = <T>(ch: string, fn: () => T | Promise<T>) =>
    ipcMain.handle(ch, () => fn())
  const handleArg = <A, T>(ch: string, fn: (a: A) => T | Promise<T>) =>
    ipcMain.handle(ch, (_e, a: A) => fn(a))

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
}

// Surface the remote dir convention for any introspection needs.
export { PORTICO_REMOTE_DIR, ok }
