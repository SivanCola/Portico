/**
 * Structured logger for the Portico main process.
 *
 * Goals:
 *   - Enough detail to diagnose in-the-field bugs (SSH lifecycle, uploads,
 *     port forwards, auto-updates, IPC failures, uncaught exceptions).
 *   - A *hard* disk ceiling so logging can never exhaust the user's disk:
 *       a single active file rotated at MAX_FILE_BYTES, keeping at most
 *       KEEP_FILES older copies -> total <= MAX_FILE_BYTES * (KEEP_FILES + 1).
 *   - Channel-aware: beta is verbose (info+) on disk; stable is lean
 *     (warn+) on disk; dev logs to the console only.
 *   - Never logs secrets (passwords / private keys / passphrases).
 *   - The logger itself must never crash the app — every file operation is
 *     wrapped so a logging failure degrades to console-only.
 *   - All disk I/O is async (buffered writes + async rotation) so logging
 *     never blocks the Electron main event loop.
 *
 * The formatting helpers (`formatLine`, `shouldLog`, `redactTarget`) are pure
 * and exported so they can be unit-tested without booting Electron.
 */
import {
  appendFile,
  rename,
  unlink,
  stat,
  mkdir,
  appendFileSync,
  mkdirSync,
  statSync,
  unlinkSync,
  renameSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { RELEASE_CHANNEL } from '@shared/channel.js'
import type { SshTarget } from '@shared/types.js'

/** Ordered so that numeric comparison gates severity. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

/** True when `level` is at least as severe as `minLevel`. Pure. */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel]
}

/**
 * Render a structured log line (no trailing newline).
 *
 *   2026-07-09T12:34:56.789Z [INFO] [ssh] connect attempt host=10.0.0.4 port=22
 *
 * `meta` values are coerced to strings; `Error` instances surface both message
 * and `.code`. Pure.
 */
export function formatLine(
  level: LogLevel,
  tag: string,
  message: string,
  meta?: Record<string, unknown>
): string {
  const ts = new Date().toISOString()
  const head = `${ts} [${level.toUpperCase()}] [${tag}] ${message}`
  if (!meta || Object.keys(meta).length === 0) return head
  const kv = Object.entries(meta)
    .map(([k, v]) => `${k}=${formatMetaValue(v)}`)
    .join(' ')
  return `${head} ${kv}`
}

function formatMetaValue(v: unknown): string {
  if (v instanceof Error) {
    const code = (v as Error & { code?: string }).code
    return code ? `${code}: ${v.message}` : v.message
  }
  if (typeof v === 'string') return v
  if (v === undefined || v === null) return String(v)
  return String(v)
}

/**
 * Return a safe, secret-free view of an SSH target for logging.
 * Passwords, private-key paths, and passphrases are never emitted.
 */
export function redactTarget(t: SshTarget): Record<string, unknown> {
  const auth = t.useAgent
    ? 'agent'
    : t.password
      ? 'password'
      : t.privateKeyPath
        ? 'key'
        : 'none'
  return {
    host: t.host,
    port: t.port,
    user: t.user,
    auth
  }
}

// ---- rotation configuration ------------------------------------------------

/** Max size of the active log file before it is rotated. 1 MiB. */
export const MAX_FILE_BYTES = 1_048_576
/** Number of rotated (historical) files to keep. */
export const KEEP_FILES = 3
/**
 * Worst-case disk footprint of logging, regardless of how chatty it gets:
 * the active file plus KEEP_FILES rotated copies.
 */
export const MAX_TOTAL_DISK_BYTES = MAX_FILE_BYTES * (KEEP_FILES + 1)

/** Async flush interval in ms. */
const FLUSH_INTERVAL_MS = 100
/** Force flush when buffer exceeds this many characters. */
const FLUSH_CHARS = 16_384

// ---- Logger ---------------------------------------------------------------

export interface LoggerOptions {
  /** Minimum level to emit at all. */
  minLevel: LogLevel
  /** Absolute file path for the active log, or null to disable file logging. */
  filePath: string | null
  /** Mirror to stderr? Defaults to true in dev, false when packaged. */
  console?: boolean
}

export class Logger {
  readonly minLevel: LogLevel
  private readonly filePath: string | null
  private readonly toConsole: boolean
  private buffer: string[] = []
  private bufChars = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushing = false
  private rotating = false

  constructor(opts: LoggerOptions) {
    this.minLevel = opts.minLevel
    this.filePath = opts.filePath
    this.toConsole = opts.console ?? false
    if (this.filePath) this.ensureDir(this.filePath)
  }

  debug(tag: string, message: string, meta?: Record<string, unknown>): void {
    this.write('debug', tag, message, meta)
  }

  info(tag: string, message: string, meta?: Record<string, unknown>): void {
    this.write('info', tag, message, meta)
  }

  warn(tag: string, message: string, meta?: Record<string, unknown>): void {
    this.write('warn', tag, message, meta)
  }

  error(tag: string, message: string, meta?: Record<string, unknown>): void {
    this.write('error', tag, message, meta)
  }

