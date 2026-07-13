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
  PortForwardDirection,
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
import type { DetectedPort } from './port-detect.js'

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

  // Image bridge (stage locally → commit on Enter)
  CLIPBOARD_HAS_IMAGE: 'portico:clipboard:hasImage',
  /** Stage clipboard image(s) locally — no upload until commitStaged. */
  PASTE_IMAGE: 'portico:pasteImage',
  /** Stage clipboard image(s) without inject (same as stage; kept for palette). */
  UPLOAD_CLIPBOARD: 'portico:uploadClipboard',
  PASTE_REMOTE_PATH: 'portico:pasteRemotePath',
  /** Upload all staged images, inject paths, optionally submit (Enter) to Claude. */
  COMMIT_STAGED: 'portico:commitStaged',
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

  // Local image file stage (drag/drop or picker) — no upload until commit
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
  PF_SET_ENABLED: 'portico:pf:setEnabled',
  PF_OPEN: 'portico:pf:open',
  PF_DETECTED_LIST: 'portico:pf:detectedList',
  PF_DETECTED_CHANGED: 'portico:pf:detectedChanged',
  PF_DISMISS_DETECTED: 'portico:pf:dismissDetected',
  PF_RESET_STATS: 'portico:pf:resetStats',

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
  TMUX_ENTER: 'portico:tmux:enter',

  // Session layout persistence (SSH + tmux restore across launches)
  SESSION_RESTORE_GET: 'portico:session:restoreGet',
  SESSION_RESTORE_SET: 'portico:session:restoreSet',
  SESSION_SET_ACTIVE: 'portico:session:setActive',
  SESSION_RESTORE_NOW: 'portico:session:restoreNow',
  /** Cancel remaining auto-connects in a launch restore wave. */
  SESSION_RESTORE_CANCEL: 'portico:session:restoreCancel'
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

/** Args passed to PASTE_IMAGE (stage clipboard; prompt ignored until commit). */
export interface PasteImageArgs {
  sessionId: SessionId
  /** @deprecated Staging does not use prompt; pass it to commitStaged instead. */
  prompt?: string
  /** Override the auto-detected provider for this paste (applied at commit if set). */
  provider?: ProviderId
}

/** Upload every staged image and inject into the remote AI. */
export interface CommitStagedArgs {
  sessionId: SessionId
  prompt?: string
  provider?: ProviderId
  /** Inject provider path text into the terminal (default true). */
  inject?: boolean
  /**
   * After inject, send Enter (CR) so interactive Claude/Codex submits the prompt.
   * Default true when inject is true; ignored for shell.
   */
  submit?: boolean
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

/** Detected remote ports from terminal output (scoped). */
export interface DetectedPortsPayload {
  sessionId: SessionId
  ports: DetectedPort[]
}

/** Args for adding a port-forward rule. */
export interface PortForwardAddArgs {
  sessionId: SessionId
  localPort: number
  remoteHost: string
  remotePort: number
  direction?: PortForwardDirection
  bindHost?: string
  label?: string
  enabled?: boolean
}

/** Args for staging one or more local image files (paths on disk). */
export interface UploadLocalImageArgs {
  sessionId: SessionId
  /** Single path or multiple (Finder multi-drop / multi-pick). */
  path: string | string[]
  /** @deprecated Staging does not upload; use commitStaged. */
  prompt?: string
  /** @deprecated Staging never injects; use commitStaged. */
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
  /** Remember active tab for next launch. */
  setActiveSessionId(sessionId: SessionId | null): Promise<Result<true>>
  /** Whether launch restores saved SSH/tmux tabs. */
  getRestoreOnLaunch(): Promise<Result<boolean>>
  setRestoreOnLaunch(enabled: boolean): Promise<Result<boolean>>
  /** Trigger auto-reconnect of saved sessions (once per process). */
  restoreConnections(): Promise<Result<true>>
  /** Stop remaining auto-connects during a launch restore wave. */
  cancelSessionRestore(): Promise<Result<true>>

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

  // Image bridge — stage locally, then commitStaged (Enter) to upload + send
  clipboardHasImage(): Promise<Result<boolean>>
  /** Stage clipboard image(s) locally. Does not upload until commitStaged. */
  pasteImage(args: PasteImageArgs): Promise<Result<ShelfItem[]>>
  /** Stage clipboard image(s) (same as pasteImage; palette label may differ). */
  uploadClipboard(sessionId: SessionId): Promise<Result<ShelfItem[]>>
  pasteRemotePath(sessionId: SessionId, remotePath: string, prompt?: string): Promise<Result<true>>
  /** Stage one or more local image files. Does not upload until commitStaged. */
  uploadLocalImage(args: UploadLocalImageArgs): Promise<Result<ShelfItem[]>>
  /** Upload all staged images, inject path prompt, optionally submit (Enter). */
  commitStaged(args: CommitStagedArgs): Promise<Result<UploadedBlob[]>>
  /** Image file picker (multi-select). Returns null when cancelled. */
  pickImageFile(): Promise<Result<string[] | null>>
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
    rule: {
      localPort: number
      remoteHost: string
      remotePort: number
      direction?: PortForwardDirection
      bindHost?: string
      label?: string
      enabled?: boolean
    }
  ): Promise<Result<PortForwardRule>>
  removePortForward(sessionId: SessionId, id: string): Promise<Result<true>>
  setPortForwardEnabled(
    sessionId: SessionId,
    id: string,
    enabled: boolean
  ): Promise<Result<PortForwardRule>>
  listPortForwards(sessionId: SessionId): Promise<Result<PortForwardStatus[]>>
  openPortForward(sessionId: SessionId, id: string): Promise<Result<true>>
  listDetectedPorts(sessionId: SessionId): Promise<Result<DetectedPort[]>>
  dismissDetectedPort(sessionId: SessionId, port: number): Promise<Result<true>>
  /** Reset byte counters for one rule (or all when id omitted). */
  resetPortForwardStats(sessionId: SessionId, id?: string): Promise<Result<true>>
  onPortForwardChanged(cb: (payload: PortForwardChangedPayload) => void): () => void
  onDetectedPortsChanged(cb: (payload: DetectedPortsPayload) => void): () => void

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
