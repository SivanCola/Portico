import { BrowserWindow, clipboard } from 'electron'
import { randomUUID } from 'node:crypto'
import { PORTICO_REMOTE_DIR, XTERM_MODE_SOFT_RESET } from '@shared/constants.js'
import { detectProvider, formatForProvider } from '@shared/adapters.js'
import type { PorticoApi } from '@shared/ipc.js'
import { ok, err } from '@shared/result.js'
import { transition } from '@shared/session-fsm.js'
import type {
  PasteImageArgs,
  UploadLocalImageArgs,
  ConnectResult,
  ConnStatePayload,
  StatusPayload,
  TmuxEnterArgs
} from '@shared/ipc.js'
import type {
  ConnectionState,
  NormalizedImage,
  PortForwardRule,
  PortForwardStatus,
  ProviderId,
  ProviderSession,
  Result,
  SessionId,
  SessionKind,
  SessionSummary,
  ShelfItem,
  SshTarget,
  UploadedBlob
} from '@shared/types.js'
import { SshSession } from './ssh-session.js'
import { LocalSession } from './local-session.js'
import { PortForwarder } from './port-forwarder.js'
import { saveLocalBlob, uploadBlob } from './blob-uploader.js'
import { clipboardHasImage, readClipboardImage, readImageFile } from './clipboard.js'
import { getLogger, redactTarget } from './logger.js'
import {
  DEFAULT_TMUX_PREFS,
  buildAttachCommand,
  buildEnterShellCommand,
  buildEnableClipboardCommand,
  buildHasTmuxCommand,
  buildInTmuxCommand,
  buildListSessionsCommand,
  buildNewSessionCommand,
  normalizeTmuxPrefs,
  parseListSessions,
  type TmuxPrefs,
  type TmuxSessionInfo
} from './tmux.js'
import { Osc52Filter } from './osc52.js'
import { findAiChildProcess } from './provider-process.js'

const MAX_RECONNECT_ATTEMPTS = 10
const MAX_SESSIONS = 8
const log = getLogger()

/** Runtime feature flags — L2 capabilities that must never tear down L0 PTY. */
export interface FeatureFlags {
  imageBridge: boolean
  portForwards: boolean
  providerDetect: boolean
  autoUpdate: boolean
}

const DEFAULT_FLAGS: FeatureFlags = {
  imageBridge: true,
  portForwards: true,
  providerDetect: true,
  autoUpdate: true
}

function defaultTitle(target: SshTarget | null): string {
  if (!target) return 'New session'
  if (target.alias) return target.alias
  return `${target.user}@${target.host}`
}

/** Host callbacks so SessionHandle can push events without knowing Electron. */
interface HandleHost {
  getFlags(): FeatureFlags
  getTmuxPrefs(): TmuxPrefs
  onOutput(sessionId: SessionId, data: string): void
  onStatus(level: StatusPayload['level'], message: string, ttlMs?: number, sessionId?: SessionId): void
  onConnState(payload: ConnStatePayload): void
  onShelf(sessionId: SessionId, item: ShelfItem): void
  onPortForwards(sessionId: SessionId, forwards: PortForwardStatus[]): void
  onProviderSession(sessionId: SessionId, session: ProviderSession): void
  onSummaryChanged(): void
}

/**
 * One Portico tab: local PTY or SSH, reconnect (SSH only), shelf, PF, OSC52.
 */
class SessionHandle {
  readonly id: SessionId
  readonly createdAt: string
  title: string
  private kind: SessionKind | null = null

  private ssh: SshSession | null = null
  private local: LocalSession | null = null
  private target: SshTarget | null = null
  private localShell = ''
  private provider: ProviderId = 'shell'
  private interactive = true
  /** True only after the user manually picks Claude/Codex/Shell in the UI. */
  private providerManual = false
  private shelf: ShelfItem[] = []
  private connState: ConnectionState = 'disconnected'
  private lastDims: { cols: number; rows: number } | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private reconnectCancelled = false
  private closeHandled = false
  private portForwarder: PortForwarder | null = null
  private pendingReconnectSession: SshSession | null = null
  private lifecycleEpoch = 0
  private connectInFlight = false
  private reconnectInFlight = false
  private osc52 = new Osc52Filter()
  private lastPhase: ConnStatePayload['phase'] | undefined
  /** Throttle auto provider detection on the hot PTY path. */
  private lastProviderDetectAt = 0
  private lastProcessProbeAt = 0
  private cachedProcessHint: 'claude' | 'codex' | 'none' | undefined

  constructor(
    id: SessionId,
    private readonly host: HandleHost,
    title?: string
  ) {
    this.id = id
    this.createdAt = new Date().toISOString()
    this.title = title ?? 'New session'
  }

  summary(): SessionSummary {
    return {
      id: this.id,
      title: this.title,
      kind: this.kind ?? undefined,
      target: this.target
        ? {
            user: this.target.user,
            host: this.target.host,
            port: this.target.port,
            alias: this.target.alias
          }
        : undefined,
      shell: this.kind === 'local' ? this.localShell || undefined : undefined,
      state: this.connState,
      phase: this.lastPhase,
      provider: this.provider,
      unread: false,
      createdAt: this.createdAt
    }
  }

  getConnectionState(): Result<{
    state: ConnectionState
    user?: string
    host?: string
    alias?: string
    sessionId: SessionId
    kind?: SessionKind
  }> {
    return ok({
      sessionId: this.id,
      state: this.connState,
      kind: this.kind ?? undefined,
      user: this.target?.user,
      host: this.kind === 'local' ? 'localhost' : this.target?.host,
      alias: this.kind === 'local' ? this.localShell || 'local' : this.target?.alias
    })
  }