  /**
   * Synchronous final flush for process exit (before-quit).
   * Only time we touch sync I/O — acceptable since the app is shutting down.
   */
  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flushing = true
    if (!this.filePath || this.buffer.length === 0) return
    try {
      this.rotateSync()
      appendFileSync(this.filePath, this.buffer.join(''), 'utf8')
    } catch {
      /* best effort */
    }
    this.buffer = []
    this.bufChars = 0
  }

  private rotateSync(): void {
    if (!this.filePath) return
    let size: number
    try {
      size = statSync(this.filePath).size
    } catch {
      return
    }
    if (size < MAX_FILE_BYTES) return
    const oldest = `${this.filePath}.${KEEP_FILES}`
    try { unlinkSync(oldest) } catch { /* best effort */ }
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      try { renameSync(`${this.filePath}.${i}`, `${this.filePath}.${i + 1}`) } catch { /* best effort */ }
    }
    try { renameSync(this.filePath, `${this.filePath}.1`) } catch { /* best effort */ }
  }

  private write(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog(level, this.minLevel)) return
    const line = formatLine(level, tag, message, meta)
    if (this.toConsole) {
      // eslint-disable-next-line no-console
      level === 'error' ? console.error(line) : console.log(line)
    }
    if (this.filePath) {
      this.buffer.push(line + '\n')
      this.bufChars += line.length + 1
      if (this.bufChars >= FLUSH_CHARS) {
        void this.flush()
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null
          void this.flush()
        }, FLUSH_INTERVAL_MS)
      }
    }
  }

  private async flush(): Promise<void> {
    if (!this.filePath || this.buffer.length === 0 || this.flushing) return
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flushing = true
    const data = this.buffer.join('')
    this.buffer = []
    this.bufChars = 0
    try {
      await this.maybeRotate()
      await new Promise<void>((resolve) => {
        appendFile(this.filePath!, data, 'utf8', () => resolve())
      })
    } catch {
      /* swallow — fall back to whatever console output we already did */
    } finally {
      this.flushing = false
      if (this.buffer.length > 0) void this.flush()
    }
  }

  private async maybeRotate(): Promise<void> {
    if (!this.filePath || this.rotating) return
    this.rotating = true
    try {
      let size: number
      try {
        const s = await new Promise<{ size: number }>((resolve, reject) => {
          stat(this.filePath!, (err, st) => (err ? reject(err) : resolve(st)))
        })
        size = s.size
      } catch {
        this.rotating = false
        return
      }
      if (size < MAX_FILE_BYTES) {
        this.rotating = false
        return
      }

      const oldest = `${this.filePath}.${KEEP_FILES}`
      try {
        await new Promise<void>((resolve) => {
          unlink(oldest, () => resolve())
        })
      } catch {
        /* best effort */
      }
      for (let i = KEEP_FILES - 1; i >= 1; i--) {
        const from = `${this.filePath}.${i}`
        const to = `${this.filePath}.${i + 1}`
        try {
          await new Promise<void>((resolve) => {
            rename(from, to, () => resolve())
          })
        } catch {
          /* best effort */
        }
      }
      try {
        await new Promise<void>((resolve) => {
          rename(this.filePath!, `${this.filePath}.1`, () => resolve())
        })
      } catch {
        /* best effort */
      }
    } finally {
      this.rotating = false
    }
  }

  private ensureDir(filePath: string): void {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
    } catch {
      /* swallowed; writes will fail-safe to console */
    }
  }
}

// ---- singleton ------------------------------------------------------------

/**
 * Resolve the per-build log file path under the platform log dir
 * (macOS: ~/Library/Logs/<AppName>/). Returns null when it can't be resolved
 * (e.g. in a bare test environment), so callers fall back to console-only.
 */
function resolveLogPath(): string | null {
  try {
    const dir = app.getPath('logs')
    return join(dir, 'portico.log')
  } catch {
    return null
  }
}

/** Per-channel defaults: beta is verbose on disk, stable is lean, dev is console-only. */
function defaultsForChannel(): LoggerOptions {
  const packaged = (() => {
    try {
      return app.isPackaged
    } catch {
      return false
    }
  })()

  if (!packaged) {
    // Dev: no file pollution; everything to the console for live iteration.
    return { minLevel: 'debug', filePath: null, console: true }
  }

  const filePath = resolveLogPath()
  if (RELEASE_CHANNEL === 'beta') {
    return { minLevel: 'info', filePath, console: false }
  }
  // Stable: capture warnings/errors/crashes without noisy info traffic.
  return { minLevel: 'warn', filePath, console: false }
}

/**
 * Lazily-created singleton. Constructed on first access so importing this
 * module (e.g. in unit tests) has no side effects and never needs Electron.
 */
let _log: Logger | null = null
export function getLogger(): Logger {
  if (_log) return _log
  _log = new Logger(defaultsForChannel())
  return _log
}

/** Test-only: inject a configured logger (and clear with `resetLogger()`). */
export function setLoggerForTest(l: Logger): void {
  _log = l
}
export function resetLogger(): void {
  _log = null
}
