import { useEffect, useMemo, useRef, useState } from 'react'

export interface PaletteAction {
  id: string
  title: string
  hint?: string
  run: () => void | Promise<void>
  /** When false the action is hidden (e.g. requires a connection). */
  enabled?: boolean
}

interface Props {
  open: boolean
  actions: PaletteAction[]
  onClose: () => void
}

export function CommandPalette({ open, actions, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const eligible = actions.filter((a) => a.enabled !== false)
    if (!q) return eligible
    return eligible.filter((a) => a.title.toLowerCase().includes(q))
  }, [actions, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // focus on next tick so the input is mounted
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [query])

  if (!open) return null

  const run = (a: PaletteAction | undefined) => {
    if (!a) return
    onClose()
    void a.run()
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(Math.max(filtered.length - 1, 0), s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(0, s - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(filtered[selected])
            }
          }}
          placeholder="Type a command…"
          spellCheck={false}
        />
        <ul>
          {filtered.length === 0 && <li className="title" style={{ color: 'var(--text-faint)' }}>No matches</li>}
          {filtered.map((a, i) => (
            <li
              key={a.id}
              className={i === selected ? 'selected' : ''}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(a)}
            >
              <span className="title">{a.title}</span>
              {a.hint && <span className="hint">{a.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
