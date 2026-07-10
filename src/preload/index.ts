/**
 * Preload script: exposes a minimal, fully-typed `window.portico` API to the
 * renderer via contextBridge. No Node primitives leak across the boundary.
 *
 * Every method mirrors an IPC channel defined in shared/ipc.ts. Listeners are
 * returned as unsubscribe functions so the renderer can clean up on unmount.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ConnStatePayload,
  type PorticoApi,
  type PortForwardChangedPayload,
  type ProviderSessionPayload,
  type ShelfItemPayload,
  type StatusPayload,
  type TermOutputPayload
} from '@shared/ipc.js'
import type { SessionSummary, UpdateStatus } from '@shared/types.js'

const api: PorticoApi = {
  // Multi-session
  createSession: () => ipcRenderer.invoke(IPC.SESSION_CREATE),
  closeSession: (sessionId) => ipcRenderer.invoke(IPC.SESSION_CLOSE, sessionId),
  listSessions: () => ipcRenderer.invoke(IPC.SESSION_LIST),
  renameSession: (sessionId, title) =>
    ipcRenderer.invoke(IPC.SESSION_RENAME, { sessionId, title }),
  onSessionsChanged: (cb) => {
    const h = (_e: IpcRendererEvent, sessions: SessionSummary[]) => cb(sessions)
    ipcRenderer.on(IPC.SESSIONS_CHANGED, h)
    return () => ipcRenderer.removeListener(IPC.SESSIONS_CHANGED, h)
  },
  setActiveSessionId: (sessionId) => ipcRenderer.invoke(IPC.SESSION_SET_ACTIVE, sessionId),
  getRestoreOnLaunch: () => ipcRenderer.invoke(IPC.SESSION_RESTORE_GET),
  setRestoreOnLaunch: (enabled) => ipcRenderer.invoke(IPC.SESSION_RESTORE_SET, enabled),
  restoreConnections: () => ipcRenderer.invoke(IPC.SESSION_RESTORE_NOW),

  // Lifecycle
  connect: (sessionId, target) => ipcRenderer.invoke(IPC.CONNECT, { sessionId, target }),
  connectLocal: (sessionId) => ipcRenderer.invoke(IPC.CONNECT_LOCAL, sessionId),
  disconnect: (sessionId) => ipcRenderer.invoke(IPC.DISCONNECT, sessionId),
  isConnected: (sessionId) => ipcRenderer.invoke(IPC.IS_CONNECTED, sessionId),

  // Terminal
  sendInput: (sessionId, data) => ipcRenderer.send(IPC.TERM_INPUT, sessionId, data),
  onOutput: (cb) => {
    const h = (_e: IpcRendererEvent, payload: TermOutputPayload) => cb(payload)
    ipcRenderer.on(IPC.TERM_OUTPUT, h)
    return () => ipcRenderer.removeListener(IPC.TERM_OUTPUT, h)
  },
  resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.TERM_RESIZE, sessionId, cols, rows),

  // Image bridge — stage then commit
  clipboardHasImage: () => ipcRenderer.invoke(IPC.CLIPBOARD_HAS_IMAGE),
  pasteImage: (args) => ipcRenderer.invoke(IPC.PASTE_IMAGE, args),
  uploadClipboard: (sessionId) => ipcRenderer.invoke(IPC.UPLOAD_CLIPBOARD, sessionId),
  pasteRemotePath: (sessionId, remotePath, prompt) =>
    ipcRenderer.invoke(IPC.PASTE_REMOTE_PATH, { sessionId, remotePath, prompt }),
  uploadLocalImage: (args) => ipcRenderer.invoke(IPC.UPLOAD_LOCAL_IMAGE, args),
  commitStaged: (args) => ipcRenderer.invoke(IPC.COMMIT_STAGED, args),
  pickImageFile: () => ipcRenderer.invoke(IPC.PICK_IMAGE_FILE),
  onPasteImageShortcut: (cb) => {
    const h = () => cb()
    ipcRenderer.on(IPC.SHORTCUT_PASTE_IMAGE, h)
    return () => ipcRenderer.removeListener(IPC.SHORTCUT_PASTE_IMAGE, h)
  },
  onOpenSettings: (cb) => {
    const h = () => cb()
    ipcRenderer.on(IPC.SHORTCUT_OPEN_SETTINGS, h)
    return () => ipcRenderer.removeListener(IPC.SHORTCUT_OPEN_SETTINGS, h)
  },
  onOpenPalette: (cb) => {
    const h = () => cb()
    ipcRenderer.on(IPC.SHORTCUT_OPEN_PALETTE, h)
    return () => ipcRenderer.removeListener(IPC.SHORTCUT_OPEN_PALETTE, h)
  },

  // Provider session
  getSession: (sessionId) => ipcRenderer.invoke(IPC.GET_SESSION, sessionId),
  setProvider: (sessionId, provider) =>
    ipcRenderer.invoke(IPC.SET_PROVIDER, { sessionId, provider }),
  detectProvider: (sessionId) => ipcRenderer.invoke(IPC.DETECT_PROVIDER, sessionId),
  onSessionChanged: (cb) => {
    const h = (_e: IpcRendererEvent, payload: ProviderSessionPayload) => cb(payload)
    ipcRenderer.on(IPC.SESSION_CHANGED, h)
    return () => ipcRenderer.removeListener(IPC.SESSION_CHANGED, h)
  },

  // Shelf
  shelfList: (sessionId) => ipcRenderer.invoke(IPC.SHELF_LIST, sessionId),
  shelfClear: (sessionId) => ipcRenderer.invoke(IPC.SHELF_CLEAR, sessionId),
  shelfRemove: (sessionId, id) => ipcRenderer.invoke(IPC.SHELF_REMOVE, { sessionId, id }),
  onShelfItemUpdated: (cb) => {
    const h = (_e: IpcRendererEvent, payload: ShelfItemPayload) => cb(payload)
    ipcRenderer.on(IPC.SHELF_ITEM_UPDATED, h)
    return () => ipcRenderer.removeListener(IPC.SHELF_ITEM_UPDATED, h)
  },

  // Remote cache
  clearRemoteCache: (sessionId) => ipcRenderer.invoke(IPC.CLEAR_REMOTE_CACHE, sessionId),

  // Connection state
  onConnectionState: (cb) => {
    const h = (_e: IpcRendererEvent, payload: ConnStatePayload) => cb(payload)
    ipcRenderer.on(IPC.CONN_STATE, h)
    return () => ipcRenderer.removeListener(IPC.CONN_STATE, h)
  },
  cancelReconnect: (sessionId) => ipcRenderer.invoke(IPC.CANCEL_RECONNECT, sessionId),
  getConnectionState: (sessionId) => ipcRenderer.invoke(IPC.CONN_STATE, sessionId),

  // Port forwarding
  addPortForward: (sessionId, rule) =>
    ipcRenderer.invoke(IPC.PF_ADD, { sessionId, ...rule }),
  removePortForward: (sessionId, id) =>
    ipcRenderer.invoke(IPC.PF_REMOVE, { sessionId, id }),
  listPortForwards: (sessionId) => ipcRenderer.invoke(IPC.PF_LIST, sessionId),
  onPortForwardChanged: (cb) => {
    const h = (_e: IpcRendererEvent, payload: PortForwardChangedPayload) => cb(payload)
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
  pickPrivateKey: () => ipcRenderer.invoke(IPC.PICK_PRIVATE_KEY),
  // SSH config alias support
  resolveSshAlias: (alias) => ipcRenderer.invoke(IPC.RESOLVE_SSH_ALIAS, alias),
  listSshHosts: () => ipcRenderer.invoke(IPC.LIST_SSH_HOSTS),
  setFeatureFlags: (flags) => ipcRenderer.invoke(IPC.SET_FEATURE_FLAGS, flags),
  getFeatureFlags: () => ipcRenderer.invoke(IPC.GET_FEATURE_FLAGS),
  setTmuxPrefs: (prefs) => ipcRenderer.invoke(IPC.TMUX_SET_PREFS, prefs),
  getTmuxPrefs: () => ipcRenderer.invoke(IPC.TMUX_GET_PREFS),
  listTmuxSessions: (sessionId) => ipcRenderer.invoke(IPC.TMUX_LIST, sessionId),
  enterTmux: (args) => ipcRenderer.invoke(IPC.TMUX_ENTER, args)
}

contextBridge.exposeInMainWorld('portico', api)
