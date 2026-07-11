import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.js'
import type { ConnectionState, SessionSummary } from '@shared/types.js'
import { GearIcon } from './icons.js'

interface Props {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  /** Reorder: move fromId to before/after toId. */
  onReorder: (fromId: string, toId: string, position: 'before' | 'after') => void
  /** Global settings (same as top-bar gear). */
  onOpenSettings: () => void
}

function stateClass(state: ConnectionState): string {
  if (state === 'connected') return 'live'
  if (state === 'connecting') return 'connecting'
  if (state === 'reconnecting') return 'reconnecting'
  return ''
}

const DND_MIME = 'application/x-portico-session-id'

export function SessionRail({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onClose,
  onRename,
  onReorder,
  onOpenSettings
}: Props) {
  const { t } = useI18n()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: 'before' | 'after'
  } | null>(null)

  useEffect(() => {
    if (!editingId) return
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [editingId])

  useEffect(() => {
    if (editingId && !sessions.some((s) => s.id === editingId)) {
      setEditingId(null)
    }
  }, [sessions, editingId])

  const startRename = (s: SessionSummary) => {
    setEditingId(s.id)
    setDraft(s.title)
  }

  const commitRename = () => {
    if (!editingId) return
    const next = draft.trim()
    const cur = sessions.find((s) => s.id === editingId)
    setEditingId(null)
    if (!next || !cur || next === cur.title) return
    onRename(editingId, next)
  }

  const cancelRename = () => {
    setEditingId(null)
  }

  const clearDrag = () => {
    setDraggingId(null)
    setDropTarget(null)
  }

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
          const editing = editingId === s.id
          const dragging = draggingId === s.id
          const tip = s.target
            ? `${s.target.user}@${s.target.alias ?? s.target.host}:${s.target.port}`
            : s.title
          const dropBefore = dropTarget?.id === s.id && dropTarget.position === 'before'
          const dropAfter = dropTarget?.id === s.id && dropTarget.position === 'after'

          return (
            <li
              key={s.id}
              className={[
                'session-rail-item',
                active ? 'active' : '',
                dragging ? 'dragging' : '',
                dropBefore ? 'drop-before' : '',
                dropAfter ? 'drop-after' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              // Row itself is NOT draggable — only the grip is.
              // Whole-row drag made every click feel like a system "copy" drag.
              onDragOver={(e) => {
                if (!draggingId || draggingId === s.id) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const rect = e.currentTarget.getBoundingClientRect()
                const position: 'before' | 'after' =
                  e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                setDropTarget((prev) =>
                  prev?.id === s.id && prev.position === position
                    ? prev
                    : { id: s.id, position }
                )
              }}
              onDragLeave={(e) => {
                // Only clear when leaving the item (not entering a child).
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropTarget((prev) => (prev?.id === s.id ? null : prev))
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const fromId = e.dataTransfer.getData(DND_MIME)
                const position = dropTarget?.id === s.id ? dropTarget.position : 'before'
                clearDrag()
                if (!fromId || fromId === s.id) return
                onReorder(fromId, s.id, position)
              }}
            >
              {editing ? (
                <div className="session-rail-row editing">
                  <span className={`dot ${stateClass(s.state)}`} />
                  <input
                    ref={inputRef}
                    className="session-rail-rename"
                    value={draft}
                    maxLength={80}
                    spellCheck={false}
                    aria-label={t('rail.renamePrompt')}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitRename()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelRename()
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <div className="session-rail-row-wrap">
                  <span
                    className="session-rail-grip"
                    draggable
                    title={t('rail.dragHint')}
                    aria-label={t('rail.dragHint')}
                    onDragStart={(e) => {
                      e.stopPropagation()
                      e.dataTransfer.effectAllowed = 'move'
                      // Custom MIME only — text/plain makes macOS show a "copy" cursor.
                      e.dataTransfer.setData(DND_MIME, s.id)
                      // Transparent drag image: less "browser file copy" chrome.
                      const img = document.createElement('canvas')
                      img.width = img.height = 1
                      e.dataTransfer.setDragImage(img, 0, 0)
                      setDraggingId(s.id)
                    }}
                    onDragEnd={clearDrag}
                  >
                    ⋮⋮
                  </span>
                  <button
                    type="button"
                    className="session-rail-row"
                    draggable={false}
                    onClick={() => onSelect(s.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      startRename(s)
                    }}
                    title={`${tip}\n${t('rail.renameHint')}`}
                  >
                    <span className={`dot ${stateClass(s.state)}`} />
                    <span className="session-rail-label">
                      {s.title}
                      {s.unread && !active ? (
                        <span className="session-unread" title={t('rail.unread')} />
                      ) : null}
                    </span>
                  </button>
                </div>
              )}
              <button
                type="button"
                className="btn ghost session-rail-close"
                draggable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (editingId === s.id) cancelRename()
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
      <div className="session-rail-footer">
        <button
          type="button"
          className="btn ghost icon-btn session-rail-settings"
          onClick={onOpenSettings}
          title={t('topbar.settings')}
          aria-label={t('common.settings')}
        >
          <GearIcon size={15} />
        </button>
      </div>
    </aside>
  )
}
