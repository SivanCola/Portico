import { useI18n } from '../i18n/index.js'
import type { ConnectionState, SessionSummary } from '@shared/types.js'

interface Props {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
}

function stateClass(state: ConnectionState): string {
  if (state === 'connected') return 'live'
  if (state === 'connecting') return 'connecting'
  if (state === 'reconnecting') return 'reconnecting'
  return ''
}

export function SessionRail({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onClose,
  onRename
}: Props) {
  const { t } = useI18n()

  return (
    <aside className="session-rail" aria-label={t('rail.title')}>
      <div className="session-rail-header">
        <span className="session-rail-title">{t('rail.title')}</span>
        <button
          type="button"
          className="btn ghost session-rail-add"
          onClick={onCreate}
          title={t('rail.new')}
          aria-label={t('rail.new')}
        >
          +
        </button>
      </div>
      <ul className="session-rail-list">
        {sessions.map((s) => {
          const active = s.id === activeId
          return (
            <li key={s.id} className={`session-rail-item ${active ? 'active' : ''}`}>
              <button
                type="button"
                className="session-rail-row"
                onClick={() => onSelect(s.id)}
                onDoubleClick={() => {
                  const next = window.prompt(t('rail.renamePrompt'), s.title)
                  if (next != null && next.trim()) onRename(s.id, next.trim())
                }}
                title={
                  s.target
                    ? `${s.target.user}@${s.target.alias ?? s.target.host}:${s.target.port}`
                    : s.title
                }
              >
                <span className={`dot ${stateClass(s.state)}`} />
                <span className="session-rail-label">
                  {s.title}
                  {s.unread && !active ? <span className="session-unread" title={t('rail.unread')} /> : null}
                </span>
              </button>
              <button
                type="button"
                className="btn ghost session-rail-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(s.id)
                }}
                title={t('rail.close')}
                aria-label={t('rail.close')}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
