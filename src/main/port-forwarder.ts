/**
 * SSH local (`-L`), remote (`-R`), and dynamic SOCKS5 (`-D`) port forwarding
 * over an ssh2 Client.
 *
 * Design notes:
 *  - Rules outlive transient SSH disconnects: suspend keeps the rule list;
 *    resume re-binds listeners / reverse forwards when the client is back.
 *  - A single failed tunnel connection does NOT mark the whole rule as error
 *    (dev servers often start a few seconds after the banner appears).
 *  - localPort 0 auto-assigns an ephemeral listen port (local / dynamic).
 *  - bytesUp / bytesDown accumulate for the process lifetime of each rule.
 */
import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Client, ClientChannel } from 'ssh2'
import type {
  PortForwardDirection,
  PortForwardRule,
  PortForwardStatus
} from '@shared/types.js'
import { getLogger } from './logger.js'
import {
  socks5Handshake,
  socks5MapError,
  socks5ReplyFailure,
  socks5ReplySuccess
} from './socks5.js'

const log = getLogger()

/** How long to wait for ssh2 forwardOut before aborting a local socket. */
const FORWARD_OUT_TIMEOUT_MS = 12_000
/** Consecutive connect failures before surfacing a soft warning on the rule. */
const WARN_AFTER_FAILURES = 3
/** Throttle UI pushes when only byte counters change. */
const STATS_EMIT_MS = 750

export interface PortForwardAddOpts {
  direction?: PortForwardDirection
  localPort: number
  remoteHost: string
  remotePort: number
  bindHost?: string
  label?: string
  enabled?: boolean
  /** Stable id when restoring a persisted rule. */
  id?: string
}

interface ForwardEntry {
  rule: PortForwardRule
  /** Local TCP server (local / dynamic). */
  server: Server | null
  /** Actual listen port after bind (may differ from rule.localPort when 0). */
  effectiveLocalPort: number
  activeSockets: Set<Socket>
  state: PortForwardStatus['state']
  error?: string
  lastConnectError?: string
  consecutiveFailures: number
  /** Remote reverse-forward bound port (may differ when remotePort was 0). */
  effectiveRemotePort: number
  bytesUp: number
  bytesDown: number
}

function parseDirection(d?: string): PortForwardDirection {
  if (d === 'remote') return 'remote'
  if (d === 'dynamic') return 'dynamic'
  return 'local'
}

function defaultBindHost(direction: PortForwardDirection, bindHost?: string): string {
  if (bindHost && bindHost.trim()) return bindHost.trim()
  return '127.0.0.1'
}

function listensLocally(direction: PortForwardDirection): boolean {
  return direction === 'local' || direction === 'dynamic'
}

export class PortForwarder extends EventEmitter {
  private forwards = new Map<string, ForwardEntry>()
  /** When false, local accepts are rejected and reverse connections ignored. */
  private tunnelsEnabled = true
  private tcpConnectionHooked = false
  private statsEmitTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onTcpConnection: (
    details: { destIP: string; destPort: number; srcIP: string; srcPort: number },
    accept: () => ClientChannel,
    reject: () => void
  ) => void

  constructor(private readonly getClient: () => Client | null) {
    super()
    this.onTcpConnection = (details, accept, reject) => {
      this.handleReverseConnection(details, accept, reject)
    }
  }

  /** Snapshot of rules suitable for session persistence. */
  exportSpecs(): PortForwardAddOpts[] {
    return [...this.forwards.values()].map((e) => ({
      id: e.rule.id,
      direction: e.rule.direction,
      localPort:
        listensLocally(e.rule.direction) && e.rule.localPort === 0
          ? e.effectiveLocalPort || 0
          : e.rule.localPort,
      remoteHost: e.rule.remoteHost,
      remotePort:
        e.rule.direction === 'remote' && e.rule.remotePort === 0
          ? e.effectiveRemotePort || e.rule.remotePort
          : e.rule.remotePort,
      bindHost: e.rule.bindHost,
      label: e.rule.label,
      enabled: e.rule.enabled
    }))
  }

