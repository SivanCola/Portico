/**
 * Unit tests for the logger.
 *
 * Two layers:
 *   - Pure helpers (formatLine, shouldLog, redactTarget) need no Electron/FS.
 *   - The rotation disk-ceiling is verified against a real Logger pointed at a
 *     temp dir, proving the MAX_TOTAL_DISK_BYTES bound holds under load.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  formatLine,
  shouldLog,
  redactTarget,
  Logger,
  MAX_FILE_BYTES,
  KEEP_FILES,
  MAX_TOTAL_DISK_BYTES
} from './logger.js'
import type { LogLevel } from './logger.js'
import type { SshTarget } from '@shared/types.js'

// ---- pure helpers --------------------------------------------------------

describe('shouldLog', () => {
  it('gates by severity order debug < info < warn < error', () => {
    expect(shouldLog('debug', 'debug')).toBe(true)
    expect(shouldLog('error', 'debug')).toBe(true)
    expect(shouldLog('debug', 'error')).toBe(false)
    expect(shouldLog('info', 'warn')).toBe(false)
    expect(shouldLog('warn', 'warn')).toBe(true)
  })
})

describe('formatLine', () => {
  it('formats timestamp, level, tag, message', () => {
    const line = formatLine('info', 'ssh', 'connect attempt')
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] \[ssh\] connect attempt$/)
  })

  it('uppercases the level', () => {
    expect(formatLine('warn', 'x', 'm')).toContain('[WARN]')
    expect(formatLine('error', 'x', 'm')).toContain('[ERROR]')
    expect(formatLine('debug', 'x', 'm')).toContain('[DEBUG]')
  })

  it('appends meta as key=value pairs', () => {
    const line = formatLine('info', 'ssh', 'attempt', { host: '1.2.3.4', port: 22 })
    expect(line).toContain('host=1.2.3.4')
    expect(line).toContain('port=22')
  })

  it('renders Error meta with code and message', () => {
    const e = Object.assign(new Error('boom'), { code: 'SSH_CONNECT' })
    const line = formatLine('error', 'ssh', 'failed', { err: e })
    expect(line).toContain('err=SSH_CONNECT: boom')
  })

  it('renders plain Error without code', () => {
    const line = formatLine('error', 'x', 'm', { err: new Error('oops') })
    expect(line).toContain('err=oops')
  })

  it('omits the meta segment when none is given', () => {
    expect(formatLine('info', 'x', 'm')).not.toContain('=')
  })
})

describe('redactTarget', () => {
  const full: SshTarget = {
    id: 'abc',
    host: '10.0.0.4',
    user: 'ubuntu',
    port: 22,
    password: 'supersecret',
    privateKeyPath: '/home/u/.ssh/id_rsa',
    privateKeyPassphrase: 'passphrase-secret'
  }

  it('keeps host/port/user', () => {
    const r = redactTarget(full)
    expect(r.host).toBe('10.0.0.4')
    expect(r.port).toBe(22)
    expect(r.user).toBe('ubuntu')
  })

  it('never exposes the password, key path, or passphrase', () => {
    const r = redactTarget(full)
    expect(JSON.stringify(r)).not.toContain('supersecret')
    expect(JSON.stringify(r)).not.toContain('id_rsa')
    expect(JSON.stringify(r)).not.toContain('passphrase-secret')
  })

  it('summarizes auth method without leaking material', () => {
    expect(redactTarget(full).auth).toBe('password')
    expect(
      redactTarget({ ...full, password: undefined }).auth
    ).toBe('key')
    expect(
      redactTarget({ ...full, password: undefined, privateKeyPath: undefined }).auth
    ).toBe('none')
    expect(
      redactTarget({
        ...full,
        password: undefined,
        privateKeyPath: undefined,
        useAgent: true
      }).auth
    ).toBe('agent')
  })
})

// ---- file rotation disk ceiling (integration) ----------------------------

describe('Logger file rotation', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `portico-log-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('creates the active log file and writes lines', () => {
    const path = join(dir, 'portico.log')
    const logger = new Logger({ minLevel: 'info', filePath: path, console: false })
    logger.info('app', 'startup')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('[app] startup')
  })

  it('respects the min level', () => {
    const path = join(dir, 'portico.log')
    const logger = new Logger({ minLevel: 'warn', filePath: path, console: false })
    logger.info('app', 'should-be-skipped')
    logger.warn('app', 'should-be-kept')
    const content = readFileSync(path, 'utf8')
    expect(content).not.toContain('should-be-skipped')
    expect(content).toContain('should-be-kept')
  })

  it('keeps total disk usage under the hard ceiling after heavy logging', () => {
    // Use a tiny cap so the test runs fast, exercising the real rotate path.
    const path = join(dir, 'portico.log')
    const smallCap = 2048 // 2 KiB per file
    // Build a logger with a reduced cap by constructing it then writing many
    // times. We can't change the exported constant, so we emulate by writing
    // enough to trigger several rotations under the real MAX_FILE_BYTES only
    // if it's small — instead, verify the invariant directly: after writing
    // far more than KEEP_FILES+1 files worth of data, total stays bounded.
    const logger = new Logger({ minLevel: 'info', filePath: path, console: false })

    // Write ~10x the ceiling of data. Each line is small; this forces many
    // rotations under the real MAX_FILE_BYTES.
    const bigLine = 'x'.repeat(512)
    const linesToExceed = Math.ceil((MAX_FILE_BYTES * (KEEP_FILES + 2)) / (bigLine.length + 30))
    for (let i = 0; i < linesToExceed; i++) {
      logger.info('bench', bigLine)
    }

    // Total on disk across active + rotated files must respect the hard cap.
    let total = 0
    for (let i = 0; i <= KEEP_FILES; i++) {
      const f = i === 0 ? path : `${path}.${i}`
      if (existsSync(f)) total += statSync(f).size
    }
    // Allow a single line of slack (a rotation triggers only after exceeding,
    // so the active file may be marginally over MAX_FILE_BYTES at any instant).
    const oneLineSlack = bigLine.length + 60
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_DISK_BYTES + oneLineSlack)

    // No file beyond the kept set should survive.
    expect(existsSync(`${path}.${KEEP_FILES + 1}`)).toBe(false)
    void logger
    void smallCap
  })

  it('survives an unwritable path without throwing', () => {
    // A path whose parent cannot be created — logging must degrade silently.
    const logger = new Logger({
      minLevel: 'info',
      filePath: '/nonexistent-root-dir/cannot/create/portico.log',
      console: false
    })
    expect(() => logger.error('app', 'boom')).not.toThrow()
  })
})

// ---- level enum sanity ---------------------------------------------------

describe('level weights', () => {
  it('error is the most severe', () => {
    const order: LogLevel[] = ['debug', 'info', 'warn', 'error']
    order.forEach((lvl, i) => {
      order.slice(i + 1).forEach((higher) => {
        expect(shouldLog(higher, lvl)).toBe(true)
      })
    })
  })
})
