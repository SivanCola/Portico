/**
 * Shared types used across main / preload / renderer.
 */
import type { ImageExt } from './constants.js'
import type { ReleaseChannel, UpdateChannel } from './channel.js'

/** Identifiers for the AI coding providers Portico knows how to target. */
export type ProviderId = 'claude' | 'codex' | 'shell'

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
}

/** What a provider adapter needs to decide how to format a reference. */
export interface ProviderSession {
  /** The provider Portico believes is active, either detected or user-forced. */
  provider: ProviderId
  /**
   * Whether the user is inside an interactive CLI session (vs bare shell
   * command mode). MVP always runs an interactive PTY, so this stays `true`
   * unless a future build detects a non-interactive invocation. Codex's
   * `codex -i` formatting is reserved for `interactive: false`.
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

/** An entry in the Image Shelf. */
export interface ShelfItem {
  id: string
  remotePath: string
  hash: string
  ext: ImageExt
  bytes: number
  prompt?: string
  /** ISO timestamp of upload. */
  uploadedAt: string
  previewUrl?: string
  status: 'ready' | 'uploading' | 'failed'
  error?: string
}

/** Connection lifecycle state. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** Definition of a single local-to-remote port forward. */
export interface PortForwardRule {
  id: string
  localPort: number
  remoteHost: string
  remotePort: number
}

/** Runtime status of a port forward. */
export interface PortForwardStatus extends PortForwardRule {
  state: 'listening' | 'error' | 'stopped'
  activeConnections: number
  error?: string
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
