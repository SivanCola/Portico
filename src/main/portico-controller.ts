import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { PORTICO_REMOTE_DIR } from '@shared/constants.js'
import { detectProvider, formatForProvider } from '@shared/adapters.js'
import type { PorticoApi } from '@shared/ipc.js'
import { ok, err } from '@shared/result.js'
import { transition } from '@shared/session-fsm.js'
import type {
  PasteImageArgs,
  UploadLocalImageArgs,
  ConnectResult,
  ConnStatePayload,
  StatusPayload
} from '@shared/ipc.js'
import type {
  ConnectionState,
  NormalizedImage,
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
import { clipboardHasImage, readClipboardImage, readImageFile } from './clipboard.js'
import { getLogger, redactTarget } from './logger.js'
import {
  DEFAULT_TMUX_PREFS,
  buildAttachCommand,
  buildEnterShellCommand,
  buildHasTmuxCommand,
  buildInTmuxCommand,
  buildListSessionsCommand,
  buildNewSessionCommand,
  normalizeTmuxPrefs,
  parseListSessions,
  type TmuxPrefs,
  type TmuxSessionInfo
} from './tmux.js'

const MAX_RECONNECT_ATTEMPTS = 10
const log = getLogger()

/** Runtime feature flags — L2 capabilities that must never tear down L0 PTY. */
export interface FeatureFlags {
  /** Image paste / SFTP upload bridge. */
  imageBridge: boolean
  /** Local port forwards. */
  portForwards: boolean
  /** Auto-detect Claude/Codex from terminal output. */
  providerDetect: boolean
  /** electron-updater (honored by UpdateService via main). */
  autoUpdate: boolean
}

const DEFAULT_FLAGS: FeatureFlags = {
  imageBridge: true,
  portForwards: true,
  providerDetect: true,
  autoUpdate: true
}

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
  /** In-flight reconnect session so cancel/disconnect can abort a mid-connect attempt. */
  private pendingReconnectSession: SshSession | null = null
  /** Bumps on every user connect/disconnect to invalidate in-flight work. */
  private lifecycleEpoch = 0
  private connectInFlight = false
  private reconnectInFlight = false
  private flags: FeatureFlags = { ...DEFAULT_FLAGS }
  private tmuxPrefs: TmuxPrefs = { ...DEFAULT_TMUX_PREFS }

  outputListeners = new Set<(data: string) => void>()
  statusListeners = new Set<(s: StatusPayload) => void>()
  shelfListeners = new Set<(item: ShelfItem) => void>()
  connStateListeners = new Set<(payload: ConnStatePayload) => void>()
  pfListeners = new Set<(forwards: PortForwardStatus[]) => void>()
  sessionListeners = new Set<(session: ProviderSession) => void>()

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  /** Apply renderer feature flags (terminal-only mode, etc.). */
  setFeatureFlags(partial: Partial<FeatureFlags>): Result<FeatureFlags> {
    this.flags = { ...this.flags, ...partial }
    log.info('controller', 'feature flags updated', this.flags as unknown as Record<string, unknown>)
    if (!this.flags.portForwards) {
      this.portForwarder?.destroyAll()
      this.portForwarder = null
      this.pushPortForwards()
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
      sessionName: this.tmuxPrefs.sessionName
    })
    return ok({ ...this.tmuxPrefs })
  }

  getTmuxPrefs(): Result<TmuxPrefs> {
    return ok({ ...this.tmuxPrefs })
  }

  // ---- lifecycle -----------------------------------------------------------

  async connect(target: SshTarget): Promise<Result<ConnectResult>> {
    if (this.connectInFlight) {
      return err('BUSY', 'A connection attempt is already in progress.')
    }
    // Cancel any reconnect loop before starting a fresh connect.
    this.reconnectCancelled = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.connectInFlight = true
    const epoch = ++this.lifecycleEpoch

    // Tear down any previous session before starting a new one.
    if (this.session) {
      this.closeHandled = true
      try {
        await this.session.disconnect()
      } catch {
        /* ignore */
      }
      this.session = null
      this.portForwarder?.destroyAll()
      this.portForwarder = null
    }

    let session: SshSession | null = null
    try {
      this.assertTarget(target)
      log.info('controller', 'connect attempt', redactTarget(target))
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

      this.session = session
      this.target = target
      this.closeHandled = false

      if (this.flags.portForwards) {
        this.portForwarder = new PortForwarder(() => this.session?.getClient() ?? null)
        this.portForwarder.on('change', () => this.pushPortForwards())
      }

      this.interactive = true
      this.provider = 'shell'
      this.providerLocked = false
      this.reconnectAttempt = 0
      this.reconnectCancelled = false

      this.setConnState('connected', { phase: 'ready' })
      this.pushSession()
      log.info('controller', 'connected', { ...redactTarget(target), cwd: info.initialCwd })
      this.pushStatus('info', `Connected to ${target.user}@${target.host}.`)
      // Optional tmux entry (L2) — never fails the connect Result.
      void this.maybeEnterTmux('connect')
      return ok({ connected: true, initialCwd: info.initialCwd })
    } catch (e) {
      log.error('controller', 'connect failed', { ...redactTarget(target), err: e as Error })
      // Orphan cleanup: shell may have opened before a later step failed.
      if (session) {
        this.closeHandled = true
        try {
          await session.disconnect()
        } catch {
          /* ignore */
        }
      }
      if (epoch === this.lifecycleEpoch) {
        this.session = null
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
    // Mark close as handled before tearing down so the intentional SSH close
    // event does not surface a spurious "session closed" warning.
    this.closeHandled = true
    const pending = this.pendingReconnectSession
    this.pendingReconnectSession = null
    try {
      await pending?.disconnect()
    } catch {
      /* ignore */
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

  getConnectionState(): Result<{ state: ConnectionState; user?: string; host?: string; alias?: string }> {
    return ok({
      state: this.connState,
      user: this.target?.user,
      host: this.target?.host,
      alias: this.target?.alias
    })
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
    try {
      await this.session?.disconnect()
    } catch {
      /* ignore */
    }
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
      // User-initiated disconnect already set state; skip the warn banner.
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
    if (this.reconnectInFlight || this.connectInFlight) {
      log.warn('controller', 'reconnect skipped: connect already in flight')
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
      log.error('controller', `reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts`)
      this.setConnState('disconnected')
      this.pushStatus('error', `Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts.`)
      this.portForwarder?.destroyAll()
      this.portForwarder = null
      this.target = null
      return
    }

    this.reconnectInFlight = true
    const epoch = this.lifecycleEpoch
    this.reconnectAttempt++
    this.setConnState('reconnecting', { attempt: this.reconnectAttempt })

    try {
      try { await this.session?.disconnect() } catch { /* ignore */ }
      this.session = null

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
        // Clear only if we still own this pending handle (cancel may have nullified it).
        if (this.pendingReconnectSession === session) {
          this.pendingReconnectSession = null
        }
      }

      // Cancel/disconnect may have raced while connect() was in flight.
      if (this.reconnectCancelled || !this.target || epoch !== this.lifecycleEpoch) {
        try {
          await session.disconnect()
        } catch {
          /* ignore */
        }
        this.setConnState('disconnected')
        return
      }

      this.session = session
      this.closeHandled = false

      // The new PTY starts at the default 80x24; replay the renderer's last
      // known geometry so full-screen programs render correctly.
      if (this.lastDims) session.resize(this.lastDims)

      for (const cb of this.outputListeners) {
        cb('\r\n\x1b[32m[Reconnected]\x1b[0m\r\n')
      }

      if (this.flags.portForwards) {
        this.portForwarder?.resumeAll()
      }

      this.reconnectAttempt = 0
      this.setConnState('connected')
      log.info('controller', 'reconnected', redactTarget(this.target))
      this.pushStatus('info', `Reconnected to ${this.target.user}@${this.target.host}.`, 5000)
      void this.maybeEnterTmux('reconnect')
    } catch (e) {
      if (this.reconnectCancelled || !this.target || epoch !== this.lifecycleEpoch) {
        this.setConnState('disconnected')
        return
      }

      const delayMs = Math.min(30_000, 1000 * Math.pow(2, this.reconnectAttempt - 1))
      const delaySec = Math.round(delayMs / 1000)
      log.warn('controller', `reconnect attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS} failed`, {
        ...redactTarget(this.target),
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
    } finally {
      this.reconnectInFlight = false
    }
  }

  private attachSessionListeners(session: SshSession): void {
    session.on('data', (chunk: string) => this.handleOutput(chunk))
    session.on('close', (info: { intentional: boolean }) => this.handleSessionClose(info))
    // Transport errors are L0-visible but must not throw into the event loop.
    session.on('error', (e: Error) => {
      log.warn('controller', 'session error (non-fatal for listeners)', { err: e })
      this.pushStatus('error', e.message, 6000)
    })
  }

  private setConnState(state: ConnectionState, extra?: Partial<ConnStatePayload>): void {
    const from = this.connState
    // Idempotent disconnect — no log spam on double teardown.
    if (from === 'disconnected' && state === 'disconnected') {
      return
    }
    const result = transition(from, state)
    if (!result.ok) {
      // Phase-only updates while still connecting (tcp → auth → shell → home).
      const phaseUpdate = from === 'connecting' && state === 'connecting'
      if (!phaseUpdate) {
        log.warn('controller', result.reason)
        // disconnected is a hard reset sink for teardown paths.
        if (state !== 'disconnected') return
      }
    }
    this.connState = state
    const payload: ConnStatePayload = { state, ...extra }
    for (const cb of this.connStateListeners) {
      try {
        cb(payload)
      } catch (e) {
        log.warn('controller', 'connState listener threw', { err: e as Error })
      }
    }
  }

  // ---- tmux (L2 — soft failures only) --------------------------------------

  /**
   * After connect/reconnect: optionally inject a tmux attach/new line into the
   * interactive PTY according to prefs. Never throws into the caller.
   */
  private async maybeEnterTmux(reason: 'connect' | 'reconnect'): Promise<void> {
    try {
      const r = await this.enterTmux()
      if (!r.ok) {
        // off / no tmux / already in tmux → quiet; real errors get a soft banner
        if (r.error.code !== 'TMUX_OFF' && r.error.code !== 'TMUX_NESTED' && r.error.code !== 'TMUX_MISSING') {
          this.pushStatus('warn', r.error.message, 5000)
        } else if (r.error.code === 'TMUX_MISSING' && this.tmuxPrefs.mode !== 'off') {
          this.pushStatus(
            'info',
            'tmux not found on remote — staying in plain shell. Install tmux or set mode to Off.',
            6000
          )
        }
        return
      }
      log.info('controller', `tmux enter (${reason})`, { action: r.value.action, session: r.value.session })
    } catch (e) {
      log.warn('controller', 'tmux enter failed (ignored)', { err: e as Error })
    }
  }

  async listTmuxSessions(): Promise<Result<TmuxSessionInfo[]>> {
    try {
      if (!this.session?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')
      const has = (await this.session.runAndCapture(buildHasTmuxCommand(), { timeoutMs: 8_000 })).trim()
      if (has !== 'yes') return err('TMUX_MISSING', 'tmux is not installed on the remote host.')
      const out = await this.session.runAndCapture(buildListSessionsCommand(), { timeoutMs: 8_000 })
      return ok(parseListSessions(out))
    } catch (e) {
      return err('TMUX_LIST_FAILED', (e as Error).message)
    }
  }

  /**
   * Inject a shell one-liner into the interactive PTY to attach/create tmux.
   * Prefs drive the default; optional overrides for command palette actions.
   */
  async enterTmux(opts?: {
    /** Override mode for this call only. */
    mode?: TmuxPrefs['mode']
    sessionName?: string
    /** Force attach to a specific existing session. */
    attachOnly?: string
    /** Force create a new named session. */
    createNew?: string
  }): Promise<Result<{ action: string; session: string }>> {
    try {
      if (!this.session?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')

      const prefs = normalizeTmuxPrefs({
        mode: opts?.mode ?? this.tmuxPrefs.mode,
        sessionName: opts?.sessionName ?? this.tmuxPrefs.sessionName
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

      // Soft probes via exec (do not block PTY on failure).
      const has = (await this.session.runAndCapture(buildHasTmuxCommand(), { timeoutMs: 8_000 })).trim()
      if (has !== 'yes') return err('TMUX_MISSING', 'tmux is not installed on the remote host.')

      const nested = (await this.session.runAndCapture(buildInTmuxCommand(), { timeoutMs: 5_000 })).trim()
      if (nested === 'yes') {
        return err('TMUX_NESTED', 'Already inside a tmux session — skipped.')
      }

      // Give the login shell a brief moment to print the prompt, then inject.
      await new Promise((r) => setTimeout(r, 350))
      if (!this.session?.isConnected()) return err('NOT_CONNECTED', 'Session closed before tmux enter.')

      this.session.write(`${line}\n`)
      this.pushStatus(
        'info',
        action === 'new'
          ? `Starting tmux session “${session}”…`
          : action === 'attach'
            ? `Attaching tmux session “${session}”…`
            : `Entering tmux (${prefs.mode}: ${session})…`,
        4000
      )
      return ok({ action, session })
    } catch (e) {
      return err('TMUX_ENTER_FAILED', (e as Error).message)
    }
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
    // Provider detection is L2 — never throw into the PTY data path.
    if (this.flags.providerDetect && !this.providerLocked) {
      try {
        const detected = detectProvider({
          recentOutput: this.session?.recentOutput() ?? [],
          currentLine: ''
        })
        if (detected !== 'shell') {
          this.provider = detected
          this.providerLocked = true
          this.pushSession()
          this.pushStatus('info', `Detected ${detected}.`, 3000)
        }
      } catch (e) {
        log.warn('controller', 'provider detect failed (ignored)', { err: e as Error })
      }
    }
    for (const cb of this.outputListeners) {
      try {
        cb(chunk)
      } catch (e) {
        log.warn('controller', 'output listener threw', { err: e as Error })
      }
    }
  }

  // ---- image bridge --------------------------------------------------------

  private assertImageBridge(): Result<true> {
    if (!this.flags.imageBridge) {
      return err('FEATURE_DISABLED', 'Image bridge is disabled (Terminal only mode).')
    }
    return ok(true)
  }

  clipboardHasImage(): Result<boolean> {
    return ok(clipboardHasImage())
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
    /** Local filesystem path when the source was a file (for shelf retry). */
    sourcePath?: string
    load: () => Promise<NormalizedImage | null>
  }): Promise<Result<UploadedBlob>> {
    let placeholderId: string | null = null
    // Capture session reference so a reconnect mid-upload cannot write to a new PTY by accident.
    const session = this.session
    try {
      if (!session?.isConnected()) return err('NOT_CONNECTED', 'Connect to a host first.')
      const img = await opts.load()
      if (!img) return err('NO_IMAGE', 'No image found.')

      const previewUrl = previewDataUrl(img)
      placeholderId = this.addShelfPlaceholder(previewUrl, opts.sourcePath)

      // SFTP upload is L2: failures return Result.err and never call session.disconnect.
      const { blob } = await uploadBlob(session, img)
      const withPreview: UploadedBlob = { ...blob, previewUrl }
      log.info('controller', 'image uploaded', { hash: blob.hash, bytes: blob.bytes, ext: blob.ext })

      // If the user disconnected during upload, still report success for the blob
      // but skip inject (session may be gone).
      if (this.session !== session || !session.isConnected()) {
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
          // Inject failure must not mark the upload as failed — file is on the remote.
          log.warn('controller', 'inject after upload failed', { err: e as Error })
          this.pushStatus('warn', `Uploaded, but inject failed: ${(e as Error).message}`, 5000)
        }
      }

      this.commitShelfPlaceholder(placeholderId, withPreview, opts.prompt)
      return ok(withPreview)
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'UPLOAD_FAILED'
      const message = (e as Error).message
      log.error('controller', 'image upload failed', { code, err: e as Error })
      if (placeholderId) this.failShelfPlaceholder(placeholderId, message)
      // Explicitly do NOT disconnect or mutate connState — L2 isolation.
      return err(code, message)
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
      this.inject(fragment, this.provider)
      return ok(true)
    } catch (e) {
      return err('PASTE_FAILED', (e as Error).message)
    }
  }

  private inject(fragment: string, provider: ProviderId = this.provider): void {
    // Shell comments are fine as a completed line. Claude/Codex REPLs treat
    // Enter as submit — leave the fragment without a trailing newline so the
    // user can edit the prompt before sending.
    const text =
      provider === 'shell'
        ? /\n$/.test(fragment)
          ? fragment
          : `${fragment}\n`
        : fragment
    this.session?.write(text)
  }

  // ---- session / provider --------------------------------------------------

  getSession(): Result<ProviderSession> {
    return ok(this.sessionSnapshot())
  }

  setProvider(provider: ProviderId): Result<ProviderSession> {
    this.provider = provider
    this.providerLocked = true
    const snap = this.sessionSnapshot()
    this.pushSession(snap)
    return ok(snap)
  }

  detectProvider(): Result<ProviderId> {
    const detected = detectProvider({
      recentOutput: this.session?.recentOutput() ?? [],
      currentLine: ''
    })
    // Apply the detection so subsequent pastes use the new provider.
    this.provider = detected
    this.providerLocked = true
    this.pushSession()
    return ok(detected)
  }

  private sessionSnapshot(): ProviderSession {
    return {
      provider: this.provider,
      // MVP always uses an interactive PTY; Codex `codex -i` stays reserved
      // for a future non-interactive path.
      interactive: this.interactive,
      nativePasteAvailable: false
    }
  }

  private pushSession(snap: ProviderSession = this.sessionSnapshot()): void {
    for (const cb of this.sessionListeners) cb(snap)
  }

  // ---- port forwarding -----------------------------------------------------

  async addPortForward(rule: {
    localPort: number
    remoteHost: string
    remotePort: number
  }): Promise<Result<PortForwardRule>> {
    if (!this.flags.portForwards) {
      return err('FEATURE_DISABLED', 'Port forwarding is disabled (Terminal only mode).')
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
      previewUrl: blob.previewUrl ?? this.shelf[idx].previewUrl
    }
    this.shelf[idx] = updated
    this.emitShelf(updated)
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
    this.emitShelf(updated)
  }

  private emitShelf(item: ShelfItem): void {
    for (const cb of this.shelfListeners) cb(item)
  }

  // ---- remote cache --------------------------------------------------------

  async clearRemoteCache(): Promise<Result<{ deleted: number }>> {
    const gate = this.assertImageBridge()
    if (!gate.ok) return gate
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
    if (!t.password && !t.privateKeyPath && !t.useAgent) {
      throw Object.assign(
        new Error('Provide a password, a private key path, or SSH agent auth.'),
        { code: 'INVALID_TARGET' }
      )
    }
  }
}

/** Build a data-URL preview from normalized image bytes for the shelf thumbnail. */
function previewDataUrl(img: NormalizedImage): string {
  return `data:${img.mime};base64,${img.data.toString('base64')}`
}

export type { PorticoApi }
