import type {
  ConnectPhase,
  ConnectionState,
  SessionKind,
  SessionSummary
} from '@shared/types.js'
import { useI18n, type MessageKey, type TFunction } from '../i18n/index.js'

interface Props {
  /** Null while session list is still hydrating. */
  summary: SessionSummary | null
  /** 1-based index of this session in the restore wave (when known). */
  progressIndex: number
  progressTotal: number
  /** How many restore targets have reached connected. */
  progressDone: number
  phase?: ConnectPhase | null
  connState?: ConnectionState
  onCancel: () => void
}

function subtitleFor(summary: SessionSummary | null, t: TFunction): string {
  if (!summary) return t('restore.bootstrapping')
  if (summary.kind === 'local') {
    return summary.shell ? `${t('restore.kindLocal')} · ${summary.shell}` : t('restore.kindLocal')
  }
  const target = summary.target
  if (!target) return t('restore.kindSsh')
  const host = target.alias || target.host
  return target.user ? `${target.user}@${host}` : host
}

function phaseLabel(
  phase: ConnectPhase | null | undefined,
  kind: SessionKind | undefined,
  connState: ConnectionState | undefined,
  t: TFunction
): string {
  // SSH is up but launch restore still covering tmux attach / shell settle.
  if (connState === 'connected') return t('restore.phaseTmux')
  if (connState === 'connecting' && !phase) {
    return kind === 'local' ? t('restore.phaseStarting') : t('restore.phaseWaiting')
  }
  if (!phase) {
    return kind === 'local' ? t('restore.phaseStarting') : t('restore.phaseWaiting')
  }
  const map: Record<ConnectPhase, MessageKey> = {
    resolving: 'restore.phaseResolving',
    tcp: 'restore.phaseTcp',
    auth: 'restore.phaseAuth',
    shell: 'restore.phaseShell',
    home: 'restore.phaseHome',
    ready: 'restore.phaseReady'
  }
  return t(map[phase] ?? 'restore.phaseWaiting')
}

/** Skeleton terminal lines — decorative only, not interactive. */
function TerminalSkeleton() {
  const rows = [
    { w: '42%', delay: '0s' },
    { w: '68%', delay: '0.08s' },
    { w: '31%', delay: '0.16s' },
    { w: '55%', delay: '0.24s' },
    { w: '22%', delay: '0.32s' },
    { w: '74%', delay: '0.4s' },
    { w: '38%', delay: '0.48s' },
    { w: '51%', delay: '0.56s' }
  ]
  return (
    <div className="restore-skeleton" aria-hidden>
      <div className="restore-skeleton-gutter">
        {rows.map((_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <div className="restore-skeleton-lines">
        {rows.map((r, i) => (
          <div
            key={i}
            className="restore-skeleton-line"
            style={{ width: r.w, animationDelay: r.delay }}
          />
        ))}
        <div className="restore-skeleton-cursor" />
      </div>
    </div>
  )
}

/**
 * Shown while launch restore reconnects a saved session.
 * Avoids the "open session" chooser which implies starting a new connection.
 */
export function RestoringSessionView({
  summary,
  progressIndex,
  progressTotal,
  progressDone,
  phase,
  connState,
  onCancel
}: Props) {
  const { t } = useI18n()
  const title = summary?.title || t('restore.title')
  const sub = subtitleFor(summary, t)
  const phaseText = phaseLabel(phase, summary?.kind, connState, t)
  // Indeterminate fill while still bootstrapping (total unknown).
  const pct =
    progressTotal > 0
      ? Math.min(100, Math.round((progressDone / progressTotal) * 100))
      : null

  return (
    <div className="restore-view">
      <TerminalSkeleton />
      <div className="restore-overlay">
        <div className="restore-card" role="status" aria-live="polite">
          <div className="restore-spinner" aria-hidden />
          <h2 className="restore-title">{t('restore.title')}</h2>
          <p className="restore-session" title={title}>
            {title}
          </p>
          <p className="restore-sub">{sub}</p>
          <p className="restore-phase">{phaseText}</p>
          {(progressTotal > 1 || pct == null) && (
            <div className="restore-progress">
              <div className="restore-progress-track">
                <div
                  className={
                    pct == null
                      ? 'restore-progress-fill restore-progress-fill--indeterminate'
                      : 'restore-progress-fill'
                  }
                  style={pct == null ? undefined : { width: `${pct}%` }}
                />
              </div>
              {progressTotal > 1 && (
                <span className="restore-progress-label">
                  {t('restore.progress', {
                    done: progressDone,
                    total: progressTotal,
                    index: progressIndex
                  })}
                </span>
              )}
            </div>
          )}
          <button type="button" className="btn ghost restore-cancel" onClick={onCancel}>
            {t('restore.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
