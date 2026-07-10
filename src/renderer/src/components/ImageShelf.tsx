import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_IMAGE_PROMPT_MULTI,
  DEFAULT_IMAGE_PROMPT_SINGLE,
  isStockImagePrompt,
  resolveImagePrompt,
  suggestCommitPrompt
} from '@shared/image-prompt.js'
import type { ShelfItem } from '@shared/types.js'
import { useI18n, type MessageKey, type TFunction } from '../i18n/index.js'

interface Props {
  items: ShelfItem[]
  defaultPrompt: string
  onRepaste: (item: ShelfItem) => void
  onRetry: (item: ShelfItem) => void
  onRemove: (item: ShelfItem) => void
  onCopyPath: (item: ShelfItem) => void
  onClear: () => void
  onPickFile: () => void
  /** Upload all staged images, inject, and submit (Enter) to the remote AI. */
  onCommitStaged: (prompt: string) => void
  enabled: boolean
  committing?: boolean
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const STATUS_KEY: Record<ShelfItem['status'], MessageKey> = {
  staged: 'shelf.status.staged',
  uploading: 'shelf.status.uploading',
  ready: 'shelf.status.ready',
  failed: 'shelf.status.failed'
}

function statusLabel(status: ShelfItem['status'], t: TFunction): string {
  return t(STATUS_KEY[status])
}

export function ImageShelf({
  items,
  defaultPrompt,
  onRepaste,
  onRetry,
  onRemove,
  onCopyPath,
  onClear,
  onPickFile,
  onCommitStaged,
  enabled,
  committing = false
}: Props) {
  const { t } = useI18n()
  const staged = items.filter((i) => i.status === 'staged')
  const stagedCount = staged.length
  const [prompt, setPrompt] = useState(() =>
    resolveImagePrompt(defaultPrompt, 1, defaultPrompt)
  )
  const promptRef = useRef<HTMLInputElement>(null)
  /** Tracks last auto-filled value so we don't clobber user edits. */
  const lastAutoRef = useRef(prompt)

  // Settings default changed — refresh only if field still looks stock/auto.
  useEffect(() => {
    setPrompt((cur) => {
      if (!isStockImagePrompt(cur) && cur.trim() !== defaultPrompt.trim()) return cur
      const next = resolveImagePrompt(defaultPrompt, Math.max(1, stagedCount), defaultPrompt)
      lastAutoRef.current = next
      return next
    })
  }, [defaultPrompt])

  // Staged count changed — upgrade/downgrade stock singular ↔ plural.
  useEffect(() => {
    if (stagedCount === 0) return
    setPrompt((cur) => {
      // User typed something custom since last auto-fill.
      if (cur !== lastAutoRef.current && !isStockImagePrompt(cur) && cur.trim() !== defaultPrompt.trim()) {
        return cur
      }
      const next = suggestCommitPrompt(cur, stagedCount, defaultPrompt)
      lastAutoRef.current = next
      return next
    })
  }, [stagedCount, defaultPrompt])

  // Focus prompt when the first staged image appears.
  useEffect(() => {
    if (stagedCount > 0) {
      requestAnimationFrame(() => promptRef.current?.focus())
    }
  }, [stagedCount > 0])

  const placeholder =
    stagedCount > 1 ? DEFAULT_IMAGE_PROMPT_MULTI : defaultPrompt || DEFAULT_IMAGE_PROMPT_SINGLE

  const send = () => {
    if (!enabled || committing || stagedCount === 0) return
    const resolved = resolveImagePrompt(prompt, stagedCount, defaultPrompt)
    onCommitStaged(resolved)
  }

  return (
    <aside className="shelf">
      <header>
        <h3>{t('shelf.title')}</h3>
        <div className="shelf-header-actions">
          <button className="btn ghost" onClick={onPickFile} disabled={!enabled} title={t('shelf.file')}>
            {t('shelf.file')}
          </button>
          <button className="btn ghost" onClick={onClear} disabled={items.length === 0} title={t('shelf.clear')}>
            {t('shelf.clear')}
          </button>
        </div>
      </header>

      {staged.length > 0 && (
        <div className="shelf-commit">
          <div className="shelf-commit-meta">
            {t('shelf.stagedCount', { n: String(staged.length) })}
          </div>
          <input
            ref={promptRef}
            className="shelf-commit-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            disabled={!enabled || committing}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button
            className="btn primary shelf-commit-btn"
            onClick={send}
            disabled={!enabled || committing || staged.length === 0}
          >
            {committing ? t('shelf.sending') : t('shelf.sendEnter')}
          </button>
          <p className="shelf-commit-hint">{t('shelf.commitHint')}</p>
        </div>
      )}

      <div className="list">
        {items.length === 0 && (
          <div className="empty">
            {t('shelf.empty')}
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={`shelf-item ${item.status === 'failed' ? 'failed' : ''} ${item.status === 'staged' ? 'staged' : ''}`}
          >
            <div className="thumb">
              {item.previewUrl ? (
                <img src={item.previewUrl} alt={item.remotePath || 'staged'} />
              ) : item.status === 'uploading' ? (
                'Uploading…'
              ) : item.status === 'failed' ? (
                'Failed'
              ) : (
                <span style={{ fontFamily: 'var(--mono)' }}>{item.ext}</span>
              )}
            </div>
            <div className="meta">
              <div className="path">
                {item.status === 'staged'
                  ? t('shelf.localOnly')
                  : item.remotePath || '—'}
              </div>
              <div className="sub">
                <span>
                  {item.bytes ? fmtBytes(item.bytes) : ''}
                  {item.uploadedAt ? ` · ${new Date(item.uploadedAt).toLocaleTimeString()}` : ''}
                  {item.prompt ? ` · “${item.prompt.slice(0, 24)}${item.prompt.length > 24 ? '…' : ''}”` : ''}
                </span>
                <span className={`badge ${item.status}`}>{statusLabel(item.status, t)}</span>
              </div>
              {item.error && <div style={{ color: 'var(--err)' }}>{item.error}</div>}
            </div>
            <div className="actions">
              {item.status === 'failed' ? (
                <button className="btn" onClick={() => onRetry(item)} disabled={!enabled}>
                  Retry
                </button>
              ) : item.status === 'staged' ? (
                <button className="btn ghost" onClick={() => onRemove(item)} title={t('shelf.removeStaged')}>
                  {t('shelf.removeStaged')}
                </button>
              ) : (
                <button className="btn" onClick={() => onRepaste(item)} disabled={item.status !== 'ready' || !enabled}>
                  {t('shelf.pasteAgain')}
                </button>
              )}
              <button className="btn ghost" onClick={() => onCopyPath(item)} disabled={!item.remotePath}>
                {t('shelf.copyPath')}
              </button>
              <button className="btn ghost" onClick={() => onRemove(item)} title="Remove from shelf">
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