  isConnected(): Result<boolean> {
    return ok(!!(this.ssh?.isConnected() || this.local?.isConnected()))
  }

  private async teardownBackends(): Promise<void> {
    try {
      await this.local?.disconnect()
    } catch {
      /* ignore */
    }
    this.local = null
    try {
      await this.ssh?.disconnect()
    } catch {
      /* ignore */
    }
    this.ssh = null
    this.portForwarder?.destroyAll()
    this.portForwarder = null
  }

  async connectLocal(): Promise<Result<ConnectResult>> {
    if (this.connectInFlight) {
      return err('BUSY', 'A connection attempt is already in progress for this session.')
    }
    this.reconnectCancelled = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.connectInFlight = true
    const epoch = ++this.lifecycleEpoch
    this.closeHandled = true
    await this.teardownBackends()
    this.closeHandled = false
    this.target = null

    let session: LocalSession | null = null
    try {
      log.info('controller', 'local connect attempt', { sessionId: this.id })
      this.setConnState('connecting', { phase: 'shell' })
      session = new LocalSession()
      this.attachLocalListeners(session)
      const info = await session.connect({
        cols: this.lastDims?.cols,
        rows: this.lastDims?.rows
      })
      if (epoch !== this.lifecycleEpoch) {
        this.closeHandled = true
        try {
          await session.disconnect()
        } catch {
          /* ignore */
        }
        return err('CANCELLED', 'Connection superseded by a newer action.')
      }
      this.local = session
      this.kind = 'local'
      this.localShell = session.shellName()
      this.title = this.localShell || 'Local'
      this.closeHandled = false
      this.osc52.reset()
      this.interactive = true
      this.provider = 'shell'
      this.providerManual = false
      this.cachedProcessHint = undefined
      this.setConnState('connected', { phase: 'ready' })
      this.pushProviderSession()
      this.host.onSummaryChanged()
      log.info('controller', 'local connected', {
        sessionId: this.id,
        shell: info.shell,
        cwd: info.cwd
      })
      return ok({ connected: true, sessionId: this.id, initialCwd: info.cwd })
    } catch (e) {
      log.error('controller', 'local connect failed', { sessionId: this.id, err: e as Error })
      if (session) {
        this.closeHandled = true
        try {
          await session.disconnect()
        } catch {
          /* ignore */
        }
      }
      if (epoch === this.lifecycleEpoch) {
        this.local = null
        this.kind = null
        this.setConnState('disconnected')
      }
      const code = (e as { code?: string }).code ?? 'CONNECT_FAILED'
      return err(code, (e as Error).message)
    } finally {
      this.connectInFlight = false
    }
  }

  async connect(target: SshTarget): Promise<Result<ConnectResult>> {
    if (this.connectInFlight) {
      return err('BUSY', 'A connection attempt is already in progress for this session.')
    }
    this.reconnectCancelled = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.connectInFlight = true
    const epoch = ++this.lifecycleEpoch

    this.closeHandled = true
    await this.teardownBackends()
    this.closeHandled = false
    this.localShell = ''

    let session: SshSession | null = null
    try {
      assertTarget(target)
      log.info('controller', 'connect attempt', { sessionId: this.id, ...redactTarget(target) })
      this.setConnState('connecting', { phase: 'resolving' })

      session = new SshSession(target)
      this.attachSessionListeners(session)
      const info = await session.connect({
        onPhase: (phase) => {
          if (epoch === this.lifecycleEpoch) {
            this.setConnState('connecting', { phase })
          }
        }
      })

      if (epoch !== this.lifecycleEpoch) {
        this.closeHandled = true
        try {
          await session.disconnect()
        } catch {
          /* ignore */
        }
        return err('CANCELLED', 'Connection superseded by a newer action.')
      }

      this.ssh = session
      this.kind = 'ssh'
      this.target = target
      this.title = defaultTitle(target)
      this.closeHandled = false
      this.osc52.reset()

      if (this.lastDims) session.resize(this.lastDims)

      if (this.host.getFlags().portForwards) {
        this.portForwarder = new PortForwarder(() => this.ssh?.getClient() ?? null)
        this.portForwarder.on('change', () => this.pushPortForwards())
      }

      this.interactive = true
      this.provider = 'shell'
      this.providerManual = false
      this.cachedProcessHint = undefined
      this.reconnectAttempt = 0
      this.reconnectCancelled = false

      this.setConnState('connected', { phase: 'ready' })
      this.pushProviderSession()
      this.host.onSummaryChanged()
      log.info('controller', 'connected', { sessionId: this.id, ...redactTarget(target), cwd: info.initialCwd })
      // No success toast — top bar / session rail already show live connection.
      void this.maybeEnterTmux('connect')
      return ok({ connected: true, sessionId: this.id, initialCwd: info.initialCwd })
    } catch (e) {
      log.error('controller', 'connect failed', { sessionId: this.id, ...redactTarget(target), err: e as Error })
      if (session) {
        this.closeHandled = true
        try {
          await session.disconnect()
        } catch {
          /* ignore */
        }
      }
      if (epoch === this.lifecycleEpoch) {
        this.ssh = null
        this.kind = null
        this.setConnState('disconnected')
      }
      const code = (e as { code?: string }).code ?? 'CONNECT_FAILED'
      return err(code, (e as Error).message)
    } finally {
      this.connectInFlight = false
    }
  }

  async disconnect(): Promise<Result<true>> {
    this.lifecycleEpoch++
    this.reconnectCancelled = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.closeHandled = true
    const pending = this.pendingReconnectSession
    this.pendingReconnectSession = null
    try {
      await pending?.disconnect()
    } catch {
      /* ignore */
    }
    await this.teardownBackends()
    this.target = null
    this.kind = null
    this.localShell = ''
    this.setConnState('disconnected')
    this.host.onSummaryChanged()
    return ok(true)
  }

