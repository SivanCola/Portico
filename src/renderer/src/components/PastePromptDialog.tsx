import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  title?: string
  initialPrompt?: string
  onCancel: () => void
  onConfirm: (prompt: string) => void
}

export function PastePromptDialog({
  open,
  title = 'Paste image',
  initialPrompt = 'Analyze this image',
  onCancel,
  onConfirm
}: Props) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt)
      // Focus after paint.
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [open, initialPrompt])

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
            onConfirm(prompt.trim() || initialPrompt)
          }
        }}
      >
        <h3>{title}</h3>
        <p className="hint">Prompt injected with the remote image path. Edit before sending.</p>
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Analyze this image"
          spellCheck={false}
        />
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onConfirm(prompt.trim() || initialPrompt)}>
            Upload & paste
          </button>
        </div>
      </div>
    </div>
  )
}
