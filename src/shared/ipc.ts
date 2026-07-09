/**
 * IPC channel names and payload shapes.
 *
 * The main process registers handlers for every channel listed here, and the
 * preload script exposes a typed mirror of the same surface to the renderer.
 *
 * Conventions:
 *  - One-way (main -> renderer) events live under `events`.
 *  - Request/response (renderer -> main) calls live under `channels` and use
 *    `Result<T>` so failures are values, not thrown exceptions.
 */
import type {
  AppInfo,
  ConnectionState,
  PortForwardRule,
  PortForwardStatus,
  ProviderId,
  ProviderSession,
  Result,
  ShelfItem,
  SshTarget,
  UpdateStatus,
  UploadedBlob
} from './types.js'

export const IPC = {
  // Connection lifecycle
  CONNECT: 'portico:connect',
  DISCONNECT: 'portico:disconnect',
  IS_CONNECTED: 'portico:isConnected',

  // Terminal data pump
  TERM_INPUT: 'portico:term:input',
  TERM_OUTPUT: 'portico:term:output',
  TERM_RESIZE: 'portico:term:resize',

  // Image bridge
  CLIPBOARD_HAS_IMAGE: 'portico:clipboard:hasImage',
  PASTE_IMAGE: 'portico:pasteImage',
  UPLOAD_CLIPBOARD: 'portico:uploadClipboard',
  PASTE_REMOTE_PATH: 'portico:pasteRemotePath',

  // Provider / session control
  GET_SESSION: 'portico:getSession',
  SET_PROVIDER: 'portico:setProvider',
  DETECT_PROVIDER: 'portico:detectProvider',

  // Shelf
  SHELF_LIST: 'portico:shelf:list',
  SHELF_ADD: 'portico:shelf:add',
  SHELF_CLEAR: 'portico:shelf:clear',
  SHELF_ITEM_UPDATED: 'portico:shelf:item-updated',

  // Remote cache maintenance
  CLEAR_REMOTE_CACHE: 'portico:cache:clear',

  // Connection state
  CONN_STATE: 'portico:conn:state',
  CANCEL_RECONNECT: 'portico:reconnect:cancel',

  // Port forwarding
  PF_ADD: 'portico:pf:add',
  PF_REMOVE: 'portico:pf:remove',
  PF_LIST: 'portico:pf:list',
  PF_CHANGED: 'portico:pf:changed',

  // Status banner
  STATUS: 'portico:status',

  // App info & updates
  GET_APP_INFO: 'portico:appInfo',
  CHECK_FOR_UPDATES: 'portico:updates:check',
  INSTALL_UPDATE: 'portico:updates:install',
  UPDATE_STATUS: 'portico:updates:status',

  // File pickers
  PICK_PRIVATE_KEY: 'portico:dialog:pickPrivateKey'
} as const

/** Args passed to PASTE_IMAGE. */
export interface PasteImageArgs {
  prompt?: string
  /** Override the auto-detected provider for this paste. */
  provider?: ProviderId
}

/** Connection result payload. */
export interface ConnectResult {
  connected: boolean
  initialCwd?: string
}

/** Status push from main -> renderer. */
export interface StatusPayload {
  level: 'info' | 'warn' | 'error'
  message: string
  /** Auto-clear after ms; omit to persist. */
  ttlMs?: number
}

/** Connection state push from main -> renderer. */
export interface ConnStatePayload {
  state: ConnectionState
  attempt?: number
  nextRetryIn?: number
  reason?: string
}

/**
 * The typed API the preload script exposes to the renderer via contextBridge.
 * Every method mirrors an IPC channel and returns a Result.
 */
export interface PorticoApi {
  // Lifecycle
  connect(target: SshTarget): Promise<Result<ConnectResult>>
  disconnect(): Promise<Result<true>>
  isConnected(): Promise<Result<boolean>>

  // Terminal
  sendInput(data: string): void
  onOutput(cb: (data: string) => void): () => void
  resize(cols: number, rows: number): void

  // Image bridge
  clipboardHasImage(): Promise<Result<boolean>>
  pasteImage(args: PasteImageArgs): Promise<Result<UploadedBlob>>
  uploadClipboard(): Promise<Result<UploadedBlob>>
  pasteRemotePath(remotePath: string, prompt?: string): Promise<Result<true>>

  // Session
  getSession(): Promise<Result<ProviderSession>>
  setProvider(provider: ProviderId): Promise<Result<ProviderSession>>
  detectProvider(): Promise<Result<ProviderId>>

  // Shelf
  shelfList(): Promise<Result<ShelfItem[]>>
  shelfClear(): Promise<Result<true>>
  onShelfItemUpdated(cb: (item: ShelfItem) => void): () => void

  // Remote cache
  clearRemoteCache(): Promise<Result<{ deleted: number }>>

  // Connection state
  onConnectionState(cb: (payload: ConnStatePayload) => void): () => void
  getConnectionState(): Promise<Result<{ state: ConnectionState; user?: string; host?: string }>>
  cancelReconnect(): Promise<Result<true>>

  // Port forwarding
  addPortForward(rule: { localPort: number; remoteHost: string; remotePort: number }): Promise<Result<PortForwardRule>>
  removePortForward(id: string): Promise<Result<true>>
  listPortForwards(): Promise<Result<PortForwardStatus[]>>
  onPortForwardChanged(cb: (forwards: PortForwardStatus[]) => void): () => void

  // Status
  onStatus(cb: (s: StatusPayload) => void): () => void

  // App info & auto-updates
  getAppInfo(): Promise<Result<AppInfo>>
  checkForUpdates(): Promise<Result<UpdateStatus>>
  installUpdate(): Promise<Result<true>>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void

  // File pickers
  /** Open a native dialog to pick an SSH private key; null if cancelled. */
  pickPrivateKey(): Promise<Result<string | null>>
}
