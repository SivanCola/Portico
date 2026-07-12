/**
 * Shared types used across main / preload / renderer.
 */
import type { ImageExt } from './constants.js'
import type { ReleaseChannel, UpdateChannel } from './channel.js'

/** Identifiers for the AI coding providers Portico knows how to target. */
export type ProviderId = 'claude' | 'codex' | 'shell'

/** How the user authenticates to the SSH host. */
export type AuthMode = 'password' | 'key' | 'agent'

/** A connection target plus optional credentials. */
export interface SshTarget {
  id: string
  /** User@host, e.g. "ubuntu@10.0.0.4". Empty host portion is invalid. */
  host: string
  user: string
  port: number
  /** Plaintext password, when used. Never serialized to disk in MVP. */
  password?: string
  /** Absolute path to a private key file, when used. */
  privateKeyPath?: string
  /** Passphrase for the private key, when needed. */
  privateKeyPassphrase?: string
  /**
   * Use the local SSH agent (`SSH_AUTH_SOCK`). When true, password/key are
   * ignored unless the agent cannot authenticate.
   */
  useAgent?: boolean
  /**
   * The SSH alias the user typed (e.g. `noban-vm`), when the host was resolved
   * from `~/.ssh/config`. `host` holds the real HostName; `alias` is purely for
   * display (top bar, recent targets) so the user sees what they typed.
   */
  alias?: string
}

/**
 * Result of expanding an SSH alias via `~/.ssh/config`. Returned by the
 * `resolveSshAlias` IPC so the renderer can fill in real host/port/user/key
 * without the main process needing to know the connection form's structure.
 */
export interface ResolvedSshTarget {
  /** True when at least one `Host` block matched the alias. */
  matched: boolean
  /** Real address (HostName if present, otherwise the alias verbatim). */
  host: string
  user?: string
  port: number
  identityFile?: string
  /** The alias as the user typed it, echoed back for display. */
  alias: string
}

/** A picker-friendly summary of one configured SSH host alias. */
export interface SshHostAlias {
  alias: string
  /** Real HostName when known, for the dropdown's secondary line. */
  hostName?: string
  port?: number
  user?: string
}

/** What a provider adapter needs to decide how to format a reference. */
export interface ProviderSession {
  /** The provider Portico believes is active, either detected or user-forced. */
  provider: ProviderId
  /**
   * Whether the user is inside an interactive CLI session (vs bare shell
   * command mode). MVP always runs an interactive PTY, so this stays `true`.
   * Codex's `codex -i` formatting is reserved for `interactive: false` and is
   * exercised in unit tests / future non-interactive paths.
   */
  interactive: boolean
  /** Whether the adapter may attempt native clipboard-image paste. */
  nativePasteAvailable: boolean
}

/** A normalized image ready for upload (a Buffer of PNG/JPEG bytes + metadata). */
export interface NormalizedImage {
  data: Buffer
  ext: ImageExt
  mime: string
  width?: number
  height?: number
  /** Original filename when the source was a copied file, if known. */
  originalName?: string
}

/** Result of a successful remote upload. */
export interface UploadedBlob {
  /** Absolute/tilde remote path, e.g. "~/.portico/blobs/abc.png". */
  remotePath: string
  /** Content hash (sha256 hex) of the bytes that were uploaded. */
  hash: string
  ext: ImageExt
  bytes: number
  /** Local data URL for preview in the shelf (renderer-only). */
  previewUrl?: string
}

/**
 * Shelf item lifecycle:
 *  - `staged` — local only (⌘⇧V / drop); bytes held in main until commit
 *  - `uploading` — commit in progress
 *  - `ready` — uploaded to remote blob store
 *  - `failed` — last upload attempt failed
 */
export type ShelfItemStatus = 'staged' | 'uploading' | 'ready' | 'failed'

/** An entry in the Image Shelf. */
export interface ShelfItem {
  id: string
  remotePath: string
  hash: string
  ext: ImageExt
  bytes: number
  prompt?: string
  /** ISO timestamp of stage or upload. */
  uploadedAt: string
  previewUrl?: string
  status: ShelfItemStatus
  error?: string
  /**
   * Local filesystem path when the item came from a file upload (not clipboard).
   * Kept so a failed upload can be retried against the same file.
   */
  sourcePath?: string
}

