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
 *  - Session-scoped ops take `sessionId` (Portico multi-session).
 */
import type {
  AppInfo,
  ConnectPhase,
  ConnectionState,
  PortForwardRule,
  PortForwardStatus,
  ProviderId,
  ProviderSession,
  Result,
  ResolvedSshTarget,
  SessionId,
  SessionSummary,
  ShelfItem,
  SshHostAlias,
  SshTarget,
  UpdateStatus,
  UploadedBlob
} from './types.js'

export const IPC = {
  // Multi-session lifecycle
  SESSION_CREATE: 'portico:session:create',
  SESSION_CLOSE: 'portico:session:close',
  SESSION_LIST: 'portico:session:list',
  SESSION_RENAME: 'portico:session:rename',
  /** One-way: main pushes full session list when membership/title changes. */
  SESSIONS_CHANGED: 'portico:sessions:changed',

  // Connection lifecycle (scoped)
  CONNECT: 'portico:connect',
  CONNECT_LOCAL: 'portico:connectLocal',
  DISCONNECT: 'portico:disconnect',
  IS_CONNECTED: 'portico:isConnected',

  // Terminal data pump (scoped)
  TERM_INPUT: 'portico:term:input',
  TERM_OUTPUT: 'portico:term:output',
  TERM_RESIZE: 'portico:term:resize',

  // Image bridge
  CLIPBOARD_HAS_IMAGE: 'portico:clipboard:hasImage',
  PASTE_IMAGE: 'portico:pasteImage',
  UPLOAD_CLIPBOARD: 'portico:uploadClipboard',
  PASTE_REMOTE_PATH: 'portico:pasteRemotePath',
  /**
   * One-way main → renderer: fire the paste-image UI.
   * Emitted from main `before-input-event` so ⌘⇧V is not stolen by Electron's
   * default "Paste and Match Style" menu accelerator.
   */
  SHORTCUT_PASTE_IMAGE: 'portico:shortcut:pasteImage',
  /** One-way main → renderer: open the settings center. */
  SHORTCUT_OPEN_SETTINGS: 'portico:shortcut:openSettings',
  /** One-way main → renderer: toggle the command palette. */
  SHORTCUT_OPEN_PALETTE: 'portico:shortcut:openPalette',

  // Provider / session control (AI provider — not SSH session)
  GET_SESSION: 'portico:getSession',
  SET_PROVIDER: 'portico:setProvider',
  DETECT_PROVIDER: 'portico:detectProvider',
  /** One-way: main pushes ProviderSession when auto-detect / setProvider changes it. */
  SESSION_CHANGED: 'portico:session:changed',

  // Shelf
  SHELF_LIST: 'portico:shelf:list',
  SHELF_CLEAR: 'portico:shelf:clear',
  SHELF_REMOVE: 'portico:shelf:remove',
  SHELF_ITEM_UPDATED: 'portico:shelf:item-updated',

  // Local image file upload (drag/drop or picker)
  UPLOAD_LOCAL_IMAGE: 'portico:uploadLocalImage',
  PICK_IMAGE_FILE: 'portico:dialog:pickImageFile',

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
  PICK_PRIVATE_KEY: 'portico:dialog:pickPrivateKey',

  // SSH config (~/.ssh/config) alias resolution + host listing
  RESOLVE_SSH_ALIAS: 'portico:ssh:resolveAlias',
  LIST_SSH_HOSTS: 'portico:ssh:listHosts',

  // Runtime feature flags (terminal-only / L2 isolation)
  SET_FEATURE_FLAGS: 'portico:flags:set',
  GET_FEATURE_FLAGS: 'portico:flags:get',

  // Remote tmux (list / enter / prefs)
  TMUX_SET_PREFS: 'portico:tmux:setPrefs',
  TMUX_GET_PREFS: 'portico:tmux:getPrefs',
  TMUX_LIST: 'portico:tmux:list',
  TMUX_ENTER: 'portico:tmux:enter'
} as const

/** L2 capability toggles — must never tear down the SSH PTY. */
export interface FeatureFlagsPayload {
  imageBridge: boolean
  portForwards: boolean
  providerDetect: boolean
  autoUpdate: boolean
}

/** How Portico should auto-enter remote tmux after SSH connect. */
export type TmuxEnterMode = 'off' | 'attach-if-exists' | 'always'

export interface TmuxPrefsPayload {
  mode: TmuxEnterMode
  sessionName: string
  /** Remote copy → Mac clipboard (OSC 52 + auto-configure tmux). */
  syncRemoteClipboard: boolean
}

export interface TmuxSessionPayload {
  name: string
  windows: number
  attached: boolean
}

export interface TmuxEnterArgs {
  sessionId: SessionId
  mode?: TmuxEnterMode
  sessionName?: string
  attachOnly?: string
  createNew?: string
}

/** Args passed to PASTE_IMAGE. */
export interface PasteImageArgs {
  sessionId: SessionId
  prompt?: string
  /** Override the auto-detected provider for this paste. */
  provider?: ProviderId
}

/** Connection result payload. */
export interface ConnectResult {
  connected: boolean
  sessionId: SessionId
  initialCwd?: string
}

/** Status push from main -> renderer. */
export interface StatusPayload {
  level: 'info' | 'warn' | 'error'
  message: string
  /** Auto-clear after ms; omit to persist. */
  ttlMs?: number
  sessionId?: SessionId
}

/** Connection state push from main -> renderer. */
export interface ConnStatePayload {
  sessionId: SessionId
  state: ConnectionState
  attempt?: number
  nextRetryIn?: number
  reason?: string
  /** Fine-grained phase while connecting. */
  phase?: ConnectPhase
  user?: string
  host?: string
  alias?: string
}

