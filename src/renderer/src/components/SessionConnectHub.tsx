import { useState } from 'react'
import type { ConnectPhase, SshTarget } from '@shared/types.js'
import { useI18n } from '../i18n/index.js'
import { ConnectionForm } from './ConnectionForm.js'

interface Props {
  onConnectSsh: (t: SshTarget) => Promise<string | null>
  onConnectLocal: () => Promise<string | null>
  phase?: ConnectPhase | null
  /** When true, expand SSH form immediately (defaultSessionKind === 'ssh'). */
  preferSsh?: boolean
}

/**
 * Draft-session landing: pick Local shell or SSH.
 */
export function SessionConnectHub({
  onConnectSsh,
  onConnectLocal,
  phase,
  preferSsh = false
}: Props) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'choose' | 'ssh'>(preferSsh ? 'ssh' : 'choose')
  const [localBusy, setLocalBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const openLocal = async () => {
    setLocalError(null)
    setLocalBusy(true)
    try {
      const errMsg = await onConnectLocal()
      if (errMsg) setLocalError(errMsg)
    } finally {
      setLocalBusy(false)
    }
  }

  if (mode === 'ssh') {
    return (
      <div className="connect-hub">
        <button type="button" className="btn ghost connect-hub-back" onClick={() => setMode('choose')}>
          ← {t('connect.backToChooser')}
        </button>
        <ConnectionForm onConnect={onConnectSsh} phase={phase} />
      </div>
    )
  }

  return (
    <div className="connect-hub">
      <div className="connect-hub-card">
        <h2>{t('connect.hubTitle')}</h2>
        <p className="connect-hub-sub">{t('connect.hubSubtitle')}</p>
        <div className="connect-hub-actions">
          <button
            type="button"
            className="connect-hub-option primary"
            disabled={localBusy}
            onClick={() => void openLocal()}
          >
            <span className="connect-hub-option-title">{t('connect.localTitle')}</span>
            <span className="connect-hub-option-desc">{t('connect.localDesc')}</span>
          </button>
          <button
            type="button"
            className="connect-hub-option"
            disabled={localBusy}
            onClick={() => setMode('ssh')}
          >
            <span className="connect-hub-option-title">{t('connect.sshTitle')}</span>
            <span className="connect-hub-option-desc">{t('connect.sshDesc')}</span>
          </button>
        </div>
        {localError && <div className="error">{localError}</div>}
        {localBusy && <div className="connect-hub-busy">{t('connect.localStarting')}</div>}
      </div>
    </div>
  )
}
