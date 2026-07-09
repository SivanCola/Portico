import { useState } from 'react'
import type { AuthMode, ConnectPhase, SshTarget } from '@shared/types.js'

interface Props {
  onConnect: (t: SshTarget) => Promise<string | null>
  /** Live connect phase from main while busy. */
  phase?: ConnectPhase | null
}

/** A saved connection target. Credentials are never persisted. */
interface RecentTarget {
  host: string
  user: string
  port: number
  auth: AuthMode
  privateKeyPath?: string
}

const RECENT_KEY = 'portico.recentTargets'
const RECENT_MAX = 5

const PHASE_LABEL: Record<ConnectPhase, string> = {
  resolving: 'Preparing…',
  tcp: 'Connecting…',
  auth: 'Authenticating…',
  shell: 'Opening shell…',
  home: 'Resolving home…',
  ready: 'Ready'
}

function loadRecent(): RecentTarget[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

function saveRecent(t: RecentTarget): RecentTarget[] {
  const key = `${t.user}@${t.host}:${t.port}`
  const next = [t, ...loadRecent().filter((r) => `${r.user}@${r.host}:${r.port}` !== key)].slice(
    0,
    RECENT_MAX
  )
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage may be unavailable; history is best-effort */
  }
  return next
}

function parseUserHost(raw: string): { user?: string; host: string } {
  const s = raw.trim()
  const at = s.lastIndexOf('@')
  if (at > 0) return { user: s.slice(0, at), host: s.slice(at + 1) }
  return { host: s }
}

export function ConnectionForm({ onConnect, phase }: Props) {
  const [host, setHost] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState(22)
  const [auth, setAuth] = useState<AuthMode>('password')
  const [password, setPassword] = useState('')
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentTarget[]>(loadRecent)

  const fillFrom = (r: RecentTarget) => {
    setHost(r.host)
    setUser(r.user)
    setPort(r.port)
    setAuth(r.auth)
    setPrivateKeyPath(r.privateKeyPath ?? '')
    setError(null)
  }

  const onHostBlur = () => {
    const parsed = parseUserHost(host)
    if (parsed.user) {
      setUser(parsed.user)
      setHost(parsed.host)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const parsed = parseUserHost(host)
    const finalUser = (parsed.user || user).trim()
    const finalHost = parsed.host.trim()
    const target: SshTarget = {
      id: `${finalUser}@${finalHost}`,
      host: finalHost,
      user: finalUser,
      port: Number(port) || 22,
      password: auth === 'password' ? password || undefined : undefined,
      privateKeyPath: auth === 'key' ? privateKeyPath || undefined : undefined,
      privateKeyPassphrase: auth === 'key' ? passphrase || undefined : undefined,
      useAgent: auth === 'agent' ? true : undefined
    }
    const err = await onConnect(target)
    setBusy(false)
    if (err) {
      setError(err)
    } else {
      setRecent(
        saveRecent({
          host: target.host,
          user: target.user,
          port: target.port,
          auth,
          privateKeyPath: auth === 'key' ? privateKeyPath || undefined : undefined
        })
      )
    }
  }

  const canSubmit =
    !busy &&
    !!host.trim() &&
    !!(user.trim() || host.includes('@')) &&
    (auth === 'agent' ||
      (auth === 'password' && !!password) ||
      (auth === 'key' && !!privateKeyPath))

  return (
    <form className="connect-card" onSubmit={submit}>
      <h2>Connect to a host</h2>
      {recent.length > 0 && (
        <div className="recent">
          {recent.map((r) => (
            <button
              type="button"
              key={`${r.user}@${r.host}:${r.port}`}
              className="recent-chip"
              onClick={() => fillFrom(r)}
              title={`${r.user}@${r.host}:${r.port} (${r.auth})`}
            >
              {r.user}@{r.host}
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <label>Host</label>
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onBlur={onHostBlur}
          placeholder="ubuntu@10.0.0.4 or hostname"
          autoFocus
          spellCheck={false}
        />
      </div>
      <div className="row">
        <div className="field">
          <label>User</label>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="ubuntu" spellCheck={false} />
        </div>
        <div className="field" style={{ maxWidth: 90 }}>
          <label>Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            min={1}
            max={65535}
          />
        </div>
      </div>
      <div className="auth-toggle">
        <button
          type="button"
          className={`btn ghost ${auth === 'password' ? 'primary' : ''}`}
          onClick={() => setAuth('password')}
        >
          Password
        </button>
        <button
          type="button"
          className={`btn ghost ${auth === 'key' ? 'primary' : ''}`}
          onClick={() => setAuth('key')}
        >
          Private key
        </button>
        <button
          type="button"
          className={`btn ghost ${auth === 'agent' ? 'primary' : ''}`}
          onClick={() => setAuth('agent')}
        >
          SSH agent
        </button>
      </div>
      {auth === 'password' ? (
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
      ) : auth === 'key' ? (
        <>
          <div className="field">
            <label>Private key path</label>
            <div className="path-row">
              <input
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
                placeholder="~/.ssh/id_ed25519"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn ghost"
                onClick={async () => {
                  const r = await window.portico.pickPrivateKey()
                  if (r.ok && r.value) setPrivateKeyPath(r.value)
                }}
              >
                Browse…
              </button>
            </div>
          </div>
          <div className="field">
            <label>Passphrase (optional)</label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </>
      ) : (
        <div className="field">
          <label>SSH agent</label>
          <div className="hint">Uses SSH_AUTH_SOCK on this machine. No password or key file needed.</div>
        </div>
      )}
      {error && <div className="err">{error}</div>}
      <button className="btn primary" type="submit" disabled={!canSubmit}>
        {busy ? (phase ? PHASE_LABEL[phase] : 'Connecting…') : 'Connect'}
      </button>
    </form>
  )
}