  /** Local listen ports claimed by this forwarder (local + dynamic). */
  claimedLocalPorts(): number[] {
    const ports: number[] = []
    for (const e of this.forwards.values()) {
      if (!listensLocally(e.rule.direction)) continue
      if (!e.rule.enabled) continue
      const p = e.effectiveLocalPort || e.rule.localPort
      if (p > 0) ports.push(p)
    }
    return ports
  }

  async add(opts: PortForwardAddOpts): Promise<PortForwardRule> {
    const direction = parseDirection(opts.direction)
    const localPort = opts.localPort

    if (!Number.isInteger(localPort) || localPort < 0 || localPort > 65535) {
      throw Object.assign(new Error('Invalid local port.'), { code: 'INVALID_PORT' })
    }
    if (direction === 'remote' && localPort < 1) {
      throw Object.assign(new Error('Invalid local port.'), { code: 'INVALID_PORT' })
    }

    let remoteHost = (opts.remoteHost || '127.0.0.1').trim()
    let remotePort = opts.remotePort

    if (direction === 'dynamic') {
      remoteHost = 'socks5'
      remotePort = 0
    } else {
      if (
        !Number.isInteger(remotePort) ||
        remotePort < 0 ||
        remotePort > 65535 ||
        (direction === 'local' && remotePort < 1)
      ) {
        throw Object.assign(new Error('Invalid remote port.'), { code: 'INVALID_PORT' })
      }
      if (!remoteHost) {
        throw Object.assign(new Error('Remote host required.'), { code: 'INVALID_HOST' })
      }
    }

    const bindHost = defaultBindHost(direction, opts.bindHost)

    // Duplicate local listen port (local + dynamic fixed ports).
    if (listensLocally(direction) && localPort > 0) {
      for (const entry of this.forwards.values()) {
        if (!listensLocally(entry.rule.direction)) continue
        const existing = entry.effectiveLocalPort || entry.rule.localPort
        if (existing === localPort && entry.rule.enabled) {
          throw Object.assign(new Error(`Port ${localPort} is already forwarded.`), {
            code: 'PORT_IN_USE'
          })
        }
      }
    }

    const rule: PortForwardRule = {
      id: opts.id || randomUUID(),
      direction,
      localPort,
      remoteHost,
      remotePort,
      bindHost,
      label: opts.label?.trim() || undefined,
      enabled: opts.enabled !== false
    }

    if (this.forwards.has(rule.id)) {
      throw Object.assign(new Error('Forward id already exists.'), { code: 'DUPLICATE_ID' })
    }

    const entry: ForwardEntry = {
      rule,
      server: null,
      effectiveLocalPort: localPort,
      activeSockets: new Set(),
      state: rule.enabled ? 'stopped' : 'paused',
      consecutiveFailures: 0,
      effectiveRemotePort: remotePort,
      bytesUp: 0,
      bytesDown: 0
    }
    this.forwards.set(rule.id, entry)

    if (rule.enabled && this.tunnelsEnabled) {
      try {
        if (listensLocally(direction)) {
          await this.startLocalListener(entry)
        } else {
          await this.startReverseForward(entry)
        }
      } catch (e) {
        this.forwards.delete(rule.id)
        throw e
      }
    }

    this.emitChange()
    return { ...entry.rule, localPort: entry.effectiveLocalPort || entry.rule.localPort }
  }

  remove(id: string): void {
    const entry = this.forwards.get(id)
    if (!entry) return
    void this.stopEntry(entry)
    this.forwards.delete(id)
    this.emitChange()
  }

  async setEnabled(id: string, enabled: boolean): Promise<PortForwardRule | null> {
    const entry = this.forwards.get(id)
    if (!entry) return null
    if (entry.rule.enabled === enabled) return { ...entry.rule }

    entry.rule = { ...entry.rule, enabled }
    if (!enabled) {
      await this.stopEntry(entry)
      entry.state = 'paused'
      entry.error = undefined
    } else if (this.tunnelsEnabled) {
      try {
        if (listensLocally(entry.rule.direction)) {
          await this.startLocalListener(entry)
        } else {
          await this.startReverseForward(entry)
        }
      } catch (e) {
        entry.state = 'error'
        entry.error = (e as Error).message
        this.emitChange()
        throw e
      }
    } else {
      entry.state = 'stopped'
      entry.error = 'SSH disconnected — waiting to reconnect'
    }
    this.emitChange()
    return { ...entry.rule }
  }

