import { useEffect, useState } from 'react'
import type { AuthMode, ConnectPhase, ResolvedSshTarget, SshHostAlias, SshTarget } from '@shared/types.js'

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
  /** SSH alias, when this target came from ~/.ssh/config. */
  alias?: string
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

  // SSH config alias support.
  const [aliases, setAliases] = useState<SshHostAlias[]>([])
  /** Resolved target when the current `host` value matches an alias. */
  const [resolved, setResolved] = useState<ResolvedSshTarget | null>(null)
  /**
   * True once the user has manually edited the port field. Used so submit can
   * apply config Port only when the form still holds the untouched default,
   * without clobbering an intentional override (including back to 22).
   */
  const [portTouched, setPortTouched] = useState(false)

  // Load configured host aliases once for the dropdown. Best-effort: a missing
  // or empty ~/.ssh/config simply yields an empty list and the field behaves
  // as a plain host input.
  useEffect(() => {
    window.portico
      .listSshHosts()
      .then((r) => {
        if (r.ok) setAliases(r.value)
      })
      .catch(() => {})
  }, [])

  const fillFrom = (r: RecentTarget) => {
    // Prefer the alias for display when the recent entry came from ssh config;
    // the real host is resolved again on the next blur.
    setHost(r.alias ?? r.host)
    setUser(r.user)
    setPort(r.port)
    setPortTouched(true) // recent entry is an explicit choice of port
    setAuth(r.auth)
    setPrivateKeyPath(r.privateKeyPath ?? '')
    setResolved(r.alias ? { matched: true, host: r.host, user: r.user, port: r.port, alias: r.alias } : null)
    setError(null)
  }

  /**
   * Apply config defaults into the form for fields the user has not set.
   * Form values always win over config once present — never clobber overrides.
   */
  const applyResolvedDefaults = (
    r: ResolvedSshTarget,
    current: { user: string; port: number; portTouched: boolean; privateKeyPath: string }
  ): { user: string; port: number; privateKeyPath: string; auth?: AuthMode } => {
    const nextUser = current.user || r.user || ''
    const nextPort =
      current.portTouched ? current.port : r.port && r.port !== 22 ? r.port : current.port || r.port || 22
    const nextKey = current.privateKeyPath || r.identityFile || ''
    const nextAuth = r.identityFile && !current.privateKeyPath ? ('key' as const) : undefined
    return { user: nextUser, port: nextPort, privateKeyPath: nextKey, auth: nextAuth }
  }

  // When the host field loses focus, try to expand it as a ssh-config alias.
  // On a hit we fill in user/port/key (unless the user already typed them) and
  // switch to key auth when an IdentityFile is present — but we leave the host
  // field showing the alias so the user sees what they typed.
  // Always resolve (even when the picker list is empty) so `Host *` defaults
  // and glob-only configs still apply.
  const onHostBlur = async () => {
    const parsed = parseUserHost(host)
    if (parsed.user) {
      setUser(parsed.user)
      setHost(parsed.host)
    }
    const candidate = parsed.host.trim()
    if (!candidate) {
      setResolved(null)
      return
    }
    try {
      const r = await window.portico.resolveSshAlias(candidate)
      if (!r.ok) {
        setResolved(null)
        return
      }
      setResolved(r.value)
      if (r.value.matched) {
        const filled = applyResolvedDefaults(r.value, {
          user: parsed.user || user,
          port,
          portTouched,
          privateKeyPath
        })
        if (filled.user !== user) setUser(filled.user)
        if (filled.port !== port) setPort(filled.port)
        if (filled.privateKeyPath && filled.privateKeyPath !== privateKeyPath) {
          setPrivateKeyPath(filled.privateKeyPath)
        }
        if (filled.auth) setAuth(filled.auth)
      }
    } catch {
      setResolved(null)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)

    // If the host field holds a known alias, submit the *resolved* real
    // address (so the session layer + known_hosts both work on the real host)
    // while carrying the alias along for display only.
    const parsed = parseUserHost(host)
    const finalHostInput = parsed.host.trim()
    let formUser = (parsed.user || user).trim()
    let formPort = Number(port) || 22
    let formKey = privateKeyPath.trim()
    let formAuth = auth

    // Use already-resolved data if the field hasn't changed since the blur;
    // otherwise resolve now so typing+Enter without blurring still works.
    // Always attempt resolve — glob-only configs (Host *) have empty alias lists.
    let res = resolved && resolved.alias === finalHostInput ? resolved : null
    if (!res && finalHostInput) {
      try {
        const r = await window.portico.resolveSshAlias(finalHostInput)
        if (r.ok && r.value.matched) res = r.value
      } catch {
        /* fall through to manual entry */
      }
    }

    const isAlias = !!res?.matched
    if (isAlias && res) {
      const filled = applyResolvedDefaults(res, {
        user: formUser,
        port: formPort,
        portTouched,
        privateKeyPath: formKey
      })
      formUser = filled.user
      formPort = filled.port
      formKey = filled.privateKeyPath
      if (filled.auth) formAuth = filled.auth
    }

    // HostName comes from config; user/port/key always from the form (after
    // gap-fill above), so manual overrides survive Connect.
    const finalHost = isAlias ? res!.host : finalHostInput
    const finalUser = formUser
    const finalPort = formPort
    const finalKey = formKey
    const finalAlias = isAlias ? finalHostInput : undefined

    const target: SshTarget = {
      id: `${finalUser}@${finalHost}`,
      host: finalHost,
      user: finalUser,
      port: finalPort,
      password: formAuth === 'password' ? password || undefined : undefined,
      privateKeyPath: formAuth === 'key' ? finalKey || undefined : undefined,
      privateKeyPassphrase: formAuth === 'key' ? passphrase || undefined : undefined,
      useAgent: formAuth === 'agent' ? true : undefined,
      alias: finalAlias
    }
    const err = await onConnect(target)
    setBusy(false)
    if (err) {
      setError(err)
    } else {
      setRecent(
        saveRecent({
          host: finalHost,
          user: finalUser,
          port: finalPort,
          auth,
          privateKeyPath: auth === 'key' ? finalKey || undefined : undefined,
          alias: finalAlias
        })
      )
    }
  }

  // Effective credentials for the enable check: an unresolved alias with
  // IdentityFile can authenticate via key even if the toggle still says password.
  const effectiveKey = privateKeyPath.trim() || (resolved?.matched ? resolved.identityFile : '') || ''
  const canSubmit =
    !busy &&
    !!host.trim() &&
    !!(user.trim() || host.includes('@') || resolved?.matched) &&
    (auth === 'agent' ||
      (auth === 'password' && !!password) ||
      (auth === 'key' && !!effectiveKey) ||
      // Alias resolved to a key path while the toggle is still on password with
      // no password typed — submit will switch to key (see applyResolvedDefaults).
      (auth === 'password' && !password && !!effectiveKey && !!resolved?.matched))

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
              {r.alias ?? `${r.user}@${r.host}`}
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <label>Host</label>
        <input
          value={host}
          onChange={(e) => {
            setHost(e.target.value)
            // Invalidate the cached resolution if the field is edited.
            if (resolved && resolved.alias !== e.target.value.trim()) setResolved(null)
          }}
          onBlur={() => void onHostBlur()}
          placeholder="hostname or SSH alias"
          list="portico-ssh-hosts"
          autoFocus
          spellCheck={false}
        />
        {/* Native datalist: zero-dependency dropdown of configured aliases. */}
        <datalist id="portico-ssh-hosts">
          {aliases.map((a) => (
            <option key={a.alias} value={a.alias}>
              {a.hostName ? `${a.user ?? ''}@${a.hostName}${a.port ? `:${a.port}` : ''}`.replace(/^@/, '') : ''}
            </option>
          ))}
        </datalist>
        {resolved?.matched && (
          <div className="hint">
            → {resolved.host}{resolved.port ? `:${resolved.port}` : ''}
            {resolved.user ? ` (${resolved.user})` : ''} · from ~/.ssh/config
          </div>
        )}
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
            onChange={(e) => {
              setPortTouched(true)
              setPort(Number(e.target.value))
            }}
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
