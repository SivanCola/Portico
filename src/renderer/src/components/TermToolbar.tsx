import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.js'
import { ImageFileIcon, ImageMenuIcon, ImageStageIcon, SearchIcon } from './icons.js'

interface Props {
  imageBridge: boolean
  connected: boolean
  stagedCount: number
  onStageClipboard: () => void
  onPickFile: () => void
  onFind: () => void
  onOpenStaged: () => void
}

/**
 * Slim terminal chrome: icon-first actions, shortcuts only in tooltips.
 * Image stage + file are grouped under one overflow to reduce noise.
 * App settings live on the session rail (single gear) — not duplicated here.
 */
export function TermToolbar({
  imageBridge,
  connected,
  stagedCount,
  onStageClipboard,
  onPickFile,
  onFind,
  onOpenStaged
}: Props) {
  const { t } = useI18n()
  const [imageMenuOpen, setImageMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!imageMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuWrapRef.current?.contains(e.target as Node)) {
        setImageMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImageMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [imageMenuOpen])

  return (
    <div className="term-toolbar" role="toolbar" aria-label={t('toolbar.aria')}>
      {imageBridge && (
        <div className="term-toolbar-image" ref={menuWrapRef}>
          <button
            type="button"
            className={`btn ghost icon-btn term-toolbar-btn ${imageMenuOpen ? 'active-toggle' : ''}`}
            disabled={!connected}
            aria-haspopup="menu"
            aria-expanded={imageMenuOpen}
            title={t('toolbar.imageMenuHint')}
            aria-label={t('toolbar.imageMenu')}
            onClick={() => setImageMenuOpen((o) => !o)}
          >
            <ImageMenuIcon size={14} />
            <span className="term-toolbar-caret" aria-hidden>
              ▾
            </span>
          </button>
          {imageMenuOpen && (
            <div className="term-toolbar-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="term-toolbar-menu-item"
                disabled={!connected}
                onClick={() => {
                  setImageMenuOpen(false)
                  onStageClipboard()
                }}
              >
                <ImageStageIcon size={14} />
                <span className="term-toolbar-menu-label">{t('toolbar.pasteImage')}</span>
                <span className="term-toolbar-menu-kbd">{t('toolbar.pasteImageKbd')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="term-toolbar-menu-item"
                disabled={!connected}
                onClick={() => {
                  setImageMenuOpen(false)
                  onPickFile()
                }}
              >
                <ImageFileIcon size={14} />
                <span className="term-toolbar-menu-label">{t('toolbar.file')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="btn ghost icon-btn term-toolbar-btn"
        onClick={onFind}
        title={t('toolbar.findHint')}
        aria-label={t('toolbar.find')}
      >
        <SearchIcon size={14} />
      </button>

      <span className="term-toolbar-spacer" />

      {imageBridge && connected && stagedCount > 0 && (
        <button
          type="button"
          className="btn ghost term-toolbar-btn term-toolbar-staged"
          onClick={onOpenStaged}
          title={t('toolbar.stagedHint')}
        >
          {t('toolbar.stagedCount', { n: stagedCount })}
        </button>
      )}
    </div>
  )
}
