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
 *
 * The formatting helpers (`formatLine`, `shouldLog`, `redactTarget`) are pure
 * and exported so they can be unit-tested without booting Electron.
 */
import { appendFileSync, renameSync, unlinkSync, statSync, existsSync, mkdirSync } from 'node:fs'
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

  private write(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog(level, this.minLevel)) return
    const line = formatLine(level, tag, message, meta)
    if (this.toConsole) {
      // eslint-disable-next-line no-console
      level === 'error' ? console.error(line) : console.log(line)
    }
    if (this.filePath) {
      // Every file op is guarded: a logging failure must never propagate.
      try {
        this.maybeRotate()
        appendFileSync(this.filePath, line + '\n', 'utf8')
      } catch {
        /* swallow — fall back to whatever console output we already did */
      }
    }
  }

  /**
   * Rotate when the active file exceeds the size cap. Shifts
   * portico.log -> portico.log.1 -> ... -> portico.log.<KEEP_FILES>, deleting
   * the oldest. Bounded total size = MAX_TOTAL_DISK_BYTES.
   */
  private maybeRotate(): void {
    if (!this.filePath) return
    let size: number
    try {
      size = statSync(this.filePath).size
    } catch {
      return // file doesn't exist yet; nothing to rotate
    }
    if (size < MAX_FILE_BYTES) return

    // Drop the oldest kept file, then shift each suffix up by one.
    const oldest = `${this.filePath}.${KEEP_FILES}`
    try {
      if (existsSync(oldest)) unlinkSync(oldest)
    } catch {
      /* best effort */
    }
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      const from = `${this.filePath}.${i}`
      const to = `${this.filePath}.${i + 1}`
      try {
        if (existsSync(from)) renameSync(from, to)
      } catch {
        /* best effort */
      }
    }
    // Finally move the active file to .1.
    try {
      renameSync(this.filePath, `${this.filePath}.1`)
    } catch {
      /* best effort */
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
