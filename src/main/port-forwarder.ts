import { createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Client } from 'ssh2'
import type { PortForwardRule, PortForwardStatus } from '@shared/types.js'

interface ForwardEntry {
  rule: PortForwardRule
  server: Server
  activeSockets: Set<Socket>
  state: 'listening' | 'error' | 'stopped'
  error?: string
}

export class PortForwarder extends EventEmitter {
  private forwards = new Map<string, ForwardEntry>()

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
      entry.state = 'error'
      entry.error = err.message
      this.emitChange()
    })

    await new Promise<void>((resolve, reject) => {
      server.listen(opts.localPort, '127.0.0.1', () => resolve())
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(
            Object.assign(new Error(`Port ${opts.localPort} is already in use.`), {
              code: 'PORT_IN_USE'
            })
          )
        } else {
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

  dropActiveTunnels(): void {
    for (const entry of this.forwards.values()) {
      for (const sock of entry.activeSockets) {
        sock.destroy()
      }
      entry.activeSockets.clear()
    }
    this.emitChange()
  }

  resumeAll(): void {
    for (const entry of this.forwards.values()) {
      if (!entry.server.listening) {
        entry.state = 'stopped'
      } else {
        entry.state = 'listening'
        entry.error = undefined
      }
    }
    this.emitChange()
  }

  destroyAll(): void {
    for (const entry of this.forwards.values()) {
      this.closeEntry(entry)
    }
    this.forwards.clear()
    this.emitChange()
  }

  private handleConnection(entry: ForwardEntry, localSocket: Socket): void {
    const client = this.getClient()
    if (!client) {
      localSocket.destroy()
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
          localSocket.destroy()
          return
        }

        entry.activeSockets.add(localSocket)
        this.emitChange()

        localSocket.pipe(sshStream).pipe(localSocket)

        const cleanup = () => {
          entry.activeSockets.delete(localSocket)
          localSocket.destroy()
          sshStream.destroy()
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
