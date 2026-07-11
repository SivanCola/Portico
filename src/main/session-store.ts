/**
 * Persist Portico tab layout across app restarts.
 *
 * Stored under Electron userData as `sessions.json`. Never writes passwords
 * or key passphrases — only host/user/port/alias/key path/agent + tmux name.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SessionId, SessionKind } from '@shared/types.js'

export const SESSION_SNAPSHOT_VERSION = 1 as const

/** Serializable SSH target (no secrets). */
export interface PersistedSshTarget {
  host: string
  user: string
  port: number
  alias?: string
  privateKeyPath?: string
  useAgent?: boolean
}

export interface PersistedSession {
  id: SessionId
  title: string
  /** null/omitted = never connected draft */
  kind?: SessionKind | null
  target?: PersistedSshTarget | null
  /** Last tmux session this tab attached to (remote name). */
  tmuxSession?: string | null
  /**
   * When true, launch will try to reconnect (local shell or SSH+tmux).
   * False for pure drafts or password-only SSH we cannot auto-auth.
   */
  autoConnect: boolean
  /** Whether the user manually renamed the tab (preserve title on reconnect). */
  titleUserSet?: boolean
}

export interface SessionSnapshot {
  version: typeof SESSION_SNAPSHOT_VERSION
  /** Active tab id when last saved (best-effort). */
  activeSessionId?: SessionId | null
  sessions: PersistedSession[]
  /** Master switch — can also be toggled from Settings. */
  restoreOnLaunch: boolean
}

export const DEFAULT_SNAPSHOT: SessionSnapshot = {
  version: SESSION_SNAPSHOT_VERSION,
  sessions: [],
  restoreOnLaunch: true
}

export function snapshotPath(userData: string): string {
  return join(userData, 'sessions.json')
}

export function loadSessionSnapshot(userData: string): SessionSnapshot {
  const path = snapshotPath(userData)
  try {
    if (!existsSync(path)) return { ...DEFAULT_SNAPSHOT }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionSnapshot>
    return normalizeSnapshot(raw)
  } catch {
    return { ...DEFAULT_SNAPSHOT }
  }
}

export async function saveSessionSnapshot(userData: string, snap: SessionSnapshot): Promise<void> {
  const path = snapshotPath(userData)
  try {
    await mkdir(dirname(path), { recursive: true })
    const normalized = normalizeSnapshot(snap)
    await writeFile(path, JSON.stringify(normalized, null, 2), 'utf8')
  } catch {
    /* disk full / permissions — ignore */
  }
}

/** Synchronous variant for process exit only. */
export function saveSessionSnapshotSync(userData: string, snap: SessionSnapshot): void {
  const path = snapshotPath(userData)
  try {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const normalized = normalizeSnapshot(snap)
    writeFileSync(path, JSON.stringify(normalized, null, 2), 'utf8')
  } catch {
    /* disk full / permissions — ignore */
  }
}

export function normalizeSnapshot(raw: Partial<SessionSnapshot> | null | undefined): SessionSnapshot {
  const sessions: PersistedSession[] = []
  const list = Array.isArray(raw?.sessions) ? raw!.sessions : []
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    const id = typeof s.id === 'string' && s.id ? s.id : null
    if (!id) continue
    const title =
      typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 80) : 'Session'
    const kind = s.kind === 'local' || s.kind === 'ssh' ? s.kind : null
    const target = sanitizeTarget(s.target)
    const tmuxSession =
      typeof s.tmuxSession === 'string' && s.tmuxSession.trim()
        ? s.tmuxSession.trim().slice(0, 64)
        : null
    // Can auto-connect local always; SSH only with key or agent (no password store).
    let autoConnect = s.autoConnect === true
    if (kind === 'ssh' && autoConnect) {
      if (!target || (!target.useAgent && !target.privateKeyPath)) {
        autoConnect = false
      }
    }
    if (kind === 'local') {
      /* ok */
    } else if (kind !== 'ssh') {
      autoConnect = false
    }
    sessions.push({
      id,
      title,
      kind,
      target: kind === 'ssh' ? target : null,
      tmuxSession: kind === 'ssh' ? tmuxSession : null,
      autoConnect,
      titleUserSet: s.titleUserSet === true
    })
  }
  return {
    version: SESSION_SNAPSHOT_VERSION,
    activeSessionId:
      typeof raw?.activeSessionId === 'string' ? raw.activeSessionId : null,
    sessions,
    restoreOnLaunch: raw?.restoreOnLaunch !== false
  }
}

function sanitizeTarget(t: unknown): PersistedSshTarget | null {
  if (!t || typeof t !== 'object') return null
  const o = t as Record<string, unknown>
  const host = typeof o.host === 'string' ? o.host.trim() : ''
  const user = typeof o.user === 'string' ? o.user.trim() : ''
  const port = typeof o.port === 'number' && o.port > 0 && o.port < 65536 ? o.port : 22
  if (!host || !user) return null
  const out: PersistedSshTarget = { host, user, port }
  if (typeof o.alias === 'string' && o.alias.trim()) out.alias = o.alias.trim()
  if (typeof o.privateKeyPath === 'string' && o.privateKeyPath.trim()) {
    out.privateKeyPath = o.privateKeyPath.trim()
  }
  if (o.useAgent === true) out.useAgent = true
  return out
}

/** Strip secrets from a live SshTarget for disk. */
export function targetToPersisted(t: {
  host: string
  user: string
  port: number
  alias?: string
  privateKeyPath?: string
  useAgent?: boolean
  password?: string
}): PersistedSshTarget {
  const out: PersistedSshTarget = {
    host: t.host,
    user: t.user,
    port: t.port || 22
  }
  if (t.alias) out.alias = t.alias
  if (t.privateKeyPath) out.privateKeyPath = t.privateKeyPath
  if (t.useAgent) out.useAgent = true
  return out
}

/** Whether this target can be reconnected without a stored password. */
export function canAutoConnectSsh(t: PersistedSshTarget | null | undefined): boolean {
  if (!t) return false
  return !!(t.useAgent || t.privateKeyPath)
}