  async cancelReconnect(): Promise<Result<true>> {
    this.lifecycleEpoch++
    this.reconnectCancelled = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.closeHandled = true
    const pending = this.pendingReconnectSession
    this.pendingReconnectSession = null
    try {
      await pending?.disconnect()
    } catch {
      /* ignore */
    }
    await this.teardownBackends()
    this.target = null
    this.kind = null
    this.localShell = ''
    this.setConnState('disconnected')
    this.host.onStatus('info', 'Reconnection cancelled.', undefined, this.id)
    this.host.onSummaryChanged()
    return ok(true)
  }

  sendInput(data: string): void {
    try {
      if (this.local?.isConnected()) this.local.write(data)
      else this.ssh?.write(data)
    } catch (e) {
      this.host.onStatus('error', (e as Error).message, undefined, this.id)
    }
  }

  resize(cols: number, rows: number): void {
    this.lastDims = { cols, rows }
    if (this.local?.isConnected()) this.local.resize({ cols, rows })
    else this.ssh?.resize({ cols, rows })
  }

  private handleSessionClose(info: { intentional: boolean }): void {
    if (this.closeHandled) return
    this.closeHandled = true

    if (info.intentional) {
      log.info('controller', 'session closed intentionally', { sessionId: this.id })
      this.ssh = null
      this.local = null
      this.setConnState('disconnected')
      this.portForwarder?.destroyAll()
      this.portForwarder = null
      this.host.onSummaryChanged()
      return
    }

    // Local shell exit: no auto-reconnect (user can re-open Local).
    if (this.kind === 'local') {
      log.info('controller', 'local shell exited', { sessionId: this.id })
      this.local = null
      this.setConnState('disconnected')
      this.host.onSummaryChanged()
      return
    }

    log.warn('controller', 'session closed unexpectedly; will reconnect', {
      sessionId: this.id,
      ...(this.target ? redactTarget(this.target) : {})
    })
    this.portForwarder?.dropActiveTunnels()
    // Drop mouse/alt-screen modes immediately so xterm stops emitting SGR
    // mouse reports into a dead session (would show as garbage after reconnect).
    this.host.onOutput(
      this.id,
      `\r\n${XTERM_MODE_SOFT_RESET}\x1b[33m[Connection lost. Reconnecting...]\x1b[0m\r\n`
    )
    this.startReconnect()
  }