/** Runtime id for one Portico tab/session (not SshTarget.id). */
export type SessionId = string

/** How the session is backed: local PTY vs SSH. */
export type SessionKind = 'local' | 'ssh'

/** Connection lifecycle state. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** Sidebar / list row for one Portico session. */
export interface SessionSummary {
  id: SessionId
  /** Display title (editable); default alias, user@host, or local shell name. */
  title: string
  /** Backend kind; omitted/undefined on pure drafts before first connect. */
  kind?: SessionKind
  target?: {
    user: string
    host: string
    port: number
    alias?: string
  }
  /** Local shell path basename when kind === 'local'. */
  shell?: string
  state: ConnectionState
  phase?: ConnectPhase
  provider: ProviderId
  /** True when non-active session produced output (renderer-owned; main may omit). */
  unread: boolean
  createdAt: string
}

/** Fine-grained phase while `connecting` (shown in the connection form). */
export type ConnectPhase =
  | 'resolving'
  | 'tcp'
  | 'auth'
  | 'shell'
  | 'home'
  | 'ready'

/**
 * Port-forward direction (OpenSSH equivalents):
 *  - `local`   ≈ `-L`  (this machine listens → tunnel to remote host:port)
 *  - `remote`  ≈ `-R`  (remote listens → tunnel back to a service on this machine)
 *  - `dynamic` ≈ `-D`  (this machine runs a SOCKS5 proxy; destinations chosen per request)
 */
export type PortForwardDirection = 'local' | 'remote' | 'dynamic'

/** Definition of a single port-forward rule (persisted + live). */
export interface PortForwardRule {
  id: string
  direction: PortForwardDirection
  /**
   * Port on this machine:
   *  - local / dynamic: listen port (0 = auto-assign an ephemeral port)
   *  - remote: local destination port the reverse tunnel connects to
   */
  localPort: number
  /**
   * For local: destination host as seen from the SSH server (often 127.0.0.1).
   * For remote: bind address on the SSH server (often 127.0.0.1).
   * For dynamic: unused (stored as `socks5` for display).
   */
  remoteHost: string
  /**
   * For local: destination port on remoteHost.
   * For remote: listen port on the SSH server.
   * For dynamic: unused (0).
   */
  remotePort: number
  /**
   * For local / dynamic: local listen address (default 127.0.0.1; 0.0.0.0 exposes LAN).
   * For remote: local destination host (default 127.0.0.1).
   */
  bindHost?: string
  /** Optional user label (e.g. "Vite", "Claude preview"). */
  label?: string
  /** When false the rule is kept but not actively listening/forwarding. */
  enabled: boolean
}

/** Runtime status of a port forward. */
export interface PortForwardStatus extends PortForwardRule {
  state: 'listening' | 'error' | 'stopped' | 'paused'
  activeConnections: number
  error?: string
  /**
   * Actual local listen port after auto-assign (local / dynamic).
   * Equals localPort when localPort was non-zero.
   */
  effectiveLocalPort?: number
  /** Last per-connection tunnel error (does not force rule into error). */
  lastConnectError?: string
  /** Bytes from local client → remote (this session lifetime). */
  bytesUp: number
  /** Bytes from remote → local client (this session lifetime). */
  bytesDown: number
}

/** Standardized error shape crossing the IPC boundary. */
export interface PorticoError {
  code: string
  message: string
}

/** Discriminated result so IPC callers can avoid try/catch across the bridge. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: PorticoError }

/**
 * Static info about the running app, surfaced to the renderer for the top bar
 * (beta badge + version) and for update UI gating.
 */
export interface AppInfo {
  name: string
  version: string
  releaseChannel: ReleaseChannel
  updateChannel: UpdateChannel
  isPackaged: boolean
}

/** Coarse lifecycle state of the auto-updater. */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

/** Pushed by the updater service and shown in the renderer status banner. */
export interface UpdateStatus {
  state: UpdateState
  /** Version of the available/downloaded update, when known. */
  version?: string
  /** Download progress 0-100, while downloading. */
  percent?: number
  /** Human-readable detail (e.g. an error message). */
  message?: string
}
