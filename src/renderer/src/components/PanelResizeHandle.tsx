import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react'

type Side = 'left' | 'right'

interface Props {
  /** Which panel this handle resizes: left rail or right sidebar. */
  side: Side
  value: number
  min: number
  max: number
  /** Live width while dragging (no persist). */
  onLiveChange: (width: number) => void
  /** Final width on pointer up / double-click reset. */
  onCommit: (width: number) => void
  /** Double-click resets to this value (optional). */
  defaultWidth?: number
  label: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, n)))
}

/**
 * Thin vertical drag handle for resizing a side panel.
 * Left panel: drag right widens. Right panel: drag left widens.
 */
export function PanelResizeHandle({
  side,
  value,
  min,
  max,
  onLiveChange,
  onCommit,
  defaultWidth,
  label
}: Props) {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startW: number
    latest: number
  } | null>(null)

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startW: value,
        latest: value
      }
      document.body.classList.add('panel-resizing')
      document.body.dataset.panelResizeSide = side
    },
    [side, value]
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const dx = e.clientX - d.startX
      // Left rail grows with +dx; right sidebar grows with −dx.
      const raw = side === 'left' ? d.startW + dx : d.startW - dx
      const next = clamp(raw, min, max)
      if (next === d.latest) return
      d.latest = next
      onLiveChange(next)
    },
    [side, min, max, onLiveChange]
  )

  const endDrag = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      dragRef.current = null
      document.body.classList.remove('panel-resizing')
      delete document.body.dataset.panelResizeSide
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      onCommit(d.latest)
    },
    [onCommit]
  )

  const onDoubleClick = useCallback(() => {
    if (defaultWidth == null) return
    const next = clamp(defaultWidth, min, max)
    onLiveChange(next)
    onCommit(next)
  }, [defaultWidth, min, max, onLiveChange, onCommit])

  return (
    <div
      className={`panel-resize-handle panel-resize-handle--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? 20 : 8
        let next: number | null = null
        if (e.key === 'ArrowLeft') {
          next = clamp(value + (side === 'left' ? -step : step), min, max)
        } else if (e.key === 'ArrowRight') {
          next = clamp(value + (side === 'left' ? step : -step), min, max)
        } else if (e.key === 'Home') {
          next = min
        } else if (e.key === 'End') {
          next = max
        } else if ((e.key === 'Enter' || e.key === ' ') && defaultWidth != null) {
          e.preventDefault()
          const reset = clamp(defaultWidth, min, max)
          onLiveChange(reset)
          onCommit(reset)
          return
        } else {
          return
        }
        if (next == null || next === value) return
        e.preventDefault()
        onLiveChange(next)
        onCommit(next)
      }}
    />
  )
}
