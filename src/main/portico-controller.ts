import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { PORTICO_REMOTE_DIR } from '@shared/constants.js'
import { detectProvider, formatForProvider } from '@shared/adapters.js'
import type { PorticoApi } from '@shared/ipc.js'
import { ok, err } from '@shared/result.js'
import type {
  PasteImageArgs,
  ConnectResult,
  ConnStatePayload,
  StatusPayload
} from '@shared/ipc.js'
import type {
  ConnectionState,
  PortForwardRule,
  PortForwardStatus,
  ProviderId,
  ProviderSession,
  Result,
  ShelfItem,
  SshTarget,
  UploadedBlob
} from '@shared/types.js'
import { SshSession } from './ssh-session.js'
import { PortForwarder } from './port-forwarder.js'
import { uploadBlob } from './blob-uploader.js'
import { clipboardHasImage, readClipboardImage } from './clipboard.js'
import { getLogger, redactTarget } from './logger.js'

const MAX_RECONNECT_ATTEMPTS = 10
const log = getLogger()

export class PorticoController {
  private session: SshSession | null = null
  private target: SshTarget | null = null
  private provider: ProviderId = 'shell'
  private interactive = true
  private providerLocked = false

  private shelf: ShelfItem[] = []

  private connState: ConnectionState = 'disconnected'
  private lastDims: { cols: number; rows: number } | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private reconnectCancelled = false
  private closeHandled = false
  private portForwarder: PortForwarder | null = null

  outputListeners = new Set<(data: string) => void>()
  statusListeners = new Set<(s: StatusPayload) => void>()
  shelfListeners = new Set<(item: ShelfItem) => void>()
  connStateListeners = new Set<(payload: ConnStatePayload) => void>()
  pfListeners = new Set<(forwards: PortForwardStatus[]) => void>()

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  // ---- lifecycle -----------------------------------------------------------

  async connect(target: SshTarget): Promise<Result<ConnectResult>> {
    try {
      this.assertTarget(target)
      log.info('controller', 'connect attempt', redactTarget(target))
      this.setConnState('connecting')

      const session = new SshSession(target)
      this.attachSessionListeners(session)
      const info = await session.connect()
      this.session = session
      this.target = target
      this.closeHandled = false

      this.portForwarder = new PortForwarder(() => this.session?.getClient() ?? null)
      this.portForwarder.on('change', () => this.pushPortForwards())

      this.interactive = true
      this.provider = 'shell'
      this.providerLocked = false
      this.reconnectAttempt = 0
      this.reconnectCancelled = false

      this.setConnState('connected')
      log.info('controller', 'connected', { ...redactTarget(target), cwd: info.initialCwd })
      this.pushStatus('info', `Connected to ${target.user}@${target.host}.`)
      return ok({ connected: true, initialCwd: info.initialCwd })
    } catch (e) {
      log.error('controller', 'connect failed', { ...redactTarget(target), err: e as Error })
      this.setConnState('disconnected')
      return err('CONNECT_FAILED', (e as Error).message)
    }
  }

