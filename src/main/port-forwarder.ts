import { createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Client } from 'ssh2'
import type { PortForwardRule, PortForwardStatus } from '@shared/types.js'
import { getLogger } from './logger.js'

const log = getLogger()

interface ForwardEntry {
  rule: PortForwardRule
  server: Server
  activeSockets: Set<Socket>
  state: 'listening' | 'error' | 'stopped'
  error?: string
}

export class PortForwarder extends EventEmitter {
  private forwards = new Map<string, ForwardEntry>()
  /** When false, new local connections are rejected and state shows stopped. */
  private tunnelsEnabled = true

  constructor(private readonly getClient: () => Client | null) {
    super()
  }

  async add(opts: {
    localPort: number
    remoteHost: string
    remotePort: number
  }): Promise<PortForwardRule> {
    for (const entry of this.forwards.values()) {
      if (entry.rule.localPort === opts.localPort) {
        throw Object.assign(
          new Error(`Port ${opts.localPort} is already forwarded.`),
          { code: 'PORT_IN_USE' }
        )
      }
    }

    const rule: PortForwardRule = {
      id: randomUUID(),
      localPort: opts.localPort,
      remoteHost: opts.remoteHost,
      remotePort: opts.remotePort
    }

    const entry: ForwardEntry = {
      rule,
      server: null!,
      activeSockets: new Set(),
      state: 'listening'
    }

    const server = createServer((localSocket) => {
      this.handleConnection(entry, localSocket)
    })

    entry.server = server

    server.on('error', (err: NodeJS.ErrnoException) => {
      log.error('pfforward', 'forward server error', { localPort: opts.localPort, err })
      entry.state = 'error'
      entry.error = err.message
      this.emitChange()
    })

    await new Promise<void>((resolve, reject) => {
      server.listen(opts.localPort, '127.0.0.1', () => resolve())
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          log.warn('pfforward', 'listen failed: port in use', { localPort: opts.localPort })
          reject(
            Object.assign(new Error(`Port ${opts.localPort} is already in use.`), {
              code: 'PORT_IN_USE'
            })
          )
        } else {
          log.error('pfforward', 'listen failed', { localPort: opts.localPort, err })
          reject(
            Object.assign(new Error(err.message), { code: 'PF_LISTEN_FAILED' })
          )
        }
      })
    })

    this.forwards.set(rule.id, entry)
    this.emitChange()
    return rule
  }

  remove(id: string): void {
    const entry = this.forwards.get(id)
    if (!entry) return
    this.closeEntry(entry)
    this.forwards.delete(id)
    this.emitChange()
  }

  list(): PortForwardStatus[] {
    return [...this.forwards.values()].map((e) => ({
      ...e.rule,
      state: e.state,
      activeConnections: e.activeSockets.size,
      error: e.error
    }))
  }

  /** Drop live tunnels and mark forwards stopped until resume (SSH reconnect). */
  dropActiveTunnels(): void {
    this.tunnelsEnabled = false
    for (const entry of this.forwards.values()) {
      for (const sock of entry.activeSockets) {
        sock.destroy()
      }
      entry.activeSockets.clear()
      if (entry.state !== 'error') {
        entry.state = 'stopped'
        entry.error = 'SSH disconnected — waiting to reconnect'
      }
    }
    this.emitChange()
  }

  resumeAll(): void {
    this.tunnelsEnabled = true
    for (const entry of this.forwards.values()) {
      if (!entry.server.listening) {
        entry.state = 'stopped'
        entry.error = 'Local listener stopped'
      } else {
        entry.state = 'listening'
        entry.error = undefined
      }
    }
    this.emitChange()
  }

  destroyAll(): void {
    this.tunnelsEnabled = false
    for (const entry of this.forwards.values()) {
      this.closeEntry(entry)
    }
    this.forwards.clear()
    this.emitChange()
  }

  private handleConnection(entry: ForwardEntry, localSocket: Socket): void {
    if (!this.tunnelsEnabled) {
      entry.state = 'stopped'
      entry.error = entry.error ?? 'SSH disconnected — waiting to reconnect'
      localSocket.destroy()
      this.emitChange()
      return
    }

    const client = this.getClient()
    if (!client) {
      entry.state = 'stopped'
      entry.error = 'No SSH client'
      localSocket.destroy()
      this.emitChange()
      return
    }

    const srcIP = localSocket.remoteAddress || '127.0.0.1'
    const srcPort = localSocket.remotePort || 0

    client.forwardOut(
      srcIP,
      srcPort,
      entry.rule.remoteHost,
      entry.rule.remotePort,
      (err, sshStream) => {
        if (err) {
          log.warn('pfforward', 'tunnel forwardOut failed', {
            localPort: entry.rule.localPort,
            remoteHost: entry.rule.remoteHost,
            remotePort: entry.rule.remotePort,
            err
          })
          entry.state = 'error'
          entry.error = err.message
          localSocket.destroy()
          this.emitChange()
          return
        }

        entry.activeSockets.add(localSocket)
        if (entry.state !== 'listening') {
          entry.state = 'listening'
          entry.error = undefined
        }
        this.emitChange()

        localSocket.pipe(sshStream).pipe(localSocket)

        let cleaned = false
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          entry.activeSockets.delete(localSocket)
          try {
            localSocket.destroy()
          } catch {
            /* ignore */
          }
          try {
            sshStream.destroy()
          } catch {
            /* ignore */
          }
          this.emitChange()
        }

        localSocket.on('close', cleanup)
        localSocket.on('error', cleanup)
        sshStream.on('close', cleanup)
        sshStream.on('error', cleanup)
      }
    )
  }

  private closeEntry(entry: ForwardEntry): void {
    for (const sock of entry.activeSockets) {
      sock.destroy()
    }
    entry.activeSockets.clear()
    entry.server.close()
    entry.state = 'stopped'
  }

  private emitChange(): void {
    this.emit('change')
  }
}
