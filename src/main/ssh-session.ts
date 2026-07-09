/**
 * SSH session manager for a single remote host.
 *
 * Owns one `ssh2` Client plus:
 *  - a single interactive PTY shell (for the xterm view + command injection),
 *  - an on-demand SFTP channel (for blob uploads / cache GC).
 *
 * Responsibilities:
 *  - connect / disconnect / reconnect-safe teardown
 *  - pump terminal data in and out
 *  - resolve `~` to an absolute home path on the remote side
 *  - expose a small set of focused methods (upload, readFile, runAndCapture)
 *
 * Failure model: methods reject with an Error carrying `.code`. Callers wrap
 * them into `Result` via the IPC layer.
 */
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import { EventEmitter } from 'node:events'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { PORTICO_REMOTE_DIR } from '@shared/constants.js'
import type { SshTarget } from '@shared/types.js'
import { createHostVerifier } from './host-key.js'
import { getLogger, redactTarget } from './logger.js'

/** Expand a leading `~` / `~/...` to the local home directory. */
export function expandHomePath(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return homedir() + p.slice(1)
  return p
}

const log = getLogger()

export type ConnectPhaseStep = 'tcp' | 'auth' | 'shell' | 'home'

export interface SshSessionEvents {
  data: (chunk: string) => void
  close: () => void
  error: (err: Error) => void
}

export interface ResizeArgs {
  cols: number
  rows: number
}

export interface ConnectOptions {
  onReady?: (info: { initialCwd: string }) => void
  /** Fired as the handshake progresses (tcp → auth → shell → home). */
  onPhase?: (phase: ConnectPhaseStep) => void
}

export class SshSession extends EventEmitter {
  private client: Client | null = null
  private stream: ClientChannel | null = null
  private sftp: SFTPWrapper | null = null
  private connected = false
  private userDisconnect = false
  private initialCwd = ''
  private buffer: string[] = []
  private readonly MAX_BUFFER_LINES = 400

  constructor(private readonly target: SshTarget) {
    super()
  }

  getClient(): Client | null {
    return this.client
  }

  isConnected(): boolean {
    return this.connected && !!this.stream
  }

  /** Recent terminal output, oldest first, capped. Used for provider detection. */
  recentOutput(): string[] {
    return [...this.buffer]
  }

  async connect(opts: ConnectOptions = {}): Promise<{ initialCwd: string }> {
    if (this.connected) return { initialCwd: this.initialCwd }
    this.userDisconnect = false
    const t = this.target
    const client = new Client()
    this.client = client

    // Load the private key file (if any) before connecting, so ssh2 receives the
    // key material directly rather than a path it may not resolve the same way.
    let privateKey: Buffer | undefined
    if (t.privateKeyPath) {
      const keyPath = expandHomePath(t.privateKeyPath)
      try {
        privateKey = await readFile(keyPath)
      } catch (e) {
        this.client = null
        throw Object.assign(new Error(`Cannot read private key: ${(e as Error).message}`), {
          code: 'SSH_KEY'
        })
      }
    }

    let agent: string | undefined
    if (t.useAgent) {
      const sock = process.env.SSH_AUTH_SOCK
      if (sock) {
        agent = sock
      } else if (process.platform === 'win32') {
        // Pageant is the common Windows agent; ssh2 accepts the magic name.
        agent = 'pageant'
      } else {
        this.client = null
        throw Object.assign(
          new Error('SSH agent not available (SSH_AUTH_SOCK unset).'),
          { code: 'SSH_AGENT' }
        )
      }
    }

    try {
      opts.onPhase?.('tcp')
      opts.onPhase?.('auth')

      await new Promise<void>((resolve, reject) => {
        const onErr = (err: Error) => {
          const code =
            /Host denied|verification failed/i.test(err.message) ? 'HOST_KEY_MISMATCH' : 'SSH_CONNECT'
          const message =
            code === 'HOST_KEY_MISMATCH'
              ? `HOST_KEY_MISMATCH: remote host key for ${t.host}:${t.port} does not match known_hosts.`
              : err.message
          log.error('ssh', 'connect failed', { ...redactTarget(t), err, code })
          reject(Object.assign(new Error(message), { code }))
        }

        client.once('ready', () => {
          client.removeListener('error', onErr)
          resolve()
        })
        client.once('error', onErr)

        client.connect({
          host: t.host,
          port: t.port,
          username: t.user,
          password: t.password,
          privateKey,
          passphrase: t.privateKeyPassphrase,
          agent,
          hostVerifier: createHostVerifier(t.host, t.port),
          readyTimeout: 20_000,
          keepaliveInterval: 15_000,
          keepaliveCountMax: 3
        })
      })

      // Detect unexpected connection loss at the transport level.
      client.on('close', () => {
        if (!this.userDisconnect && this.connected) {
          log.warn('ssh', 'transport closed unexpectedly', redactTarget(t))
          this.connected = false
          this.sftp = null
          this.emit('close', { intentional: false })
        }
      })

      // Open an interactive PTY shell.
      opts.onPhase?.('shell')
      await new Promise<void>((resolve, reject) => {
        client.shell(
          { term: 'xterm-256color', cols: 80, rows: 24 },
          (err, stream) => {
            if (err) {
              log.error('ssh', 'shell open failed', { ...redactTarget(t), err })
              return reject(Object.assign(new Error(err.message), { code: 'SSH_SHELL' }))
            }
            this.stream = stream
            stream.on('data', (d: Buffer) => {
              const text = d.toString('utf8')
              this.pushBuffer(text)
              this.emit('data', text)
            })
            stream.on('close', () => {
              if (!this.userDisconnect && this.connected) {
                log.warn('ssh', 'shell stream closed unexpectedly', redactTarget(t))
                this.connected = false
                this.sftp = null
                this.emit('close', { intentional: false })
              }
            })
            resolve()
          }
        )
      })

      // Resolve the home directory and our blob dir absolutely.
      opts.onPhase?.('home')
      this.initialCwd = await this.runAndCapture('echo $HOME', { timeoutMs: 10_000 }).then((s) =>
        s.trim()
      )
      this.connected = true
      opts.onReady?.({ initialCwd: this.initialCwd })
      return { initialCwd: this.initialCwd }
    } catch (e) {
      // Tear down any half-open client/stream so we never leak orphans.
      // Do not emit 'close' — the connect() promise rejection is the signal.
      await this.teardownQuiet().catch(() => {})
      throw e
    }
  }