  async disconnect(): Promise<Result<true>> {
    this.reconnectCancelled = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      await this.session?.disconnect()
    } finally {
      this.session = null
      this.target = null
      this.portForwarder?.destroyAll()
      this.portForwarder = null
    }
    this.setConnState('disconnected')
    return ok(true)
  }

  isConnected(): Result<boolean> {
    return ok(!!this.session?.isConnected())
  }

  getConnectionState(): Result<{ state: ConnectionState; user?: string; host?: string }> {
    return ok({ state: this.connState, user: this.target?.user, host: this.target?.host })
  }

  async cancelReconnect(): Promise<Result<true>> {
    this.reconnectCancelled = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      await this.session?.disconnect()
    } catch { /* ignore */ }
    this.session = null
    this.target = null
    this.portForwarder?.destroyAll()
    this.portForwarder = null
    this.setConnState('disconnected')
    this.pushStatus('info', 'Reconnection cancelled.')
    return ok(true)
  }

  // ---- reconnection --------------------------------------------------------

  private handleSessionClose(info: { intentional: boolean }): void {
    if (this.closeHandled) return
    this.closeHandled = true

    if (info.intentional) {
      log.info('controller', 'session closed intentionally')
      this.setConnState('disconnected')
      this.pushStatus('warn', 'SSH session closed.')
      this.portForwarder?.destroyAll()
      this.portForwarder = null
      return
    }

    log.warn('controller', 'session closed unexpectedly; will reconnect', this.target ? redactTarget(this.target) : {})
    this.portForwarder?.dropActiveTunnels()

    for (const cb of this.outputListeners) {
      cb('\r\n\x1b[33m[Connection lost. Reconnecting...]\x1b[0m\r\n')
    }

    this.startReconnect()
  }

  private startReconnect(): void {
    if (!this.target) {
      this.setConnState('disconnected')
      return
    }
    this.reconnectCancelled = false
    this.reconnectAttempt = 0
    void this.attemptReconnect()
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectCancelled || !this.target) {
      this.setConnState('disconnected')
      return
    }

    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      log.error('controller', `reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts`)
      this.setConnState('disconnected')
      this.pushStatus('error', `Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts.`)
      this.portForwarder?.destroyAll()
      this.portForwarder = null
      this.target = null
      return
    }

    this.reconnectAttempt++
    this.setConnState('reconnecting', { attempt: this.reconnectAttempt })

    try {
      try { await this.session?.disconnect() } catch { /* ignore */ }
      this.session = null

      const session = new SshSession(this.target)
      this.attachSessionListeners(session)
      await session.connect()
      this.session = session
      this.closeHandled = false

      // The new PTY starts at the default 80x24; replay the renderer's last
      // known geometry so full-screen programs render correctly.
      if (this.lastDims) session.resize(this.lastDims)

      for (const cb of this.outputListeners) {
        cb('\r\n\x1b[32m[Reconnected]\x1b[0m\r\n')
      }

      this.portForwarder?.resumeAll()

      this.reconnectAttempt = 0
      this.setConnState('connected')
      log.info('controller', 'reconnected', redactTarget(this.target))
      this.pushStatus('info', `Reconnected to ${this.target.user}@${this.target.host}.`, 5000)
    } catch (e) {
      const delayMs = Math.min(30_000, 1000 * Math.pow(2, this.reconnectAttempt - 1))
      const delaySec = Math.round(delayMs / 1000)
      log.warn('controller', `reconnect attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS} failed`, {
        ...redactTarget(this.target!),
        nextRetryInSec: delaySec,
        err: e as Error
      })

      this.pushStatus(
        'warn',
        `Reconnect attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS} failed. Retrying in ${delaySec}s...`
      )

      this.setConnState('reconnecting', {
        attempt: this.reconnectAttempt,
        nextRetryIn: delaySec
      })

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        void this.attemptReconnect()
      }, delayMs)
    }
  }

  private attachSessionListeners(session: SshSession): void {
    session.on('data', (chunk: string) => this.handleOutput(chunk))
    session.on('close', (info: { intentional: boolean }) => this.handleSessionClose(info))
    session.on('error', (e: Error) => this.pushStatus('error', e.message))
  }

  private setConnState(state: ConnectionState, extra?: Partial<ConnStatePayload>): void {
    this.connState = state
    const payload: ConnStatePayload = { state, ...extra }
    for (const cb of this.connStateListeners) cb(payload)
  }

  // ---- terminal ------------------------------------------------------------

  sendInput(data: string): void {
    try {
      this.session?.write(data)
    } catch (e) {
      this.pushStatus('error', (e as Error).message)
    }
  }

  resize(cols: number, rows: number): void {
    this.lastDims = { cols, rows }
    this.session?.resize({ cols, rows })
  }

  private handleOutput(chunk: string): void {
    if (!this.providerLocked) {
      const detected = detectProvider({
        recentOutput: this.session?.recentOutput() ?? [],
        currentLine: ''
      })
      if (detected !== 'shell') {
        this.provider = detected
        this.providerLocked = true
      }
    }
    for (const cb of this.outputListeners) cb(chunk)
  }

  // ---- image bridge --------------------------------------------------------

  clipboardHasImage(): Result<boolean> {
    return ok(clipboardHasImage())
  }

  async uploadClipboard(): Promise<Result<UploadedBlob>> {
    return this.doUpload({ prompt: undefined, forced: undefined, inject: false })
  }

  async pasteImage(args: PasteImageArgs): Promise<Result<UploadedBlob>> {
    return this.doUpload({ prompt: args.prompt, forced: args.provider, inject: true })
  }

  private async doUpload(opts: {
    prompt?: string
    forced?: ProviderId
    inject: boolean
  }): Promise<Result<UploadedBlob>> {
    try {
      if (!this.session?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')
      const img = await readClipboardImage()
      if (!img) return err('NO_IMAGE', 'No image on the clipboard.')

      const placeholder = this.addShelfPlaceholder()

      const { blob } = await uploadBlob(this.session, img)
      log.info('controller', 'image uploaded', { hash: blob.hash, bytes: blob.bytes, ext: blob.ext })

      const provider = opts.forced ?? this.provider
      const sessionCtx: ProviderSession = {
        provider,
        interactive: this.interactive,
        nativePasteAvailable: false
      }
      const fragment = formatForProvider(provider, blob.remotePath, opts.prompt, sessionCtx)

      if (opts.inject) {
        this.inject(fragment)
      }

      this.commitShelfPlaceholder(placeholder, blob, opts.prompt)
      return ok(blob)
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'UPLOAD_FAILED'
      log.error('controller', 'image upload failed', { code, err: e as Error })
      return err(code, (e as Error).message)
    }
  }

  async pasteRemotePath(remotePath: string, prompt?: string): Promise<Result<true>> {
    try {
      if (!this.session?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')
      const sessionCtx: ProviderSession = {
        provider: this.provider,
        interactive: this.interactive,
        nativePasteAvailable: false
      }
      const fragment = formatForProvider(this.provider, remotePath, prompt, sessionCtx)
      this.inject(fragment)
      return ok(true)
    } catch (e) {
      return err('PASTE_FAILED', (e as Error).message)
    }
  }

  private inject(fragment: string): void {
    const endsNewline = /\n$/.test(fragment)
    const text = endsNewline ? fragment : `${fragment}\n`
    this.session?.write(text)
  }

  // ---- session / provider --------------------------------------------------

  getSession(): Result<ProviderSession> {
    return ok({
      provider: this.provider,
      interactive: this.interactive,
      nativePasteAvailable: false
    })
  }

  setProvider(provider: ProviderId): Result<ProviderSession> {
    this.provider = provider
    this.providerLocked = true
    return ok({
      provider,
      interactive: this.interactive,
      nativePasteAvailable: false
    })
  }

  detectProvider(): Result<ProviderId> {
    const detected = detectProvider({
      recentOutput: this.session?.recentOutput() ?? [],
      currentLine: ''
    })
    return ok(detected)
  }

  // ---- port forwarding -----------------------------------------------------

  async addPortForward(rule: {
    localPort: number
    remoteHost: string
    remotePort: number
  }): Promise<Result<PortForwardRule>> {
    if (!this.portForwarder) return err('NOT_CONNECTED', 'Connect to a host first.')
    try {
      const added = await this.portForwarder.add(rule)
      return ok(added)
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'PF_ADD_FAILED'
      return err(code, (e as Error).message)
    }
  }

  removePortForward(id: string): Result<true> {
    if (!this.portForwarder) return err('NOT_CONNECTED', 'No active session.')
    this.portForwarder.remove(id)
    return ok(true)
  }

  listPortForwards(): Result<PortForwardStatus[]> {
    return ok(this.portForwarder?.list() ?? [])
  }

  private pushPortForwards(): void {
    const list = this.portForwarder?.list() ?? []
    for (const cb of this.pfListeners) cb(list)
  }

  // ---- shelf ---------------------------------------------------------------

  shelfList(): Result<ShelfItem[]> {
    return ok([...this.shelf])
  }

  shelfClear(): Result<true> {
    this.shelf = []
    return ok(true)
  }

  private addShelfPlaceholder(): string {
    const id = randomUUID()
    const item: ShelfItem = {
      id,
      remotePath: '',
      hash: '',
      ext: 'png',
      bytes: 0,
      status: 'uploading',
      uploadedAt: new Date().toISOString()
    }
    this.shelf.unshift(item)
    this.emitShelf(item)
    return id
  }

  private commitShelfPlaceholder(id: string, blob: UploadedBlob, prompt?: string): void {
    const idx = this.shelf.findIndex((i) => i.id === id)
    if (idx === -1) return
    const updated: ShelfItem = {
      ...this.shelf[idx],
      remotePath: blob.remotePath,
      hash: blob.hash,
      ext: blob.ext,
      bytes: blob.bytes,
      prompt,
      status: 'ready',
      previewUrl: blob.previewUrl
    }
    this.shelf[idx] = updated
    this.emitShelf(updated)
  }

  private emitShelf(item: ShelfItem): void {
    for (const cb of this.shelfListeners) cb(item)
  }

  // ---- remote cache --------------------------------------------------------

  async clearRemoteCache(): Promise<Result<{ deleted: number }>> {
    try {
      if (!this.session?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')
      const deleted = await this.session.deleteFilesIn(PORTICO_REMOTE_DIR, () => true)
      log.info('controller', 'cleared remote cache', { deleted, dir: PORTICO_REMOTE_DIR })
      this.pushStatus('info', `Cleared ${deleted} blob(s) from ${PORTICO_REMOTE_DIR}.`)
      return ok({ deleted })
    } catch (e) {
      log.error('controller', 'clear remote cache failed', { err: e as Error })
      return err('CACHE_CLEAR_FAILED', (e as Error).message)
    }
  }

  // ---- status ---------------------------------------------------------------

  pushStatus(level: StatusPayload['level'], message: string, ttlMs?: number): void {
    const payload: StatusPayload = { level, message, ttlMs }
    for (const cb of this.statusListeners) cb(payload)
  }

  // ---- helpers --------------------------------------------------------------

  private assertTarget(t: SshTarget): void {
    if (!t.host) throw Object.assign(new Error('Host is required.'), { code: 'INVALID_TARGET' })
    if (!t.user) throw Object.assign(new Error('User is required.'), { code: 'INVALID_TARGET' })
    if (!t.password && !t.privateKeyPath) {
      throw Object.assign(new Error('Provide a password or a private key path.'), {
        code: 'INVALID_TARGET'
      })
    }
  }
}

export type { PorticoApi }
