/**
 * Coalesce high-frequency terminal output so the renderer does not flood
 * xterm.write on large paste / TUI redraw storms.
 *
 * Pure enough for unit tests: inject `schedule` / `now` in tests.
 */

export interface OutputBufferOptions {
  /** Max chunks held before forced flush (default 64). */
  maxChunks?: number
  /** Max total characters held before forced flush (default 256 KiB). */
  maxChars?: number
  /** Debounce window in ms (default 16 ≈ one frame). */
  delayMs?: number
  /** schedule flush (defaults to setTimeout). */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearSchedule?: (id: ReturnType<typeof setTimeout>) => void
}

export class OutputBuffer {
  private queue: string[] = []
  private chars = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly maxChunks: number
  private readonly maxChars: number
  private readonly delayMs: number
  private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  private readonly clearSchedule: (id: ReturnType<typeof setTimeout>) => void
  private readonly flushFn: (data: string) => void
  private disposed = false

  constructor(flushFn: (data: string) => void, opts: OutputBufferOptions = {}) {
    this.flushFn = flushFn
    this.maxChunks = opts.maxChunks ?? 64
    this.maxChars = opts.maxChars ?? 256 * 1024
    this.delayMs = opts.delayMs ?? 16
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearSchedule = opts.clearSchedule ?? ((id) => clearTimeout(id))
  }

  push(chunk: string): void {
    if (this.disposed || !chunk) return
    this.queue.push(chunk)
    this.chars += chunk.length
    if (this.queue.length >= this.maxChunks || this.chars >= this.maxChars) {
      this.flush()
      return
    }
    if (this.timer == null) {
      this.timer = this.schedule(() => {
        this.timer = null
        this.flush()
      }, this.delayMs)
    }
  }

  flush(): void {
    if (this.timer != null) {
      this.clearSchedule(this.timer)
      this.timer = null
    }
    if (this.queue.length === 0) return
    const data = this.queue.join('')
    this.queue = []
    this.chars = 0
    try {
      this.flushFn(data)
    } catch {
      /* consumer error must not break the pump */
    }
  }

  dispose(): void {
    this.disposed = true
    this.flush()
  }
}