  /** End client/stream/sftp without emitting lifecycle events. */
  private async teardownQuiet(): Promise<void> {
    this.userDisconnect = true
    const sftp = this.sftp
    const stream = this.stream
    const client = this.client
    this.sftp = null
    this.stream = null
    this.client = null
    this.connected = false
    try {
      stream?.close()
    } catch {
      /* ignore */
    }
    try {
      sftp?.end()
    } catch {
      /* ignore */
    }
    if (client) {
      try {
        client.end()
      } catch {
        /* ignore */
      }
    }
  }

  private pushBuffer(text: string): void {
    const lines = text.split(/\r?\n/)
    for (const l of lines) this.buffer.push(l)
    if (this.buffer.length > this.MAX_BUFFER_LINES) {
      this.buffer.splice(0, this.buffer.length - this.MAX_BUFFER_LINES)
    }
  }

  /** Send keystrokes/UTF-8 to the remote PTY. */
  write(data: string): void {
    if (!this.stream) throw Object.assign(new Error('Not connected'), { code: 'NOT_CONNECTED' })
    this.stream.write(data)
  }

  resize(dim: ResizeArgs): void {
    if (!this.stream) return
    this.stream.setWindow(dim.rows, dim.cols, 0, 0)
  }

  /** Lazily open and cache an SFTP channel. */
  private async getSftp(): Promise<SFTPWrapper> {
    if (this.sftp) return this.sftp
    if (!this.client) throw Object.assign(new Error('Not connected'), { code: 'NOT_CONNECTED' })
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      this.client!.sftp((err, s) => {
        if (err) {
          log.error('ssh', 'sftp open failed', { err })
          return reject(Object.assign(new Error(err.message), { code: 'SSH_SFTP' }))
        }
        resolve(s)
      })
    })
    this.sftp = sftp
    return sftp
  }

  /**
   * Resolve a remote path that may start with `~` to an absolute path using the
   * connection's known $HOME.
   */
  resolveRemote(p: string): string {
    if (p.startsWith('~/')) return `${this.initialCwd}/${p.slice(2)}`
    if (p === '~') return this.initialCwd
    return p
  }

  /** Ensure a remote directory exists (mkdir -p), swallowing "already exists". */
  async ensureRemoteDir(absDir: string): Promise<void> {
    const sftp = await this.getSftp()
    const parts = absDir.split('/').filter(Boolean)
    let cur = absDir.startsWith('/') ? '/' : ''
    for (const part of parts) {
      cur = cur === '/' ? `/${part}` : `${cur}/${part}`
      await mkdirP(sftp, cur)
    }
  }

  /** Atomically write a buffer to a remote temp path then rename into place. */
  async uploadBuffer(data: Buffer, absDest: string): Promise<void> {
    const sftp = await this.getSftp()
    const dir = absDest.slice(0, Math.max(0, absDest.lastIndexOf('/')))
    if (dir) await this.ensureRemoteDir(dir)
    const tmp = `${absDest}.portico-tmp-${Date.now()}`
    await new Promise<void>((resolve, reject) => {
      const ws = sftp.createWriteStream(tmp)
      ws.on('error', (e: Error) => reject(Object.assign(new Error(e.message), { code: 'SSH_WRITE' })))
      ws.on('close', () => resolve())
      ws.end(data)
    })
    await new Promise<void>((resolve, reject) => {
      sftp.rename(tmp, absDest, (e) => {
        if (e) {
          // dest may already exist (content-addressed, idempotent) — clean tmp.
          sftp.unlink(tmp, () => {})
          // stat the destination; if it exists, treat as success.
          sftp.stat(absDest, (statErr) => (statErr ? reject(Object.assign(new Error(e.message), { code: 'SSH_RENAME' })) : resolve()))
        } else {
          resolve()
        }
      })
    })
  }

  /** Run a command non-interactively over a fresh exec channel and capture stdout. */
  async runAndCapture(cmd: string, opts: { timeoutMs?: number } = {}): Promise<string> {
    if (!this.client) throw Object.assign(new Error('Not connected'), { code: 'NOT_CONNECTED' })
    return new Promise<string>((resolve, reject) => {
      let out = ''
      let settled = false
      let stream: ClientChannel | null = null
      const done = (err?: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (err && stream) {
          try {
            stream.close()
          } catch {
            /* ignore */
          }
        }
        err ? reject(Object.assign(new Error(err.message), { code: 'SSH_EXEC' })) : resolve(out)
      }
      const timer = opts.timeoutMs
        ? setTimeout(() => done(new Error('command timed out')), opts.timeoutMs)
        : undefined
      this.client!.exec(cmd, (e, s) => {
        if (e) return done(e)
        stream = s
        s.on('data', (d: Buffer) => (out += d.toString('utf8')))
        s.stderr.on('data', () => {}) // swallow; capture stdout only
        s.on('close', () => done())
      })
    })
  }

  /** Delete files matching a predicate inside a remote directory. */
  async deleteFilesIn(dir: string, match: (name: string) => boolean): Promise<number> {
    const sftp = await this.getSftp()
    const abs = this.resolveRemote(dir)
    const list: { filename: string }[] = await new Promise((resolve, reject) => {
      sftp.readdir(abs, (e, items) => (e ? reject(Object.assign(new Error(e.message), { code: 'SSH_READDIR' })) : resolve(items as { filename: string }[])))
    })
    let deleted = 0
    for (const it of list) {
      if (!match(it.filename)) continue
      await new Promise<void>((resolve) => {
        sftp.unlink(`${abs}/${it.filename}`, (e) => {
          // Only count successful unlinks so the UI number matches reality.
          if (!e) deleted++
          resolve()
        })
      })
    }
    return deleted
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true
    const sftp = this.sftp
    const stream = this.stream
    const client = this.client
    this.sftp = null
    this.stream = null
    this.client = null
    this.connected = false
    try {
      stream?.close()
    } catch {
      /* ignore */
    }
    try {
      sftp?.end()
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      if (!client) return resolve()
      client.end()
      resolve()
    })
    this.emit('close', { intentional: true })
  }

  /** The conventional remote blob dir (~/.portico/blobs) for this session. */
  remoteBlobDir(): string {
    return PORTICO_REMOTE_DIR
  }
}

async function mkdirP(sftp: SFTPWrapper, dir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    sftp.mkdir(dir, (e) => {
      if (!e) return resolve()
      // ssh2 returns status 4 (FAILURE) when the dir already exists.
      const code = (e as { code?: number }).code
      if (code === 4 || /exists/i.test(e.message)) return resolve()
      reject(Object.assign(new Error(e.message), { code: 'SSH_MKDIR' }))
    })
  })
}

/** Extract the extension from a filename, lower-cased, no dot. */
export function extOf(name: string): string {
  return basename(name).slice(Math.max(0, basename(name).lastIndexOf('.') + 1)).toLowerCase()
}
