/**
 * Local interactive PTY (macOS/Linux $SHELL, Windows PowerShell).
 * Mirrors the I/O surface of SshSession for SessionHandle routing.
 */
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import { getLogger } from './logger.js'

const log = getLogger()

export interface LocalResizeArgs {
  cols: number
  rows: number
}

export class LocalSession extends EventEmitter {
  private term: pty.IPty | null = null
  private connected = false
  private userDisconnect = false
  private buffer: string[] = []
  private readonly MAX_BUFFER_LINES = 400
  private shellPath = ''
  private cwd = ''

  isConnected(): boolean {
    return this.connected && !!this.term
  }

  /** PTY master process id (shell); used for AI child process probing. */
  pid(): number | undefined {
    return this.term?.pid
  }

  shellName(): string {
    if (!this.shellPath) return 'shell'
    const base = this.shellPath.split(/[/\\]/).pop() ?? 'shell'
    return base.replace(/\.exe$/i, '')
  }

  recentOutput(): string[] {
    return [...this.buffer]
  }

  async connect(opts?: { cols?: number; rows?: number }): Promise<{ shell: string; cwd: string }> {
    if (this.connected && this.term) {
      return { shell: this.shellPath, cwd: this.cwd }
    }
    this.userDisconnect = false
    const shell = resolveShell()
    const cwd = homedir()
    const cols = opts?.cols ?? 80
    const rows = opts?.rows ?? 24

    try {
      const term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as Record<string, string>
      })
      this.term = term
      this.shellPath = shell
      this.cwd = cwd
      this.connected = true

      term.onData((data: string) => {
        this.pushBuffer(data)
        this.emit('data', data)
      })
      term.onExit(({ exitCode, signal }) => {
        log.info('local-pty', 'shell exited', { exitCode, signal, intentional: this.userDisconnect })
        this.connected = false
        this.term = null
        this.emit('close', { intentional: this.userDisconnect })
      })

      log.info('local-pty', 'spawned', { shell, cwd, cols, rows })
      return { shell, cwd }
    } catch (e) {
      this.term = null
      this.connected = false
      throw Object.assign(new Error((e as Error).message || 'Failed to spawn local shell'), {
        code: 'LOCAL_SPAWN_FAILED'
      })
    }
  }

  write(data: string): void {
    if (!this.term) throw Object.assign(new Error('Not connected'), { code: 'NOT_CONNECTED' })
    this.term.write(data)
  }

  resize(dim: LocalResizeArgs): void {
    if (!this.term) return
    try {
      this.term.resize(Math.max(2, dim.cols), Math.max(1, dim.rows))
    } catch (e) {
      log.warn('local-pty', 'resize failed', { err: e as Error })
    }
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true
    const term = this.term
    this.term = null
    this.connected = false
    if (!term) return
    try {
      term.kill()
    } catch {
      /* ignore */
    }
    // Emit intentional close if listeners still care (handle may already ignore).
    this.emit('close', { intentional: true })
  }

  private pushBuffer(text: string): void {
    const lines = text.split(/\r?\n/)
    for (const l of lines) this.buffer.push(l)
    if (this.buffer.length > this.MAX_BUFFER_LINES) {
      this.buffer.splice(0, this.buffer.length - this.MAX_BUFFER_LINES)
    }
  }
}

function resolveShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}
