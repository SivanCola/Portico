import { useEffect, useState } from 'react'
import type { PortForwardDirection, PortForwardStatus } from '@shared/types.js'
import type { DetectedPort } from '@shared/port-detect.js'
import { useI18n } from '../i18n/index.js'

interface Props {
  sessionId: string
  forwards: PortForwardStatus[]
  detected: DetectedPort[]
  /** True when SSH is connected (live tunnels). Rules can still be edited offline. */
  connected: boolean
  enabled: boolean
  /** Request parent to expand the tool sidebar (command palette). */
  expandRequest?: number
}

const PRESET_PORTS = [3000, 5173, 8080, 4173, 9229]
/** Common local SOCKS listen ports. */
const SOCKS_PRESETS = [1080, 1081, 9050]

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0
  if (n < 1024) return `${Math.floor(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function PortForwards({
  sessionId,
  forwards,
  detected,
  connected,
  enabled,
  expandRequest = 0
}: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [localPort, setLocalPort] = useState('')
  const [remoteHost, setRemoteHost] = useState('127.0.0.1')
  const [remotePort, setRemotePort] = useState('')
  const [direction, setDirection] = useState<PortForwardDirection>('local')
  const [bindHost, setBindHost] = useState('127.0.0.1')
  const [label, setLabel] = useState('')
  const [autoLocal, setAutoLocal] = useState(false)
  const [samePort, setSamePort] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setShowForm(false)
    setLocalPort('')
    setRemotePort('')
    setRemoteHost('127.0.0.1')
    setBindHost('127.0.0.1')
    setLabel('')
    setDirection('local')
    setAutoLocal(false)
    setSamePort(true)
    setShowAdvanced(false)
    setError(null)
  }, [sessionId])

  useEffect(() => {
    if (expandRequest > 0) {
      setExpanded(true)
      setShowForm(true)
    }
  }, [expandRequest])

  const applyRemotePort = (port: string) => {
    setRemotePort(port)
    if (samePort && !autoLocal && direction === 'local') setLocalPort(port)
  }

  const addForward = async (override?: {
    localPort?: number
    remotePort?: number
    remoteHost?: string
    direction?: PortForwardDirection
    label?: string
  }) => {
    setError(null)
    setBusy(true)
    try {
      const dir = override?.direction ?? direction
      let lp: number
      let rp: number

      if (dir === 'dynamic') {
        if (override?.localPort != null) {
          lp = override.localPort
        } else if (autoLocal) {
          lp = 0
        } else {
          lp = Number(localPort)
        }
        rp = 0
        if (!autoLocal && (!Number.isFinite(lp) || lp < 1 || lp > 65535)) {
          setError(t('pf.errLocalPort'))
          return
        }
      } else if (override) {
        rp = override.remotePort ?? 0
        lp =
          override.localPort ??
          (autoLocal && dir === 'local' ? 0 : samePort ? rp : Number(localPort) || rp)
        if (dir === 'local') {
          if (!autoLocal && (!Number.isFinite(lp) || lp < 1 || lp > 65535)) {
            setError(t('pf.errLocalPort'))
            return
          }
        } else if (!Number.isFinite(lp) || lp < 1 || lp > 65535) {
          setError(t('pf.errLocalPort'))
          return
        }
        if (!Number.isFinite(rp) || rp < 1 || rp > 65535) {
          setError(t('pf.errRemotePort'))
          return
        }
      } else {
        rp = Number(remotePort)
        if (autoLocal && dir === 'local') {
          lp = 0
        } else if (samePort && dir === 'local') {
          lp = rp
        } else {
          lp = Number(localPort)
        }
        if (dir === 'local') {
          if (!autoLocal && (!Number.isFinite(lp) || lp < 1 || lp > 65535)) {
            setError(t('pf.errLocalPort'))
            return
          }
        } else if (!Number.isFinite(lp) || lp < 1 || lp > 65535) {
          setError(t('pf.errLocalPort'))
          return
        }
        if (!Number.isFinite(rp) || rp < 1 || rp > 65535) {
          setError(t('pf.errRemotePort'))
          return
        }
      }

      const host =
        dir === 'dynamic'
          ? 'socks5'
          : (override?.remoteHost ?? remoteHost).trim() || '127.0.0.1'
      if (dir !== 'dynamic' && !host) {
        setError(t('pf.errHostRequired'))
        return
      }

      const r = await window.portico.addPortForward(sessionId, {
        localPort: lp,
        remoteHost: host,
        remotePort: rp,
        direction: dir,
        bindHost: bindHost.trim() || '127.0.0.1',
        label: (override?.label ?? label).trim() || undefined
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setLocalPort('')
      setRemotePort('')
      setLabel('')
      setShowForm(false)
    } finally {
      setBusy(false)
    }
  }

  const removeForward = async (id: string) => {
    await window.portico.removePortForward(sessionId, id)
  }

  const toggleEnabled = async (f: PortForwardStatus) => {
    await window.portico.setPortForwardEnabled(sessionId, f.id, !f.enabled)
  }

  const openBrowser = async (id: string) => {
    const r = await window.portico.openPortForward(sessionId, id)
    if (!r.ok) setError(r.error.message)
  }

  const copyUrl = async (f: PortForwardStatus) => {
    const port = f.effectiveLocalPort || f.localPort
    if (!port) return
    try {
      if (f.direction === 'dynamic') {
        await navigator.clipboard.writeText(`socks5://127.0.0.1:${port}`)
      } else {
        await navigator.clipboard.writeText(`http://127.0.0.1:${port}`)
      }
    } catch {
      /* ignore */
    }
  }

  const resetStats = async (id?: string) => {
    await window.portico.resetPortForwardStats(sessionId, id)
  }

  const addDetected = async (d: DetectedPort) => {
    await addForward({
      remotePort: d.port,
      remoteHost: d.host || '127.0.0.1',
      localPort: d.port,
      direction: 'local',
      label: `:${d.port}`
    })
  }

  const dismissDetected = async (port: number) => {
    await window.portico.dismissDetectedPort(sessionId, port)
  }

  const totalUp = forwards.reduce((s, f) => s + (f.bytesUp || 0), 0)
  const totalDown = forwards.reduce((s, f) => s + (f.bytesDown || 0), 0)
  const hasTraffic = totalUp > 0 || totalDown > 0

  return (
    <div className="pf-section">
      <header onClick={() => setExpanded(!expanded)}>
        <h3>
          <span className={`pf-chevron ${expanded ? 'open' : ''}`}>&#9654;</span>
          {t('pf.title')}
          {forwards.length > 0 && <span className="pf-count">{forwards.length}</span>}
        </h3>
        {enabled && (
          <button
            className="btn ghost"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={(e) => {
              e.stopPropagation()
              setShowForm(!showForm)
            }}
          >
            {t('pf.add')}
          </button>
        )}
      </header>
      {expanded && (
        <div className="pf-body">
          {hasTraffic && (
            <div className="pf-traffic-bar">
              <span className="pf-traffic" title={t('pf.trafficHint')}>
                ↑{formatBytes(totalUp)} ↓{formatBytes(totalDown)}
              </span>
              <button
                type="button"
                className="btn ghost"
                style={{ fontSize: 10, padding: '1px 6px' }}
                onClick={() => void resetStats()}
                title={t('pf.resetStats')}
              >
                {t('pf.resetStats')}
              </button>
            </div>
          )}

          {detected.length > 0 && enabled && (
            <div className="pf-detected">
              <div className="pf-detected-title">{t('pf.detected')}</div>
              {detected.map((d) => (
                <div key={d.port} className="pf-detected-item" title={d.snippet}>
                  <span className="pf-detected-port">:{d.port}</span>
                  <button
                    className="btn primary"
                    style={{ fontSize: 10, padding: '2px 6px' }}
                    disabled={busy || !connected}
                    onClick={() => void addDetected(d)}
                  >
                    {t('pf.forward')}
                  </button>
                  <button
                    className="pf-remove"
                    title={t('pf.dismiss')}
                    onClick={() => void dismissDetected(d.port)}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          {showForm && enabled && (
            <div className="pf-form">
              <div className="pf-dir-row">
                <label className={`pf-dir ${direction === 'local' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="pf-dir"
                    checked={direction === 'local'}
                    onChange={() => setDirection('local')}
                  />
                  {t('pf.dirLocal')}
                </label>
                <label className={`pf-dir ${direction === 'remote' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="pf-dir"
                    checked={direction === 'remote'}
                    onChange={() => setDirection('remote')}
                  />
                  {t('pf.dirRemote')}
                </label>
                <label className={`pf-dir ${direction === 'dynamic' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="pf-dir"
                    checked={direction === 'dynamic'}
                    onChange={() => {
                      setDirection('dynamic')
                      setSamePort(false)
                      if (!localPort) setLocalPort('1080')
                    }}
                  />
                  {t('pf.dirDynamic')}
                </label>
              </div>

              {direction === 'dynamic' ? (
                <>
                  <div className="pf-presets">
                    {SOCKS_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="pf-chip"
                        onClick={() => {
                          setAutoLocal(false)
                          setLocalPort(String(p))
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="pf-hint" style={{ marginBottom: 6 }}>
                    {t('pf.dynamicHint')}
                  </div>
                  <div
                    className="pf-form-row"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void addForward()
                      }
                    }}
                  >
                    <input
                      type="number"
                      placeholder={autoLocal ? t('pf.auto') : t('pf.local')}
                      value={autoLocal ? '' : localPort}
                      onChange={(e) => {
                        setAutoLocal(false)
                        setLocalPort(e.target.value)
                      }}
                      min={1}
                      max={65535}
                      className="pf-input"
                      disabled={autoLocal}
                      title={t('pf.localHint')}
                    />
                    <span className="pf-arrow">SOCKS5</span>
                    <button
                      className="btn primary"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => void addForward()}
                      disabled={busy}
                    >
                      {t('pf.addBtn')}
                    </button>
                  </div>
                  <div className="pf-options">
                    <label className="pf-check">
                      <input
                        type="checkbox"
                        checked={autoLocal}
                        onChange={(e) => setAutoLocal(e.target.checked)}
                      />
                      {t('pf.autoPort')}
                    </label>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ fontSize: 10, padding: '1px 6px' }}
                      onClick={() => setShowAdvanced(!showAdvanced)}
                    >
                      {showAdvanced ? t('pf.hideAdvanced') : t('pf.showAdvanced')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="pf-presets">
                    {PRESET_PORTS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="pf-chip"
                        onClick={() => applyRemotePort(String(p))}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div
                    className="pf-form-row"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void addForward()
                      }
                    }}
                  >
                    <input
                      type="number"
                      placeholder={
                        autoLocal && direction === 'local' ? t('pf.auto') : t('pf.local')
                      }
                      value={autoLocal && direction === 'local' ? '' : localPort}
                      onChange={(e) => {
                        setSamePort(false)
                        setAutoLocal(false)
                        setLocalPort(e.target.value)
                      }}
                      min={1}
                      max={65535}
                      className="pf-input"
                      disabled={autoLocal && direction === 'local'}
                      title={t('pf.localHint')}
                    />
                    <span className="pf-arrow">
                      {direction === 'local' ? '\u2192' : '\u2190'}
                    </span>
                    <input
                      placeholder={t('pf.host')}
                      value={remoteHost}
                      onChange={(e) => setRemoteHost(e.target.value)}
                      className="pf-input pf-input-host"
                      spellCheck={false}
                    />
                    <span className="pf-colon">:</span>
                    <input
                      type="number"
                      placeholder={t('pf.port')}
                      value={remotePort}
                      onChange={(e) => applyRemotePort(e.target.value)}
                      min={1}
                      max={65535}
                      className="pf-input"
                    />
                    <button
                      className="btn primary"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => void addForward()}
                      disabled={busy}
                    >
                      {t('pf.addBtn')}
                    </button>
                  </div>
                  <div className="pf-options">
                    {direction === 'local' && (
                      <>
                        <label className="pf-check">
                          <input
                            type="checkbox"
                            checked={samePort}
                            onChange={(e) => {
                              setSamePort(e.target.checked)
                              if (e.target.checked) {
                                setAutoLocal(false)
                                if (remotePort) setLocalPort(remotePort)
                              }
                            }}
                          />
                          {t('pf.samePort')}
                        </label>
                        <label className="pf-check">
                          <input
                            type="checkbox"
                            checked={autoLocal}
                            onChange={(e) => {
                              setAutoLocal(e.target.checked)
                              if (e.target.checked) setSamePort(false)
                            }}
                          />
                          {t('pf.autoPort')}
                        </label>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ fontSize: 10, padding: '1px 6px' }}
                      onClick={() => setShowAdvanced(!showAdvanced)}
                    >
                      {showAdvanced ? t('pf.hideAdvanced') : t('pf.showAdvanced')}
                    </button>
                  </div>
                </>
              )}

              {showAdvanced && (
                <div className="pf-advanced">
                  <input
                    placeholder={t('pf.label')}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="pf-input pf-input-wide"
                    maxLength={40}
                  />
                  <input
                    placeholder={
                      direction === 'remote' ? t('pf.localHost') : t('pf.bindHost')
                    }
                    value={bindHost}
                    onChange={(e) => setBindHost(e.target.value)}
                    className="pf-input pf-input-wide"
                    spellCheck={false}
                  />
                  {(direction === 'local' || direction === 'dynamic') &&
                    bindHost === '0.0.0.0' && (
                      <div className="pf-warn">{t('pf.bindWarn')}</div>
                    )}
                </div>
              )}
              {!connected && <div className="pf-hint">{t('pf.offlineHint')}</div>}
              {error && <div className="pf-error">{error}</div>}
            </div>
          )}
          {forwards.length === 0 ? (
            <div className="pf-empty">{t('pf.empty')}</div>
          ) : (
            <div className="pf-list">
              {forwards.map((f) => {
                const displayLocal = f.effectiveLocalPort || f.localPort
                const isLocal = f.direction === 'local'
                const isDynamic = f.direction === 'dynamic'
                const up = f.bytesUp || 0
                const down = f.bytesDown || 0
                return (
                  <div
                    key={f.id}
                    className={`pf-item ${
                      f.state === 'error'
                        ? 'pf-item-err'
                        : f.state === 'stopped' || f.state === 'paused'
                          ? 'pf-item-stopped'
                          : ''
                    }`}
                    title={f.lastConnectError || f.error || f.state}
                  >
                    <span
                      className={`pf-dot ${
                        f.state === 'listening'
                          ? 'pf-dot-ok'
                          : f.state === 'paused'
                            ? 'pf-dot-paused'
                            : f.state === 'stopped'
                              ? 'pf-dot-stopped'
                              : 'pf-dot-err'
                      }`}
                    />
                    <span className="pf-rule">
                      {f.label ? <span className="pf-label">{f.label} </span> : null}
                      {isDynamic ? (
                        <>D :{displayLocal || '?'} SOCKS5</>
                      ) : isLocal ? (
                        <>
                          :{displayLocal || '?'} &rarr; {f.remoteHost}:{f.remotePort}
                        </>
                      ) : (
                        <>
                          R :{f.remotePort} &larr; :{f.localPort}
                        </>
                      )}
                    </span>
                    {(up > 0 || down > 0) && (
                      <span
                        className="pf-bytes"
                        title={t('pf.trafficHint')}
                        onClick={() => void resetStats(f.id)}
                      >
                        ↑{formatBytes(up)} ↓{formatBytes(down)}
                      </span>
                    )}
                    {f.state !== 'listening' && (
                      <span className="pf-state">{f.state}</span>
                    )}
                    {f.activeConnections > 0 && (
                      <span className="pf-conns">{f.activeConnections} conn</span>
                    )}
                    <div className="pf-actions">
                      {isLocal && f.enabled && displayLocal > 0 && (
                        <>
                          <button
                            className="pf-action"
                            onClick={() => void openBrowser(f.id)}
                            title={t('pf.openBrowser')}
                            disabled={!connected || f.state !== 'listening'}
                          >
                            &#127760;
                          </button>
                          <button
                            className="pf-action"
                            onClick={() => void copyUrl(f)}
                            title={t('pf.copyUrl')}
                          >
                            &#128203;
                          </button>
                        </>
                      )}
                      {isDynamic && f.enabled && displayLocal > 0 && (
                        <button
                          className="pf-action"
                          onClick={() => void copyUrl(f)}
                          title={t('pf.copySocks')}
                        >
                          &#128203;
                        </button>
                      )}
                      <button
                        className="pf-action"
                        onClick={() => void toggleEnabled(f)}
                        title={f.enabled ? t('pf.pause') : t('pf.resume')}
                      >
                        {f.enabled ? '||' : '\u25B6'}
                      </button>
                      <button
                        className="pf-remove"
                        onClick={() => void removeForward(f.id)}
                        title={t('pf.remove')}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
