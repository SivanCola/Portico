import { useEffect, useState } from 'react'
import type { PortForwardStatus } from '@shared/types.js'
import { useI18n } from '../i18n/index.js'

interface Props {
  sessionId: string
  forwards: PortForwardStatus[]
  enabled: boolean
}

export function PortForwards({ sessionId, forwards, enabled }: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [localPort, setLocalPort] = useState('')
  const [remoteHost, setRemoteHost] = useState('127.0.0.1')
  const [remotePort, setRemotePort] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setShowForm(false)
    setLocalPort('')
    setRemotePort('')
    setRemoteHost('127.0.0.1')
    setError(null)
  }, [sessionId])

  const addForward = async () => {
    setError(null)
    const lp = Number(localPort)
    const rp = Number(remotePort)
    if (!lp || lp < 1 || lp > 65535) { setError(t('pf.errLocalPort')); return }
    if (!rp || rp < 1 || rp > 65535) { setError(t('pf.errRemotePort')); return }
    if (!remoteHost.trim()) { setError(t('pf.errHostRequired')); return }

    const r = await window.portico.addPortForward(sessionId, {
      localPort: lp,
      remoteHost: remoteHost.trim(),
      remotePort: rp
    })
    if (!r.ok) {
      setError(r.error.message)
      return
    }
    setLocalPort('')
    setRemotePort('')
    setShowForm(false)
  }

  const removeForward = async (id: string) => {
    await window.portico.removePortForward(sessionId, id)
  }

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
            onClick={(e) => { e.stopPropagation(); setShowForm(!showForm) }}
          >
            {t('pf.add')}
          </button>
        )}
      </header>
      {expanded && (
        <div className="pf-body">
          {showForm && enabled && (
            <div className="pf-form">
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
                  placeholder={t('pf.local')}
                  value={localPort}
                  onChange={(e) => setLocalPort(e.target.value)}
                  min={1}
                  max={65535}
                  className="pf-input"
                />
                <span className="pf-arrow">&rarr;</span>
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
                  onChange={(e) => setRemotePort(e.target.value)}
                  min={1}
                  max={65535}
                  className="pf-input"
                />
                <button className="btn primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={addForward}>
                  {t('pf.addBtn')}
                </button>
              </div>
              {error && <div className="pf-error">{error}</div>}
            </div>
          )}
          {forwards.length === 0 ? (
            <div className="pf-empty">{t('pf.empty')}</div>
          ) : (
            <div className="pf-list">
              {forwards.map((f) => (
                <div
                  key={f.id}
                  className={`pf-item ${f.state === 'error' ? 'pf-item-err' : f.state === 'stopped' ? 'pf-item-stopped' : ''}`}
                  title={f.error ?? f.state}
                >
                  <span
                    className={`pf-dot ${
                      f.state === 'listening' ? 'pf-dot-ok' : f.state === 'stopped' ? 'pf-dot-stopped' : 'pf-dot-err'
                    }`}
                  />
                  <span className="pf-rule">
                    :{f.localPort} &rarr; {f.remoteHost}:{f.remotePort}
                  </span>
                  {f.state !== 'listening' && (
                    <span className="pf-state">{f.state}</span>
                  )}
                  {f.activeConnections > 0 && (
                    <span className="pf-conns">{f.activeConnections} conn</span>
                  )}
                  <button
                    className="pf-remove"
                    onClick={() => removeForward(f.id)}
                    title="Remove forward"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