  private startReconnect(): void {
    if (!this.target) {
      this.setConnState('disconnected')
      return
    }
    if (this.reconnectInFlight || this.connectInFlight) {
      log.warn('controller', 'reconnect skipped: connect already in flight', { sessionId: this.id })
      return
    }
    this.reconnectCancelled = false
    this.reconnectAttempt = 0
    void this.attemptReconnect()
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectInFlight) return
    if (this.reconnectCancelled || !this.target) {
      this.setConnState('disconnected')
      return
    }

    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      log.error('controller', `reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts`, {
        sessionId: this.id
      })
      this.setConnState('disconnected')
      this.host.onStatus(
        'error',
        `Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts.`,
        undefined,
        this.id
      )
      this.portForwarder?.destroyAll()
      this.portForwarder = null
      this.target = null
      this.host.onSummaryChanged()
      return
    }

    this.reconnectInFlight = true
    const epoch = this.lifecycleEpoch
    this.reconnectAttempt++
    this.setConnState('reconnecting', { attempt: this.reconnectAttempt })

    try {
      try {
        await this.ssh?.disconnect()
      } catch {
        /* ignore */
      }
      this.ssh = null

      if (this.reconnectCancelled || !this.target || epoch !== this.lifecycleEpoch) {
        this.setConnState('disconnected')
        return
      }

      const session = new SshSession(this.target)
      this.pendingReconnectSession = session
      this.attachSessionListeners(session)
      try {
        await session.connect()
      } finally {
        if (this.pendingReconnectSession === session) {
          this.pendingReconnectSession = null
        }
      }

      if (this.reconnectCancelled || !this.target || epoch !== this.lifecycleEpoch) {
        try {
          await session.disconnect()
        } catch {
          /* ignore */
        }
        this.setConnState('disconnected')
        return
      }

      this.ssh = session
      this.closeHandled = false
      this.osc52.reset()

      if (this.lastDims) session.resize(this.lastDims)

      // Soft-reset client modes again (new PTY is clean; xterm may still have
      // mouse tracking from the previous remote app) then banner.
      this.host.onOutput(
        this.id,
        `\r\n${XTERM_MODE_SOFT_RESET}\x1b[32m[Reconnected]\x1b[0m\r\n`
      )

      if (this.host.getFlags().portForwards) {
        this.portForwarder?.resumeAll()
      }

      this.reconnectAttempt = 0
      this.setConnState('connected')
      log.info('controller', 'reconnected', { sessionId: this.id, ...redactTarget(this.target) })
      // Terminal already prints [Reconnected]; skip floating success toast.
      void this.maybeEnterTmux('reconnect')
    } catch (e) {
      if (this.reconnectCancelled || !this.target || epoch !== this.lifecycleEpoch) {
        this.setConnState('disconnected')
        return
      }

      const delayMs = Math.min(30_000, 1000 * Math.pow(2, this.reconnectAttempt - 1))
      const delaySec = Math.round(delayMs / 1000)
      log.warn('controller', `reconnect attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS} failed`, {
        sessionId: this.id,
        ...redactTarget(this.target),
        nextRetryInSec: delaySec,
        err: e as Error
      })

      this.host.onStatus(
        'warn',
        `Reconnect attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS} failed. Retrying in ${delaySec}s...`,
        undefined,
        this.id
      )

      this.setConnState('reconnecting', {
        attempt: this.reconnectAttempt,
        nextRetryIn: delaySec
      })

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        void this.attemptReconnect()
      }, delayMs)
    } finally {
      this.reconnectInFlight = false
    }
  }

  private attachSessionListeners(session: SshSession): void {
    session.on('data', (chunk: string) => this.handleOutput(chunk))
    session.on('close', (info: { intentional: boolean }) => this.handleSessionClose(info))
    session.on('error', (e: Error) => {
      log.warn('controller', 'session error (non-fatal for listeners)', { sessionId: this.id, err: e })
      this.host.onStatus('error', e.message, 6000, this.id)
    })
  }

  private attachLocalListeners(session: LocalSession): void {
    session.on('data', (chunk: string) => this.handleOutput(chunk))
    session.on('close', (info: { intentional: boolean }) => this.handleSessionClose(info))
  }

  private recentOutputLines(): string[] {
    if (this.local?.isConnected()) return this.local.recentOutput()
    return this.ssh?.recentOutput() ?? []
  }

  private isBackendLive(): boolean {
    return !!(this.ssh?.isConnected() || this.local?.isConnected())
  }

  private setConnState(state: ConnectionState, extra?: Partial<ConnStatePayload>): void {
    const from = this.connState
    if (from === 'disconnected' && state === 'disconnected') {
      return
    }
    const result = transition(from, state)
    if (!result.ok) {
      const phaseUpdate = from === 'connecting' && state === 'connecting'
      if (!phaseUpdate) {
        log.warn('controller', result.reason, { sessionId: this.id })
        if (state !== 'disconnected') return
      }
    }
    this.connState = state
    this.lastPhase = extra?.phase
    const payload: ConnStatePayload = {
      sessionId: this.id,
      state,
      user: this.target?.user,
      host: this.target?.host,
      alias: this.target?.alias,
      ...extra
    }
    this.host.onConnState(payload)
  }

  private handleOutput(chunk: string): void {
    let text = chunk
    try {
      const { passthrough, clipboardWrites } = this.osc52.feed(chunk)
      text = passthrough
      if (this.host.getTmuxPrefs().syncRemoteClipboard) {
        for (const payload of clipboardWrites) {
          try {
            clipboard.writeText(payload)
            log.info('clipboard', 'OSC 52 → local clipboard', {
              sessionId: this.id,
              chars: payload.length
            })
          } catch (e) {
            log.warn('clipboard', 'OSC 52 write failed', { err: e as Error })
          }
        }
      }
    } catch (e) {
      log.warn('clipboard', 'OSC 52 filter error (passthrough raw)', { err: e as Error })
      text = chunk
    }

    if (this.host.getFlags().providerDetect && !this.providerManual) {
      this.maybeAutoDetectProvider()
    }
    if (!text) return
    this.host.onOutput(this.id, text)
  }

  /**
   * Continuous provider detection (throttled).
   * Manual UI selection sets providerManual and skips this path.
   * Leaving Claude/Codex (process gone + shell prompt) returns to shell.
   */
  private maybeAutoDetectProvider(): void {
    const now = Date.now()
    if (now - this.lastProviderDetectAt < 400) return
    this.lastProviderDetectAt = now
    try {
      const processHint = this.probeProcessHint(now)
      const detected = detectProvider({
        recentOutput: this.recentOutputLines(),
        currentLine: '',
        processHint
      })
      if (detected === this.provider) return
      const prev = this.provider
      this.provider = detected
      this.pushProviderSession()
      this.host.onSummaryChanged()
      if (detected === 'shell' && (prev === 'claude' || prev === 'codex')) {
        this.host.onStatus('info', 'Provider: shell', 2000, this.id)
      } else if (detected !== 'shell') {
        this.host.onStatus('info', `Detected ${detected}.`, 2500, this.id)
      }
    } catch (e) {
      log.warn('controller', 'provider detect failed (ignored)', { err: e as Error })
    }
  }

  /** Local PTY: walk process tree for claude/codex (cached ~800ms). */
  private probeProcessHint(now: number): 'claude' | 'codex' | 'none' | undefined {
    if (!this.local?.isConnected()) return undefined
    if (now - this.lastProcessProbeAt < 800 && this.cachedProcessHint !== undefined) {
      return this.cachedProcessHint
    }
    this.lastProcessProbeAt = now
    const pid = this.local.pid()
    if (!pid) {
      this.cachedProcessHint = 'none'
      return 'none'
    }
    try {
      const hit = findAiChildProcess(pid)
      this.cachedProcessHint = hit ?? 'none'
    } catch {
      this.cachedProcessHint = undefined
    }
    return this.cachedProcessHint
  }

  private async maybeEnterTmux(reason: 'connect' | 'reconnect'): Promise<void> {
    try {
      const r = await this.enterTmux()
      if (!r.ok) {
        if (
          r.error.code !== 'TMUX_OFF' &&
          r.error.code !== 'TMUX_NESTED' &&
          r.error.code !== 'TMUX_MISSING'
        ) {
          this.host.onStatus('warn', r.error.message, 5000, this.id)
        } else if (r.error.code === 'TMUX_MISSING' && this.host.getTmuxPrefs().mode !== 'off') {
          this.host.onStatus(
            'info',
            'tmux not found on remote — staying in plain shell. Install tmux or set mode to Off.',
            6000,
            this.id
          )
        }
        await this.maybeConfigureRemoteClipboard()
        return
      }
      log.info('controller', `tmux enter (${reason})`, {
        sessionId: this.id,
        action: r.value.action,
        session: r.value.session
      })
      await this.maybeConfigureRemoteClipboard()
    } catch (e) {
      log.warn('controller', 'tmux enter failed (ignored)', { err: e as Error })
      await this.maybeConfigureRemoteClipboard()
    }
  }

  private async maybeConfigureRemoteClipboard(): Promise<void> {
    if (!this.host.getTmuxPrefs().syncRemoteClipboard) return
    if (!this.ssh?.isConnected()) return
    try {
      const out = (
        await this.ssh.runAndCapture(buildEnableClipboardCommand(), { timeoutMs: 8_000 })
      ).trim()
      log.info('controller', 'remote tmux clipboard config attempted', {
        sessionId: this.id,
        out: out.slice(0, 40)
      })
    } catch (e) {
      log.warn('controller', 'remote tmux clipboard config failed (ignored)', { err: e as Error })
    }
  }

  async listTmuxSessions(): Promise<Result<TmuxSessionInfo[]>> {
    try {
      if (!this.ssh?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')
      const has = (await this.ssh.runAndCapture(buildHasTmuxCommand(), { timeoutMs: 8_000 })).trim()
      if (has !== 'yes') return err('TMUX_MISSING', 'tmux is not installed on the remote host.')
      const out = await this.ssh.runAndCapture(buildListSessionsCommand(), { timeoutMs: 8_000 })
      return ok(parseListSessions(out))
    } catch (e) {
      return err('TMUX_LIST_FAILED', (e as Error).message)
    }
  }

  async enterTmux(opts?: {
    mode?: TmuxPrefs['mode']
    sessionName?: string
    attachOnly?: string
    createNew?: string
  }): Promise<Result<{ action: string; session: string }>> {
    try {
      if (!this.ssh?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')

      const prefs = normalizeTmuxPrefs({
        mode: opts?.mode ?? this.host.getTmuxPrefs().mode,
        sessionName: opts?.sessionName ?? this.host.getTmuxPrefs().sessionName
      })

      let line: string | null = null
      let action = 'enter'
      let session = prefs.sessionName

      if (opts?.attachOnly) {
        session = opts.attachOnly
        line = buildAttachCommand(opts.attachOnly)
        action = 'attach'
      } else if (opts?.createNew) {
        session = opts.createNew
        line = buildNewSessionCommand(opts.createNew)
        action = 'new'
      } else {
        if (prefs.mode === 'off') return err('TMUX_OFF', 'tmux auto-enter is off.')
        line = buildEnterShellCommand(prefs)
        action = prefs.mode
      }

      if (!line) return err('TMUX_OFF', 'tmux auto-enter is off.')

      const has = (await this.ssh.runAndCapture(buildHasTmuxCommand(), { timeoutMs: 8_000 })).trim()
      if (has !== 'yes') return err('TMUX_MISSING', 'tmux is not installed on the remote host.')

      const nested = (await this.ssh.runAndCapture(buildInTmuxCommand(), { timeoutMs: 5_000 })).trim()
      if (nested === 'yes') {
        return err('TMUX_NESTED', 'Already inside a tmux session — skipped.')
      }

      await new Promise((r) => setTimeout(r, 350))
      if (!this.ssh?.isConnected()) return err('NOT_CONNECTED', 'Session closed before tmux enter.')

      this.ssh.write(`${line}\n`)
      this.host.onStatus(
        'info',
        action === 'new'
          ? `Starting tmux session “${session}”…`
          : action === 'attach'
            ? `Attaching tmux session “${session}”…`
            : `Entering tmux (${prefs.mode}: ${session})…`,
        4000,
        this.id
      )
      return ok({ action, session })
    } catch (e) {
      return err('TMUX_ENTER_FAILED', (e as Error).message)
    }
  }

  private assertImageBridge(): Result<true> {
    if (!this.host.getFlags().imageBridge) {
      return err('FEATURE_DISABLED', 'Image bridge is disabled (Terminal only mode).')
    }
    return ok(true)
  }

  async uploadClipboard(): Promise<Result<UploadedBlob>> {
    const gate = this.assertImageBridge()
    if (!gate.ok) return gate
    return this.doUpload({
      prompt: undefined,
      forced: undefined,
      inject: false,
      load: () => readClipboardImage()
    })
  }

  async pasteImage(args: PasteImageArgs): Promise<Result<UploadedBlob>> {
    const gate = this.assertImageBridge()
    if (!gate.ok) return gate
    return this.doUpload({
      prompt: args.prompt,
      forced: args.provider,
      inject: true,
      load: () => readClipboardImage()
    })
  }

  async uploadLocalImage(args: UploadLocalImageArgs): Promise<Result<UploadedBlob>> {
    const gate = this.assertImageBridge()
    if (!gate.ok) return gate
    return this.doUpload({
      prompt: args.prompt,
      forced: args.provider,
      inject: args.inject !== false,
      sourcePath: args.path,
      load: async () => readImageFile(args.path)
    })
  }

  private async doUpload(opts: {
    prompt?: string
    forced?: ProviderId
    inject: boolean
    sourcePath?: string
    load: () => Promise<NormalizedImage | null>
  }): Promise<Result<UploadedBlob>> {
    let placeholderId: string | null = null
    const ssh = this.ssh
    const local = this.local
    const isLocal = !!local?.isConnected()
    try {
      if (!isLocal && !ssh?.isConnected()) {
        return err('NOT_CONNECTED', 'Open a local shell or SSH session first.')
      }
      const img = await opts.load()
      if (!img) return err('NO_IMAGE', 'No image found.')

      const previewUrl = previewDataUrl(img)
      placeholderId = this.addShelfPlaceholder(previewUrl, opts.sourcePath)

      const { blob } = isLocal ? await saveLocalBlob(img) : await uploadBlob(ssh!, img)
      const withPreview: UploadedBlob = { ...blob, previewUrl }
      log.info('controller', 'image uploaded', {
        sessionId: this.id,
        kind: isLocal ? 'local' : 'ssh',
        hash: blob.hash,
        bytes: blob.bytes,
        ext: blob.ext
      })

      if (!this.isBackendLive()) {
        this.commitShelfPlaceholder(placeholderId, withPreview, opts.prompt)
        return ok(withPreview)
      }

      const provider = opts.forced ?? this.provider
      const sessionCtx: ProviderSession = {
        provider,
        interactive: this.interactive,
        nativePasteAvailable: false
      }
      const fragment = formatForProvider(provider, withPreview.remotePath, opts.prompt, sessionCtx)

      if (opts.inject) {
        try {
          this.inject(fragment, provider)
        } catch (e) {
          log.warn('controller', 'inject after upload failed', { err: e as Error })
          this.host.onStatus(
            'warn',
            `Uploaded, but inject failed: ${(e as Error).message}`,
            5000,
            this.id
          )
        }
      }

      this.commitShelfPlaceholder(placeholderId, withPreview, opts.prompt)
      return ok(withPreview)
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'UPLOAD_FAILED'
      const message = (e as Error).message
      log.error('controller', 'image upload failed', { sessionId: this.id, code, err: e as Error })
      if (placeholderId) this.failShelfPlaceholder(placeholderId, message)
      return err(code, message)
    }
  }

  async pasteRemotePath(remotePath: string, prompt?: string): Promise<Result<true>> {
    try {
      if (!this.isBackendLive()) return err('NOT_CONNECTED', 'Open a session first.')
      const sessionCtx: ProviderSession = {
        provider: this.provider,
        interactive: this.interactive,
        nativePasteAvailable: false
      }
      const fragment = formatForProvider(this.provider, remotePath, prompt, sessionCtx)
      this.inject(fragment, this.provider)
      return ok(true)
    } catch (e) {
      return err('PASTE_FAILED', (e as Error).message)
    }
  }

  private inject(fragment: string, provider: ProviderId = this.provider): void {
    const text =
      provider === 'shell'
        ? /\n$/.test(fragment)
          ? fragment
          : `${fragment}\n`
        : fragment
    if (this.local?.isConnected()) this.local.write(text)
    else this.ssh?.write(text)
  }

  getSession(): Result<ProviderSession> {
    return ok(this.sessionSnapshot())
  }

  setProvider(provider: ProviderId): Result<ProviderSession> {
    this.provider = provider
    this.providerManual = true
    const snap = this.sessionSnapshot()
    this.pushProviderSession(snap)
    this.host.onSummaryChanged()
    return ok(snap)
  }

  detectProvider(): Result<ProviderId> {
    // Palette "re-detect": clear manual lock and re-run heuristics + process probe.
    this.providerManual = false
    this.cachedProcessHint = undefined
    this.lastProcessProbeAt = 0
    const processHint = this.probeProcessHint(Date.now())
    const detected = detectProvider({
      recentOutput: this.recentOutputLines(),
      currentLine: '',
      processHint
    })
    this.provider = detected
    this.pushProviderSession()
    this.host.onSummaryChanged()
    return ok(detected)
  }

  private sessionSnapshot(): ProviderSession {
    return {
      provider: this.provider,
      interactive: this.interactive,
      nativePasteAvailable: false
    }
  }

  private pushProviderSession(snap: ProviderSession = this.sessionSnapshot()): void {
    this.host.onProviderSession(this.id, snap)
  }

  async addPortForward(rule: {
    localPort: number
    remoteHost: string
    remotePort: number
  }): Promise<Result<PortForwardRule>> {
    if (!this.host.getFlags().portForwards) {
      return err('FEATURE_DISABLED', 'Port forwarding is disabled (Terminal only mode).')
    }
    if (this.kind === 'local') {
      return err('NOT_SUPPORTED', 'Port forwarding requires an SSH session.')
    }
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
    this.host.onPortForwards(this.id, this.portForwarder?.list() ?? [])
  }

  destroyPortForwardsIfDisabled(): void {
    if (!this.host.getFlags().portForwards) {
      this.portForwarder?.destroyAll()
      this.portForwarder = null
      this.pushPortForwards()
    }
  }

  shelfList(): Result<ShelfItem[]> {
    return ok([...this.shelf])
  }

  shelfClear(): Result<true> {
    this.shelf = []
    return ok(true)
  }

  shelfRemove(id: string): Result<true> {
    this.shelf = this.shelf.filter((i) => i.id !== id)
    return ok(true)
  }

  private addShelfPlaceholder(previewUrl?: string, sourcePath?: string): string {
    const id = randomUUID()
    const item: ShelfItem = {
      id,
      remotePath: '',
      hash: '',
      ext: 'png',
      bytes: 0,
      status: 'uploading',
      uploadedAt: new Date().toISOString(),
      previewUrl,
      sourcePath
    }
    this.shelf.unshift(item)
    this.host.onShelf(this.id, item)
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
      previewUrl: blob.previewUrl ?? this.shelf[idx].previewUrl
    }
    this.shelf[idx] = updated
    this.host.onShelf(this.id, updated)
  }

  private failShelfPlaceholder(id: string, message: string): void {
    const idx = this.shelf.findIndex((i) => i.id === id)
    if (idx === -1) return
    const updated: ShelfItem = {
      ...this.shelf[idx],
      status: 'failed',
      error: message
    }
    this.shelf[idx] = updated
    this.host.onShelf(this.id, updated)
  }

  async clearRemoteCache(): Promise<Result<{ deleted: number }>> {
    const gate = this.assertImageBridge()
    if (!gate.ok) return gate
    try {
      if (!this.ssh?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')
      const deleted = await this.ssh.deleteFilesIn(PORTICO_REMOTE_DIR, () => true)
      log.info('controller', 'cleared remote cache', {
        sessionId: this.id,
        deleted,
        dir: PORTICO_REMOTE_DIR
      })
      this.host.onStatus(
        'info',
        `Cleared ${deleted} blob(s) from ${PORTICO_REMOTE_DIR}.`,
        undefined,
        this.id
      )
      return ok({ deleted })
    } catch (e) {
      log.error('controller', 'clear remote cache failed', { err: e as Error })
      return err('CACHE_CLEAR_FAILED', (e as Error).message)
    }
  }
}

function assertTarget(t: SshTarget): void {
  if (!t.host) throw Object.assign(new Error('Host is required.'), { code: 'INVALID_TARGET' })
  if (!t.user) throw Object.assign(new Error('User is required.'), { code: 'INVALID_TARGET' })
  if (!t.password && !t.privateKeyPath && !t.useAgent) {
    throw Object.assign(new Error('Provide a password, a private key path, or SSH agent auth.'), {
      code: 'INVALID_TARGET'
    })
  }
}

function previewDataUrl(img: NormalizedImage): string {
  return `data:${img.mime};base64,${img.data.toString('base64')}`
}

/**
 * Multi-session registry: routes IPC by sessionId, holds global flags/prefs.
 */
export class PorticoController {
  private readonly sessions = new Map<SessionId, SessionHandle>()
  private flags: FeatureFlags = { ...DEFAULT_FLAGS }
  private tmuxPrefs: TmuxPrefs = { ...DEFAULT_TMUX_PREFS }

  outputListeners = new Set<(p: { sessionId: SessionId; data: string }) => void>()
  statusListeners = new Set<(s: StatusPayload) => void>()
  shelfListeners = new Set<(p: { sessionId: SessionId; item: ShelfItem }) => void>()
  connStateListeners = new Set<(payload: ConnStatePayload) => void>()
  pfListeners = new Set<(p: { sessionId: SessionId; forwards: PortForwardStatus[] }) => void>()
  sessionListeners = new Set<(p: { sessionId: SessionId; session: ProviderSession }) => void>()
  sessionsListListeners = new Set<(sessions: SessionSummary[]) => void>()

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    // Start with one draft session so the UI always has a place to connect.
    this.createSessionInternal()
  }

  private hostFns(): HandleHost {
    return {
      getFlags: () => this.flags,
      getTmuxPrefs: () => this.tmuxPrefs,
      onOutput: (sessionId, data) => {
        for (const cb of this.outputListeners) {
          try {
            cb({ sessionId, data })
          } catch (e) {
            log.warn('controller', 'output listener threw', { err: e as Error })
          }
        }
      },
      onStatus: (level, message, ttlMs, sessionId) => {
        this.pushStatus(level, message, ttlMs, sessionId)
      },
      onConnState: (payload) => {
        for (const cb of this.connStateListeners) {
          try {
            cb(payload)
          } catch (e) {
            log.warn('controller', 'connState listener threw', { err: e as Error })
          }
        }
      },
      onShelf: (sessionId, item) => {
        for (const cb of this.shelfListeners) {
          try {
            cb({ sessionId, item })
          } catch (e) {
            log.warn('controller', 'shelf listener threw', { err: e as Error })
          }
        }
      },
      onPortForwards: (sessionId, forwards) => {
        for (const cb of this.pfListeners) {
          try {
            cb({ sessionId, forwards })
          } catch (e) {
            log.warn('controller', 'pf listener threw', { err: e as Error })
          }
        }
      },
      onProviderSession: (sessionId, session) => {
        for (const cb of this.sessionListeners) {
          try {
            cb({ sessionId, session })
          } catch (e) {
            log.warn('controller', 'session listener threw', { err: e as Error })
          }
        }
      },
      onSummaryChanged: () => this.pushSessionsList()
    }
  }

  private createSessionInternal(title?: string): SessionHandle {
    const id = randomUUID()
    const handle = new SessionHandle(id, this.hostFns(), title)
    this.sessions.set(id, handle)
    return handle
  }

  private require(sessionId: SessionId): Result<SessionHandle> {
    const h = this.sessions.get(sessionId)
    if (!h) return err('NOT_FOUND', `Unknown session: ${sessionId}`)
    return ok(h)
  }

  private pushSessionsList(): void {
    const list = this.listSessionsArray()
    for (const cb of this.sessionsListListeners) {
      try {
        cb(list)
      } catch (e) {
        log.warn('controller', 'sessionsList listener threw', { err: e as Error })
      }
    }
  }

  private listSessionsArray(): SessionSummary[] {
    return [...this.sessions.values()].map((h) => h.summary())
  }

  createSession(): Result<SessionSummary> {
    if (this.sessions.size >= MAX_SESSIONS) {
      return err('SESSION_LIMIT', `Maximum of ${MAX_SESSIONS} sessions reached. Close one first.`)
    }
    const h = this.createSessionInternal()
    this.pushSessionsList()
    return ok(h.summary())
  }

  async closeSession(sessionId: SessionId): Promise<Result<true>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    await r.value.disconnect()
    this.sessions.delete(sessionId)
    // Always keep at least one draft session.
    if (this.sessions.size === 0) {
      this.createSessionInternal()
    }
    this.pushSessionsList()
    return ok(true)
  }

  listSessions(): Result<SessionSummary[]> {
    return ok(this.listSessionsArray())
  }

  renameSession(sessionId: SessionId, title: string): Result<SessionSummary> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    const t = title.trim()
    if (!t) return err('INVALID_TITLE', 'Title cannot be empty.')
    r.value.title = t.slice(0, 80)
    this.pushSessionsList()
    return ok(r.value.summary())
  }

  setFeatureFlags(partial: Partial<FeatureFlags>): Result<FeatureFlags> {
    this.flags = { ...this.flags, ...partial }
    log.info('controller', 'feature flags updated', this.flags as unknown as Record<string, unknown>)
    if (!this.flags.portForwards) {
      for (const h of this.sessions.values()) {
        h.destroyPortForwardsIfDisabled()
      }
    }
    return ok({ ...this.flags })
  }

  getFeatureFlags(): Result<FeatureFlags> {
    return ok({ ...this.flags })
  }

  setTmuxPrefs(partial: Partial<TmuxPrefs>): Result<TmuxPrefs> {
    this.tmuxPrefs = normalizeTmuxPrefs({ ...this.tmuxPrefs, ...partial })
    log.info('controller', 'tmux prefs updated', {
      mode: this.tmuxPrefs.mode,
      sessionName: this.tmuxPrefs.sessionName,
      syncRemoteClipboard: this.tmuxPrefs.syncRemoteClipboard
    })
    return ok({ ...this.tmuxPrefs })
  }

  getTmuxPrefs(): Result<TmuxPrefs> {
    return ok({ ...this.tmuxPrefs })
  }

  async connect(sessionId: SessionId, target: SshTarget): Promise<Result<ConnectResult>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.connect(target)
  }

  async connectLocal(sessionId: SessionId): Promise<Result<ConnectResult>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.connectLocal()
  }

  async disconnect(sessionId: SessionId): Promise<Result<true>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.disconnect()
  }

  isConnected(sessionId: SessionId): Result<boolean> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.isConnected()
  }

  getConnectionState(sessionId: SessionId): Result<{
    state: ConnectionState
    user?: string
    host?: string
    alias?: string
    sessionId: SessionId
  }> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.getConnectionState()
  }

  async cancelReconnect(sessionId: SessionId): Promise<Result<true>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.cancelReconnect()
  }

  sendInput(sessionId: SessionId, data: string): void {
    const r = this.require(sessionId)
    if (!r.ok) return
    r.value.sendInput(data)
  }

  resize(sessionId: SessionId, cols: number, rows: number): void {
    const r = this.require(sessionId)
    if (!r.ok) return
    r.value.resize(cols, rows)
  }

  clipboardHasImage(): Result<boolean> {
    return ok(clipboardHasImage())
  }

  async pasteImage(args: PasteImageArgs): Promise<Result<UploadedBlob>> {
    const r = this.require(args.sessionId)
    if (!r.ok) return r
    return r.value.pasteImage(args)
  }

  async uploadClipboard(sessionId: SessionId): Promise<Result<UploadedBlob>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.uploadClipboard()
  }

  async uploadLocalImage(args: UploadLocalImageArgs): Promise<Result<UploadedBlob>> {
    const r = this.require(args.sessionId)
    if (!r.ok) return r
    return r.value.uploadLocalImage(args)
  }

  async pasteRemotePath(
    sessionId: SessionId,
    remotePath: string,
    prompt?: string
  ): Promise<Result<true>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.pasteRemotePath(remotePath, prompt)
  }

  getSession(sessionId: SessionId): Result<ProviderSession> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.getSession()
  }

  setProvider(sessionId: SessionId, provider: ProviderId): Result<ProviderSession> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.setProvider(provider)
  }

  detectProvider(sessionId: SessionId): Result<ProviderId> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.detectProvider()
  }

  shelfList(sessionId: SessionId): Result<ShelfItem[]> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.shelfList()
  }

  shelfClear(sessionId: SessionId): Result<true> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.shelfClear()
  }

  shelfRemove(sessionId: SessionId, id: string): Result<true> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.shelfRemove(id)
  }

  async clearRemoteCache(sessionId: SessionId): Promise<Result<{ deleted: number }>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.clearRemoteCache()
  }

  async addPortForward(
    sessionId: SessionId,
    rule: { localPort: number; remoteHost: string; remotePort: number }
  ): Promise<Result<PortForwardRule>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.addPortForward(rule)
  }

  removePortForward(sessionId: SessionId, id: string): Result<true> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.removePortForward(id)
  }

  listPortForwards(sessionId: SessionId): Result<PortForwardStatus[]> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.listPortForwards()
  }

  async listTmuxSessions(sessionId: SessionId): Promise<Result<TmuxSessionInfo[]>> {
    const r = this.require(sessionId)
    if (!r.ok) return r
    return r.value.listTmuxSessions()
  }

  async enterTmux(args: TmuxEnterArgs): Promise<Result<{ action: string; session: string }>> {
    const r = this.require(args.sessionId)
    if (!r.ok) return r
    return r.value.enterTmux(args)
  }

  pushStatus(
    level: StatusPayload['level'],
    message: string,
    ttlMs?: number,
    sessionId?: SessionId
  ): void {
    // Default auto-dismiss so banners never sit over the terminal forever.
    // error: sticky (ttl omitted) unless caller passes an explicit ttlMs.
    const resolvedTtl =
      ttlMs !== undefined
        ? ttlMs
        : level === 'info'
          ? 3500
          : level === 'warn'
            ? 6000
            : undefined
    const payload: StatusPayload = {
      level,
      message,
      ttlMs: resolvedTtl && resolvedTtl > 0 ? resolvedTtl : undefined,
      sessionId
    }
    for (const cb of this.statusListeners) cb(payload)
  }
}

export type { PorticoApi }