  /** Reset cumulative byte counters for one rule (or all when id omitted). */
  resetStats(id?: string): void {
    if (id) {
      const e = this.forwards.get(id)
      if (e) {
        e.bytesUp = 0
        e.bytesDown = 0
      }
    } else {
      for (const e of this.forwards.values()) {
        e.bytesUp = 0
        e.bytesDown = 0
      }
    }
    this.emitChange()
  }

  list(): PortForwardStatus[] {
    return [...this.forwards.values()].map((e) => this.toStatus(e))
  }

  private toStatus(e: ForwardEntry): PortForwardStatus {
    return {
      ...e.rule,
      state: e.state,
      activeConnections: e.activeSockets.size,
      error: e.error,
      effectiveLocalPort: listensLocally(e.rule.direction)
        ? e.effectiveLocalPort || e.rule.localPort || undefined
        : e.rule.localPort || undefined,
      lastConnectError: e.lastConnectError,
      bytesUp: e.bytesUp,
      bytesDown: e.bytesDown
    }
  }

  /**
   * Drop live tunnels and mark forwards stopped until resume (SSH reconnect).
   * Local listeners stay up so the OS port remains reserved; connections are
   * rejected until tunnels are re-enabled.
   */
  dropActiveTunnels(): void {
    this.tunnelsEnabled = false
    for (const entry of this.forwards.values()) {
      for (const sock of entry.activeSockets) {
        sock.destroy()
      }
      entry.activeSockets.clear()
      if (entry.rule.enabled && entry.state !== 'error' && entry.state !== 'paused') {
        entry.state = 'stopped'
        entry.error = 'SSH disconnected — waiting to reconnect'
      }
    }
    this.emitChange()
  }

  /**
   * Fully stop listeners / reverse binds but keep rule definitions
   * (intentional disconnect — ports freed, rules restored on next connect).
   */
  async suspendAll(): Promise<void> {
    this.tunnelsEnabled = false
    this.unhookTcpConnection()
    for (const entry of this.forwards.values()) {
      await this.stopEntry(entry)
      if (entry.rule.enabled) {
        entry.state = 'stopped'
        entry.error = 'Disconnected'
      } else {
        entry.state = 'paused'
      }
    }
    this.emitChange()
  }

  /** Re-enable tunnels after SSH reconnect (listeners already up for local/dynamic). */
  resumeAll(): void {
    this.tunnelsEnabled = true
    for (const entry of this.forwards.values()) {
      if (!entry.rule.enabled) {
        entry.state = 'paused'
        entry.error = undefined
        continue
      }
      if (listensLocally(entry.rule.direction)) {
        if (entry.server?.listening) {
          entry.state = 'listening'
          entry.error = undefined
        } else {
          void this.startLocalListener(entry).catch((e) => {
            entry.state = 'error'
            entry.error = (e as Error).message
            this.emitChange()
          })
        }
      } else {
        void this.startReverseForward(entry).catch((e) => {
          entry.state = 'error'
          entry.error = (e as Error).message
          this.emitChange()
        })
      }
    }
    this.emitChange()
  }

  /**
   * After a full suspend (or brand-new PortForwarder with re-added rules),
   * call this once the SSH client is live to bind everything.
   */
  async rebindAll(): Promise<void> {
    this.tunnelsEnabled = true
    for (const entry of this.forwards.values()) {
      if (!entry.rule.enabled) {
        entry.state = 'paused'
        continue
      }
      try {
        if (listensLocally(entry.rule.direction)) {
          if (!entry.server?.listening) {
            await this.startLocalListener(entry)
          } else {
            entry.state = 'listening'
            entry.error = undefined
          }
        } else {
          await this.startReverseForward(entry)
        }
      } catch (e) {
        entry.state = 'error'
        entry.error = (e as Error).message
        log.warn('pfforward', 'rebind failed', {
          id: entry.rule.id,
          err: e as Error
        })
      }
    }
    this.emitChange()
  }