/** Terminal output chunk (scoped). */
export interface TermOutputPayload {
  sessionId: SessionId
  data: string
}

/** Provider session push (scoped). */
export interface ProviderSessionPayload {
  sessionId: SessionId
  session: ProviderSession
}

/** Shelf item push (scoped). */
export interface ShelfItemPayload {
  sessionId: SessionId
  item: ShelfItem
}

/** Port-forward list push (scoped). */
export interface PortForwardChangedPayload {
  sessionId: SessionId
  forwards: PortForwardStatus[]
}

/** Args for uploading a local image file (path on disk). */
export interface UploadLocalImageArgs {
  sessionId: SessionId
  path: string
  prompt?: string
  /** When true, inject provider prompt after upload (default true). */
  inject?: boolean
  provider?: ProviderId
}

export interface ConnectArgs {
  sessionId: SessionId
  target: SshTarget
}

export interface SessionRenameArgs {
  sessionId: SessionId
  title: string
}

/**
 * The typed API the preload script exposes to the renderer via contextBridge.
 * Every method mirrors an IPC channel and returns a Result.
 */
export interface PorticoApi {
  // Multi-session
  createSession(): Promise<Result<SessionSummary>>
  closeSession(sessionId: SessionId): Promise<Result<true>>
  listSessions(): Promise<Result<SessionSummary[]>>
  renameSession(sessionId: SessionId, title: string): Promise<Result<SessionSummary>>
  onSessionsChanged(cb: (sessions: SessionSummary[]) => void): () => void

  // Lifecycle
  connect(sessionId: SessionId, target: SshTarget): Promise<Result<ConnectResult>>
  /** Spawn a local interactive shell ($SHELL) for this session tab. */
  connectLocal(sessionId: SessionId): Promise<Result<ConnectResult>>
  disconnect(sessionId: SessionId): Promise<Result<true>>
  isConnected(sessionId: SessionId): Promise<Result<boolean>>

  // Terminal
  sendInput(sessionId: SessionId, data: string): void
  onOutput(cb: (payload: TermOutputPayload) => void): () => void
  resize(sessionId: SessionId, cols: number, rows: number): void

  // Image bridge
  clipboardHasImage(): Promise<Result<boolean>>
  pasteImage(args: PasteImageArgs): Promise<Result<UploadedBlob>>
  uploadClipboard(sessionId: SessionId): Promise<Result<UploadedBlob>>
  pasteRemotePath(sessionId: SessionId, remotePath: string, prompt?: string): Promise<Result<true>>
  uploadLocalImage(args: UploadLocalImageArgs): Promise<Result<UploadedBlob>>
  pickImageFile(): Promise<Result<string | null>>
  /** Main process fires this when the user hits the paste-image accelerator. */
  onPasteImageShortcut(cb: () => void): () => void
  onOpenSettings(cb: () => void): () => void
  onOpenPalette(cb: () => void): () => void

  // Provider (AI) session
  getSession(sessionId: SessionId): Promise<Result<ProviderSession>>
  setProvider(sessionId: SessionId, provider: ProviderId): Promise<Result<ProviderSession>>
  detectProvider(sessionId: SessionId): Promise<Result<ProviderId>>
  onSessionChanged(cb: (payload: ProviderSessionPayload) => void): () => void

  // Shelf
  shelfList(sessionId: SessionId): Promise<Result<ShelfItem[]>>
  shelfClear(sessionId: SessionId): Promise<Result<true>>
  shelfRemove(sessionId: SessionId, id: string): Promise<Result<true>>
  onShelfItemUpdated(cb: (payload: ShelfItemPayload) => void): () => void

  // Remote cache
  clearRemoteCache(sessionId: SessionId): Promise<Result<{ deleted: number }>>

  // Connection state
  onConnectionState(cb: (payload: ConnStatePayload) => void): () => void
  getConnectionState(sessionId: SessionId): Promise<
    Result<{ state: ConnectionState; user?: string; host?: string; alias?: string; sessionId: SessionId }>
  >
  cancelReconnect(sessionId: SessionId): Promise<Result<true>>

  // Port forwarding
  addPortForward(
    sessionId: SessionId,
    rule: { localPort: number; remoteHost: string; remotePort: number }
  ): Promise<Result<PortForwardRule>>
  removePortForward(sessionId: SessionId, id: string): Promise<Result<true>>
  listPortForwards(sessionId: SessionId): Promise<Result<PortForwardStatus[]>>
  onPortForwardChanged(cb: (payload: PortForwardChangedPayload) => void): () => void

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

  // SSH config alias support
  resolveSshAlias(alias: string): Promise<Result<ResolvedSshTarget>>
  listSshHosts(): Promise<Result<SshHostAlias[]>>

  setFeatureFlags(flags: Partial<FeatureFlagsPayload>): Promise<Result<FeatureFlagsPayload>>
  getFeatureFlags(): Promise<Result<FeatureFlagsPayload>>

  setTmuxPrefs(prefs: Partial<TmuxPrefsPayload>): Promise<Result<TmuxPrefsPayload>>
  getTmuxPrefs(): Promise<Result<TmuxPrefsPayload>>
  listTmuxSessions(sessionId: SessionId): Promise<Result<TmuxSessionPayload[]>>
  enterTmux(args: TmuxEnterArgs): Promise<Result<TmuxEnterResult>>
}

export interface TmuxEnterResult {
  action: string
  session: string
}
