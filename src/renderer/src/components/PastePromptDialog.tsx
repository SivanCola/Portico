import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.js'

interface Props {
  open: boolean
  title?: string
  initialPrompt?: string
  onCancel: () => void
  onConfirm: (prompt: string) => void
}

export function PastePromptDialog({
  open,
  title,
  initialPrompt,
  onCancel,
  onConfirm
}: Props) {
  const { t } = useI18n()
  const defaultPrompt = initialPrompt ?? t('paste.defaultPrompt')
  const [prompt, setPrompt] = useState(defaultPrompt)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setPrompt(defaultPrompt)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [open, defaultPrompt])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onConfirm(prompt.trim() || defaultPrompt)
          }
        }}
      >
        <h3>{title ?? t('paste.titleClipboard')}</h3>
        <p className="hint">{t('paste.hint')}</p>
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('paste.defaultPrompt')}
          spellCheck={false}
        />
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={() => onConfirm(prompt.trim() || defaultPrompt)}>
            {t('paste.upload')}
          </button>
        </div>
      </div>
    </div>
  )
}
