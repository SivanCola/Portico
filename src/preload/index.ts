/**
 * Preload script: exposes a minimal, fully-typed `window.portico` API to the
 * renderer via contextBridge. No Node primitives leak across the boundary.
 *
 * Every method mirrors an IPC channel defined in shared/ipc.ts. Listeners are
 * returned as unsubscribe functions so the renderer can clean up on unmount.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ConnStatePayload, type PorticoApi, type StatusPayload } from '@shared/ipc.js'
import type { PortForwardStatus, ShelfItem, UpdateStatus } from '@shared/types.js'

const api: PorticoApi = {
  // Lifecycle
  connect: (target) => ipcRenderer.invoke(IPC.CONNECT, target),
  disconnect: () => ipcRenderer.invoke(IPC.DISCONNECT),
  isConnected: () => ipcRenderer.invoke(IPC.IS_CONNECTED),
  // Terminal
  sendInput: (data) => ipcRenderer.send(IPC.TERM_INPUT, data),
  onOutput: (cb) => {
    const h = (_e: IpcRendererEvent, data: string) => cb(data)
    ipcRenderer.on(IPC.TERM_OUTPUT, h)
    return () => ipcRenderer.removeListener(IPC.TERM_OUTPUT, h)
  },
  resize: (cols, rows) => ipcRenderer.send(IPC.TERM_RESIZE, cols, rows),
  // Image bridge
  clipboardHasImage: () => ipcRenderer.invoke(IPC.CLIPBOARD_HAS_IMAGE),
  pasteImage: (args) => ipcRenderer.invoke(IPC.PASTE_IMAGE, args),
  uploadClipboard: () => ipcRenderer.invoke(IPC.UPLOAD_CLIPBOARD),
  pasteRemotePath: (remotePath, prompt) =>
    ipcRenderer.invoke(IPC.PASTE_REMOTE_PATH, { remotePath, prompt }),
  // Session
  getSession: () => ipcRenderer.invoke(IPC.GET_SESSION),
  setProvider: (provider) => ipcRenderer.invoke(IPC.SET_PROVIDER, provider),
  detectProvider: () => ipcRenderer.invoke(IPC.DETECT_PROVIDER),
  // Shelf
  shelfList: () => ipcRenderer.invoke(IPC.SHELF_LIST),
  shelfClear: () => ipcRenderer.invoke(IPC.SHELF_CLEAR),
  onShelfItemUpdated: (cb) => {
    const h = (_e: IpcRendererEvent, item: ShelfItem) => cb(item)
    ipcRenderer.on(IPC.SHELF_ITEM_UPDATED, h)
    return () => ipcRenderer.removeListener(IPC.SHELF_ITEM_UPDATED, h)
  },
  // Remote cache
  clearRemoteCache: () => ipcRenderer.invoke(IPC.CLEAR_REMOTE_CACHE),
  // Connection state
  onConnectionState: (cb) => {
    const h = (_e: IpcRendererEvent, payload: ConnStatePayload) => cb(payload)
    ipcRenderer.on(IPC.CONN_STATE, h)
    return () => ipcRenderer.removeListener(IPC.CONN_STATE, h)
  },
  cancelReconnect: () => ipcRenderer.invoke(IPC.CANCEL_RECONNECT),
  getConnectionState: () => ipcRenderer.invoke(IPC.CONN_STATE),
  // Port forwarding
  addPortForward: (rule) => ipcRenderer.invoke(IPC.PF_ADD, rule),
  removePortForward: (id) => ipcRenderer.invoke(IPC.PF_REMOVE, id),
  listPortForwards: () => ipcRenderer.invoke(IPC.PF_LIST),
  onPortForwardChanged: (cb) => {
    const h = (_e: IpcRendererEvent, forwards: PortForwardStatus[]) => cb(forwards)
    ipcRenderer.on(IPC.PF_CHANGED, h)
    return () => ipcRenderer.removeListener(IPC.PF_CHANGED, h)
  },
  // Status
  onStatus: (cb) => {
    const h = (_e: IpcRendererEvent, s: StatusPayload) => cb(s)
    ipcRenderer.on(IPC.STATUS, h)
    return () => ipcRenderer.removeListener(IPC.STATUS, h)
  },
  // App info & auto-updates
  getAppInfo: () => ipcRenderer.invoke(IPC.GET_APP_INFO),
  checkForUpdates: () => ipcRenderer.invoke(IPC.CHECK_FOR_UPDATES),
  installUpdate: () => ipcRenderer.invoke(IPC.INSTALL_UPDATE),
  onUpdateStatus: (cb) => {
    const h = (_e: IpcRendererEvent, s: UpdateStatus) => cb(s)
    ipcRenderer.on(IPC.UPDATE_STATUS, h)
    return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, h)
  },
  // File pickers
  pickPrivateKey: () => ipcRenderer.invoke(IPC.PICK_PRIVATE_KEY)
}

contextBridge.exposeInMainWorld('portico', api)