  destroyAll(): void {
    this.tunnelsEnabled = false
    this.unhookTcpConnection()
    if (this.statsEmitTimer) {
      clearTimeout(this.statsEmitTimer)
      this.statsEmitTimer = null
    }
    for (const entry of this.forwards.values()) {
      void this.stopEntry(entry)
    }
    this.forwards.clear()
    this.emitChange()
  }

  private async startLocalListener(entry: ForwardEntry): Promise<void> {
    if (entry.server?.listening) {
      entry.state = 'listening'
      entry.error = undefined
      return
    }

    const bindHost = entry.rule.bindHost || '127.0.0.1'
    const wantPort = entry.rule.localPort

    const server = createServer((localSocket) => {
      if (entry.rule.direction === 'dynamic') {
        void this.handleSocksConnection(entry, localSocket)
      } else {
        this.handleLocalConnection(entry, localSocket)
      }
    })

    entry.server = server

    server.on('error', (err: NodeJS.ErrnoException) => {
      log.error('pfforward', 'forward server error', {
        localPort: wantPort,
        err
      })
      entry.state = 'error'
      entry.error = err.message
      this.emitChange()
    })

    await new Promise<void>((resolve, reject) => {
      server.listen(wantPort, bindHost, () => resolve())
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          log.warn('pfforward', 'listen failed: port in use', { localPort: wantPort })
          reject(
            Object.assign(
              new Error(
                wantPort > 0
                  ? `Port ${wantPort} is already in use.`
                  : 'Could not bind an ephemeral local port.'
              ),
              { code: 'PORT_IN_USE' }
            )
          )
        } else {
          log.error('pfforward', 'listen failed', { localPort: wantPort, err })
          reject(Object.assign(new Error(err.message), { code: 'PF_LISTEN_FAILED' }))
        }
      })
    })

    const addr = server.address()
    if (addr && typeof addr === 'object') {
      entry.effectiveLocalPort = addr.port
      if (entry.rule.localPort === 0) {
        entry.rule = { ...entry.rule, localPort: addr.port }
      }
    }

    entry.state = 'listening'
    entry.error = undefined
  }

  private async startReverseForward(entry: ForwardEntry): Promise<void> {
    const client = this.getClient()
    if (!client) {
      entry.state = 'stopped'
      entry.error = 'No SSH client'
      return
    }

    this.hookTcpConnection(client)

    const remoteBind = entry.rule.remoteHost || '127.0.0.1'
    const remotePort = entry.rule.remotePort

    await new Promise<void>((resolve, reject) => {
      try {
        client.forwardIn(remoteBind, remotePort, (err, boundPort) => {
          if (err) {
            reject(
              Object.assign(new Error(err.message || 'Remote forward bind failed'), {
                code: 'PF_REMOTE_BIND_FAILED'
              })
            )
            return
          }
          entry.effectiveRemotePort = boundPort || remotePort
          if (entry.rule.remotePort === 0 && boundPort) {
            entry.rule = { ...entry.rule, remotePort: boundPort }
          }
          entry.state = 'listening'
          entry.error = undefined
          resolve()
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  private hookTcpConnection(client: Client): void {
    if (this.tcpConnectionHooked) return
    client.on('tcp connection', this.onTcpConnection)
    this.tcpConnectionHooked = true
  }

  private unhookTcpConnection(): void {
    if (!this.tcpConnectionHooked) return
    const client = this.getClient()
    try {
      client?.removeListener('tcp connection', this.onTcpConnection)
    } catch {
      /* ignore */
    }
    this.tcpConnectionHooked = false
  }

  private handleReverseConnection(
    details: { destIP: string; destPort: number; srcIP: string; srcPort: number },
    accept: () => ClientChannel,
    reject: () => void
  ): void {
    if (!this.tunnelsEnabled) {
      reject()
      return
    }

    let entry: ForwardEntry | undefined
    for (const e of this.forwards.values()) {
      if (e.rule.direction !== 'remote' || !e.rule.enabled) continue
      const port = e.effectiveRemotePort || e.rule.remotePort
      if (port === details.destPort) {
        entry = e
        break
      }
    }
    if (!entry) {
      reject()
      return
    }

    const localHost = entry.rule.bindHost || '127.0.0.1'
    const localPort = entry.rule.localPort
    let channel: ClientChannel
    try {
      channel = accept()
    } catch {
      return
    }

    const localSocket = createConnection({ host: localHost, port: localPort }, () => {
      entry!.consecutiveFailures = 0
      entry!.lastConnectError = undefined
      if (entry!.state !== 'listening') {
        entry!.state = 'listening'
        entry!.error = undefined
      }
      this.emitChange()
    })

    entry.activeSockets.add(localSocket)
    this.emitChange()

    localSocket.on('error', (err) => {
      entry!.consecutiveFailures++
      entry!.lastConnectError = err.message
      if (entry!.consecutiveFailures >= WARN_AFTER_FAILURES) {
        entry!.error = `Local connect failed: ${err.message}`
      }
      try {
        channel.destroy()
      } catch {
        /* ignore */
      }
      this.emitChange()
    })

    this.pipeWithStats(entry, localSocket, channel)

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      entry!.activeSockets.delete(localSocket)
      try {
        localSocket.destroy()
      } catch {
        /* ignore */
      }
      try {
        channel.destroy()
      } catch {
        /* ignore */
      }
      this.emitChange()
    }
    localSocket.on('close', cleanup)
    channel.on('close', cleanup)
    channel.on('error', cleanup)
  }

  private async handleSocksConnection(entry: ForwardEntry, localSocket: Socket): Promise<void> {
    if (!entry.rule.enabled) {
      localSocket.destroy()
      return
    }
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

    const hs = await socks5Handshake(localSocket)
    if (!hs.ok) {
      entry.consecutiveFailures++
      entry.lastConnectError = hs.message
      if (entry.consecutiveFailures >= WARN_AFTER_FAILURES) {
        entry.error = hs.message
      }
      try {
        localSocket.destroy()
      } catch {
        /* ignore */
      }
      this.emitChange()
      return
    }

    const srcIP = localSocket.remoteAddress || '127.0.0.1'
    const srcPort = localSocket.remotePort || 0

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      entry.consecutiveFailures++
      entry.lastConnectError = 'Tunnel timed out'
      if (entry.consecutiveFailures >= WARN_AFTER_FAILURES) {
        entry.error = 'SOCKS tunnel timed out'
      }
      socks5ReplyFailure(localSocket)
      localSocket.destroy()
      this.emitChange()
    }, FORWARD_OUT_TIMEOUT_MS)

    client.forwardOut(srcIP, srcPort, hs.host, hs.port, (err, sshStream) => {
      clearTimeout(timer)
      if (settled) {
        try {
          sshStream?.destroy()
        } catch {
          /* ignore */
        }
        return
      }
      settled = true

      if (err || !sshStream) {
        log.warn('pfforward', 'SOCKS forwardOut failed', {
          host: hs.host,
          port: hs.port,
          err
        })
        entry.consecutiveFailures++
        entry.lastConnectError = err?.message || 'forwardOut failed'
        if (entry.consecutiveFailures >= WARN_AFTER_FAILURES) {
          entry.error = entry.lastConnectError
        }
        socks5ReplyFailure(localSocket, err ? socks5MapError(err) : 0x01)
        localSocket.destroy()
        this.emitChange()
        return
      }

      socks5ReplySuccess(localSocket)

      entry.consecutiveFailures = 0
      entry.lastConnectError = undefined
      if (entry.error && entry.state === 'listening') {
        entry.error = undefined
      }
      if (entry.state !== 'listening') {
        entry.state = 'listening'
        entry.error = undefined
      }

      entry.activeSockets.add(localSocket)
      this.emitChange()

      this.pipeWithStats(entry, localSocket, sshStream)

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
    })
  }

  private handleLocalConnection(entry: ForwardEntry, localSocket: Socket): void {
    if (!entry.rule.enabled) {
      localSocket.destroy()
      return
    }
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

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      entry.consecutiveFailures++
      entry.lastConnectError = 'Tunnel timed out'
      if (entry.consecutiveFailures >= WARN_AFTER_FAILURES) {
        entry.error = 'Tunnel timed out connecting to remote port'
      }
      localSocket.destroy()
      this.emitChange()
    }, FORWARD_OUT_TIMEOUT_MS)

    client.forwardOut(
      srcIP,
      srcPort,
      entry.rule.remoteHost,
      entry.rule.remotePort,
      (err, sshStream) => {
        clearTimeout(timer)
        if (settled) {
          try {
            sshStream?.destroy()
          } catch {
            /* ignore */
          }
          return
        }
        settled = true

        if (err || !sshStream) {
          log.warn('pfforward', 'tunnel forwardOut failed', {
            localPort: entry.effectiveLocalPort || entry.rule.localPort,
            remoteHost: entry.rule.remoteHost,
            remotePort: entry.rule.remotePort,
            err
          })
          entry.consecutiveFailures++
          entry.lastConnectError = err?.message || 'forwardOut failed'
          if (entry.consecutiveFailures >= WARN_AFTER_FAILURES) {
            entry.error = entry.lastConnectError
          }
          localSocket.destroy()
          this.emitChange()
          return
        }

        entry.consecutiveFailures = 0
        entry.lastConnectError = undefined
        if (entry.error && entry.state === 'listening') {
          entry.error = undefined
        }
        if (entry.state !== 'listening') {
          entry.state = 'listening'
          entry.error = undefined
        }

        entry.activeSockets.add(localSocket)
        this.emitChange()

        this.pipeWithStats(entry, localSocket, sshStream)

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

  /**
   * Bidirectional pipe with byte accounting.
   * local → remote counts as bytesUp; remote → local as bytesDown.
   */
  private pipeWithStats(
    entry: ForwardEntry,
    local: Socket,
    remote: NodeJS.ReadableStream & NodeJS.WritableStream
  ): void {
    local.on('data', (chunk: Buffer) => {
      entry.bytesUp += chunk.length
      this.scheduleStatsEmit()
    })
    remote.on('data', (chunk: Buffer | string) => {
      const n = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      entry.bytesDown += n
      this.scheduleStatsEmit()
    })
    local.pipe(remote).pipe(local)
  }

  private scheduleStatsEmit(): void {
    if (this.statsEmitTimer) return
    this.statsEmitTimer = setTimeout(() => {
      this.statsEmitTimer = null
      this.emitChange()
    }, STATS_EMIT_MS)
  }

  private async stopEntry(entry: ForwardEntry): Promise<void> {
    for (const sock of entry.activeSockets) {
      sock.destroy()
    }
    entry.activeSockets.clear()

    if (entry.server) {
      await new Promise<void>((resolve) => {
        try {
          entry.server!.close(() => resolve())
        } catch {
          resolve()
        }
        setTimeout(resolve, 500)
      })
      entry.server = null
    }

    if (entry.rule.direction === 'remote' && this.tunnelsEnabled) {
      const client = this.getClient()
      if (client) {
        const remoteBind = entry.rule.remoteHost || '127.0.0.1'
        const port = entry.effectiveRemotePort || entry.rule.remotePort
        try {
          await new Promise<void>((resolve) => {
            try {
              client.unforwardIn(remoteBind, port, () => resolve())
            } catch {
              resolve()
            }
            setTimeout(resolve, 500)
          })
        } catch {
          /* ignore */
        }
      }
    }

    entry.state = entry.rule.enabled ? 'stopped' : 'paused'
  }

  private emitChange(): void {
    this.emit('change')
  }
}
