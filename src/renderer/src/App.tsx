import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppInfo,
  ConnectPhase,
  ConnectionState,
  PortForwardStatus,
  ProviderId,
  ProviderSession,
  ShelfItem,
  SshTarget,
  UpdateStatus
} from '@shared/types.js'
import type { ConnStatePayload, StatusPayload } from '@shared/ipc.js'
import { ConnectionForm } from './components/ConnectionForm.js'
import { Terminal } from './components/Terminal.js'
import { ImageShelf } from './components/ImageShelf.js'
import { PortForwards } from './components/PortForwards.js'
import { CommandPalette, type PaletteAction } from './components/CommandPalette.js'
import { PastePromptDialog } from './components/PastePromptDialog.js'
import { SettingsCenter, type SettingsSection } from './components/SettingsCenter.js'
import {
  loadTerminalSettings,
  saveTerminalSettings,
  type TerminalSettings
} from './lib/terminal-settings.js'
import {
  loadAppSettings,
  saveAppSettings,
  normalizeAppSettings,
  toFeatureFlags,
  toTmuxPrefs,
  type AppSettings
} from './lib/app-settings.js'

type ConnInfo = { user: string; host: string; alias?: string } | null
type PromptMode = { kind: 'clipboard' } | { kind: 'file'; path: string } | null

export function App() {
  const [connState, setConnState] = useState<ConnectionState>('disconnected')
  const [connectPhase, setConnectPhase] = useState<ConnectPhase | null>(null)
  const [connInfo, setConnInfo] = useState<ConnInfo>(null)
  const [reconnectInfo, setReconnectInfo] = useState<{ attempt: number; nextRetryIn?: number } | null>(null)
  const [session, setSession] = useState<ProviderSession | null>(null)
  const [shelf, setShelf] = useState<ShelfItem[]>([])
  const [portForwards, setPortForwards] = useState<PortForwardStatus[]>([])
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [promptMode, setPromptMode] = useState<PromptMode>(null)
  const [dragOver, setDragOver] = useState(false)
  const [termSettings, setTermSettings] = useState<TerminalSettings>(() => loadTerminalSettings())
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateTermSettings = useCallback((next: TerminalSettings) => {
    setTermSettings(next)
    saveTerminalSettings(next)
  }, [])

  const syncMainPrefs = useCallback(async (s: AppSettings) => {
    try {
      await window.portico.setFeatureFlags(toFeatureFlags(s))
      await window.portico.setTmuxPrefs(toTmuxPrefs(s))
    } catch {
      /* main may not be ready yet */
    }
  }, [])

  const updateAppSettings = useCallback(
    (next: AppSettings) => {
      const normalized = normalizeAppSettings(next)
      setAppSettings(normalized)
      saveAppSettings(normalized)
      void syncMainPrefs(normalized)
    },
    [syncMainPrefs]
  )

  // Push flags + tmux prefs once on mount so main matches saved settings.
  useEffect(() => {
    void syncMainPrefs(loadAppSettings())
  }, [syncMainPrefs])

  const openSettings = useCallback((section: SettingsSection = 'general') => {
    setSettingsSection(section)
    setSettingsOpen(true)
  }, [])

  const isActive = connState === 'connected' || connState === 'connecting' || connState === 'reconnecting'

  // ---- status banner with optional auto-dismiss ---------------------------
  const pushStatus = useCallback((s: StatusPayload) => {
    setStatus(s)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    if (s.ttlMs && s.ttlMs > 0) {
      statusTimer.current = setTimeout(() => setStatus(null), s.ttlMs)
    }
  }, [])

  useEffect(() => window.portico.onStatus(pushStatus), [pushStatus])

  // ---- app identity (name + version for the top bar / beta badge) --------
  useEffect(() => {
    window.portico
      .getAppInfo()
      .then((r) => {
        if (r.ok) setAppInfo(r.value)
      })
      .catch(() => {})
  }, [])

  // ---- live auto-update status from main ----------------------------------
  useEffect(() => window.portico.onUpdateStatus(setUpdateStatus), [])

  // ---- live provider session from main (auto-detect / setProvider) --------
  useEffect(() => window.portico.onSessionChanged(setSession), [])

  // ---- refresh the provider session whenever connection changes -----------
  const refreshSession = useCallback(async () => {
    const r = await window.portico.getSession()
    if (r.ok) setSession(r.value)
  }, [])

  // ---- resync with main on mount (e.g. after a renderer reload) -----------
  useEffect(() => {
    window.portico
      .getConnectionState()
      .then((r) => {
        if (!r.ok || r.value.state === 'disconnected') return
        setConnState(r.value.state)
        if (r.value.user && r.value.host) {
          setConnInfo({ user: r.value.user, host: r.value.host, alias: r.value.alias })
        }
        void refreshSession()
        window.portico.listPortForwards().then((pf) => {
          if (pf.ok) setPortForwards(pf.value)
        })
      })
      .catch(() => {})
  }, [refreshSession])

  // ---- connection state from main -----------------------------------------
  useEffect(() => {
    return window.portico.onConnectionState((payload: ConnStatePayload) => {
      setConnState(payload.state)
      if (payload.state === 'connecting') {
        setConnectPhase(payload.phase ?? 'resolving')
      } else {
        setConnectPhase(null)
      }
      if (payload.state === 'reconnecting') {
        setReconnectInfo({ attempt: payload.attempt!, nextRetryIn: payload.nextRetryIn })
      } else {
        setReconnectInfo(null)
      }
      if (payload.state === 'disconnected') {
        setConnInfo(null)
        setSession(null)
      }
    })
  }, [])

  // ---- live countdown while waiting for the next reconnect attempt --------
  useEffect(() => {
    if (connState !== 'reconnecting') return
    const t = setInterval(() => {
      setReconnectInfo((info) =>
        info && info.nextRetryIn != null && info.nextRetryIn > 0
          ? { ...info, nextRetryIn: info.nextRetryIn - 1 }
          : info
      )
    }, 1000)
    return () => clearInterval(t)
  }, [connState])

  // ---- port forward updates -----------------------------------------------
  useEffect(() => {
    return window.portico.onPortForwardChanged(setPortForwards)
  }, [])

  // ---- shelf: live updates from main --------------------------------------
  useEffect(() => {
    const off = window.portico.onShelfItemUpdated((item) => {
      setShelf((prev) => {
        const idx = prev.findIndex((i) => i.id === item.id)
        if (idx === -1) return [item, ...prev]
        const next = [...prev]
        next[idx] = { ...next[idx], ...item }
        return next
      })
    })
    window.portico
      .shelfList()
      .then((r) => {
        if (r.ok) setShelf(r.value)
      })
      .catch(() => {})
    return off
  }, [])

  // ---- connect / disconnect -----------------------------------------------
  const connect = useCallback(
    async (t: SshTarget): Promise<string | null> => {
      const r = await window.portico.connect(t)
      if (!r.ok) return r.error.message
      setConnInfo({ user: t.user, host: t.host, alias: t.alias })
      await refreshSession()
      const sl = await window.portico.shelfList()
      if (sl.ok) setShelf(sl.value)
      return null
    },
    [refreshSession]
  )

  const disconnect = useCallback(async () => {
    await window.portico.disconnect()
    setConnInfo(null)
    setConnState('disconnected')
    setSession(null)
    setPortForwards([])
  }, [])

  const cancelReconnect = useCallback(async () => {
    await window.portico.cancelReconnect()
    setConnInfo(null)
    setConnState('disconnected')
    setSession(null)
    setPortForwards([])
  }, [])

  // ---- provider switch -----------------------------------------------------
  const setProvider = useCallback(
    async (p: ProviderId) => {
      const r = await window.portico.setProvider(p)
      if (r.ok) setSession(r.value)
    },
    []
  )

  // ---- image actions -------------------------------------------------------
  const runUpload = useCallback(
    async (mode: PromptMode, prompt: string) => {
      if (!mode) return
      if (mode.kind === 'clipboard') {
        const r = await window.portico.pasteImage({ prompt })
        if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
        else pushStatus({ level: 'info', message: `Pasted → ${r.value.remotePath}`, ttlMs: 4000 })
      } else {
        const r = await window.portico.uploadLocalImage({
          path: mode.path,
          prompt,
          inject: true
        })
        if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
        else pushStatus({ level: 'info', message: `Pasted → ${r.value.remotePath}`, ttlMs: 4000 })
      }
    },
    [pushStatus]
  )

  const openPastePrompt = useCallback(async () => {
    if (!appSettings.enableImageBridge) {
      pushStatus({
        level: 'warn',
        message: 'Image bridge is disabled. Turn off Terminal only mode in Settings.',
        ttlMs: 5000
      })
      return
    }
    if (connState !== 'connected') {
      pushStatus({
        level: 'warn',
        message: 'Connect to a host before pasting an image.',
        ttlMs: 4000
      })
      return
    }
    try {
      const has = await window.portico.clipboardHasImage()
      if (has.ok && !has.value) {
        pushStatus({
          level: 'warn',
          message: 'No image in clipboard. Copy a screenshot or image first, then ⌘⇧V.',
          ttlMs: 5000
        })
        return
      }
    } catch {
      /* main will surface NO_IMAGE on upload */
    }
    if (appSettings.skipPastePrompt) {
      await runUpload({ kind: 'clipboard' }, appSettings.defaultPastePrompt)
      return
    }
    setPromptMode({ kind: 'clipboard' })
  }, [connState, pushStatus, appSettings, runUpload, appSettings.enableImageBridge])

  const runPasteWithPrompt = useCallback(
    async (prompt: string) => {
      const mode = promptMode
      setPromptMode(null)
      if (!mode) return
      await runUpload(mode, prompt || appSettings.defaultPastePrompt)
    },
    [promptMode, runUpload, appSettings.defaultPastePrompt]
  )

  const pasteImage = openPastePrompt

  const beginFileUpload = useCallback(
    async (path: string) => {
      if (appSettings.skipPastePrompt) {
        await runUpload({ kind: 'file', path }, appSettings.defaultPastePrompt)
        return
      }
      setPromptMode({ kind: 'file', path })
    },
    [appSettings, runUpload]
  )

  const uploadClipboard = useCallback(async () => {
    const r = await window.portico.uploadClipboard()
    if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
    else pushStatus({ level: 'info', message: `Uploaded to ${r.value.remotePath}`, ttlMs: 4000 })
  }, [pushStatus])

  const pickImageFile = useCallback(async () => {
    if (connState !== 'connected') return
    const r = await window.portico.pickImageFile()
    if (!r.ok || !r.value) return
    await beginFileUpload(r.value)
  }, [connState, beginFileUpload])

  const repaste = useCallback(
    async (item: ShelfItem) => {
      const r = await window.portico.pasteRemotePath(item.remotePath, item.prompt)
      if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
    },
    [pushStatus]
  )

  const retryFailed = useCallback(
    (item: ShelfItem) => {
      void window.portico.shelfRemove(item.id)
      setShelf((prev) => prev.filter((i) => i.id !== item.id))
      if (item.sourcePath) void beginFileUpload(item.sourcePath)
      else void pasteImage()
    },
    [beginFileUpload, pasteImage]
  )

  const removeShelfItem = useCallback(async (item: ShelfItem) => {
    await window.portico.shelfRemove(item.id)
    setShelf((prev) => prev.filter((i) => i.id !== item.id))
  }, [])

  const copyPath = useCallback(
    async (item: ShelfItem) => {
      try {
        await navigator.clipboard.writeText(item.remotePath)
        pushStatus({ level: 'info', message: 'Copied remote path.', ttlMs: 2000 })
      } catch {
        pushStatus({ level: 'error', message: 'Clipboard unavailable.', ttlMs: 3000 })
      }
    },
    [pushStatus]
  )

  const clearShelf = useCallback(async () => {
    await window.portico.shelfClear()
    setShelf([])
  }, [])

  // ---- drag & drop images onto the workspace -----------------------------
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (connState !== 'connected') return
      if (![...e.dataTransfer?.types ?? []].includes('Files')) return
      e.preventDefault()
      setDragOver(true)
    }
    const onDragLeave = () => setDragOver(false)
    const onDrop = (e: DragEvent) => {
      setDragOver(false)
      if (connState !== 'connected') return
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (!file || !file.type.startsWith('image/')) {
        pushStatus({ level: 'warn', message: 'Drop an image file.', ttlMs: 3000 })
        return
      }
      // Electron File has a non-standard `.path` for local filesystem path.
      const path = (file as File & { path?: string }).path
      if (!path) {
        pushStatus({ level: 'error', message: 'Could not resolve dropped file path.', ttlMs: 4000 })
        return
      }
      void beginFileUpload(path)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [connState, pushStatus, beginFileUpload])

  const focusTerminal = useCallback(() => {
    document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }, [])

  const closePalette = useCallback(() => {
    setPaletteOpen(false)
    focusTerminal()
  }, [focusTerminal])

  const clearRemoteCache = useCallback(async () => {
    if (appSettings.confirmClearCache) {
      const ok = window.confirm(
        'Delete every uploaded image blob on the remote host (~/.portico*/blobs)? This cannot be undone.'
      )
      if (!ok) return
    }
    const r = await window.portico.clearRemoteCache()
    if (r.ok) pushStatus({ level: 'info', message: `Cleared ${r.value.deleted} blob(s).`, ttlMs: 4000 })
    else pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
  }, [pushStatus, appSettings.confirmClearCache])

  // ---- auto-update actions -------------------------------------------------
  const checkForUpdates = useCallback(async () => {
    const r = await window.portico.checkForUpdates()
    if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
    else if (r.value.state === 'not-available') {
      pushStatus({ level: 'info', message: r.value.message ?? 'You are on the latest version.', ttlMs: 4000 })
    }
  }, [pushStatus])

  const installUpdate = useCallback(async () => {
    const r = await window.portico.installUpdate()
    if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
  }, [pushStatus])

  // ---- global shortcuts: ⌘, settings · ⌘⇧P palette · paste from main ------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const isP = e.code === 'KeyP' || e.key.toLowerCase() === 'p'
      const isV = e.code === 'KeyV' || e.key.toLowerCase() === 'v'
      const isComma = e.code === 'Comma' || e.key === ','
      // ⌘, — settings center (skip when typing in inputs handled by stop on dialog)
      if (!e.shiftKey && isComma) {
        e.preventDefault()
        openSettings(settingsOpen ? settingsSection : 'general')
        return
      }
      if (e.shiftKey && isP) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (e.shiftKey && isV) {
        e.preventDefault()
        void pasteImage()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pasteImage, openSettings, settingsOpen, settingsSection])

  // Main-process menu / before-input accelerators.
  useEffect(() => {
    return window.portico.onPasteImageShortcut(() => {
      void pasteImage()
    })
  }, [pasteImage])

  useEffect(() => {
    return window.portico.onOpenSettings(() => openSettings('general'))
  }, [openSettings])

  useEffect(() => {
    return window.portico.onOpenPalette(() => setPaletteOpen((o) => !o))
  }, [])

  // ---- palette actions -----------------------------------------------------
  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'paste-image',
        title: 'Paste Image to Remote AI',
        hint: 'Upload clipboard image + inject provider prompt  ·  ⌘⇧V',
        enabled: connState === 'connected',
        run: pasteImage
      },
      {
        id: 'upload-clipboard',
        title: 'Upload Clipboard Image',
        hint: 'Upload without injecting into the terminal',
        enabled: connState === 'connected',
        run: uploadClipboard
      },
      {
        id: 'upload-file',
        title: 'Upload Image File…',
        hint: 'Pick a local image and paste into the remote AI',
        enabled: connState === 'connected',
        run: pickImageFile
      },
      {
        id: 'detect-provider',
        title: 'Re-detect AI provider',
        hint: 'Heuristically detect Claude / Codex / shell',
        enabled: connState === 'connected',
        run: async () => {
          const r = await window.portico.detectProvider()
          if (!r.ok) {
            pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
            return
          }
          // Main already applied detection and pushed SESSION_CHANGED.
          pushStatus({ level: 'info', message: `Provider set to ${r.value}`, ttlMs: 3000 })
        }
      },
      {
        id: 'clear-remote-cache',
        title: 'Clear Remote Portico Cache',
        hint: 'Delete every blob in ~/.portico/blobs',
        enabled: connState === 'connected',
        run: clearRemoteCache
      },
      {
        id: 'settings',
        title: 'Settings…',
        hint: 'General, terminal, image bridge, about  ·  ⌘,',
        enabled: true,
        run: () => openSettings('general')
      },
      {
        id: 'terminal-settings',
        title: 'Terminal Settings…',
        hint: 'Theme, font, WebGL, copy-on-select',
        enabled: true,
        run: () => openSettings('terminal')
      },
      {
        id: 'tmux-settings',
        title: 'tmux Settings…',
        hint: 'Auto-enter remote session after connect',
        enabled: true,
        run: () => openSettings('tmux')
      },
      {
        id: 'tmux-enter',
        title: 'tmux: Enter default session',
        hint: `Attach or create “${appSettings.tmuxSessionName}”`,
        enabled: connState === 'connected',
        run: async () => {
          const r = await window.portico.enterTmux({
            mode: 'always',
            sessionName: appSettings.tmuxSessionName
          })
          if (!r.ok) pushStatus({ level: 'warn', message: r.error.message, ttlMs: 5000 })
        }
      },
      {
        id: 'tmux-list',
        title: 'tmux: List sessions',
        hint: 'Show remote tmux sessions in the status bar',
        enabled: connState === 'connected',
        run: async () => {
          const r = await window.portico.listTmuxSessions()
          if (!r.ok) {
            pushStatus({ level: 'warn', message: r.error.message, ttlMs: 5000 })
            return
          }
          if (r.value.length === 0) {
            pushStatus({ level: 'info', message: 'No tmux sessions on remote.', ttlMs: 4000 })
            return
          }
          const summary = r.value
            .map((s) => `${s.name}(${s.windows}w${s.attached ? ',att' : ''})`)
            .join(' · ')
          pushStatus({ level: 'info', message: `tmux: ${summary}`, ttlMs: 8000 })
        }
      },
      {
        id: 'tmux-new',
        title: 'tmux: New default session',
        hint: `tmux new -s ${appSettings.tmuxSessionName}`,
        enabled: connState === 'connected',
        run: async () => {
          const r = await window.portico.enterTmux({ createNew: appSettings.tmuxSessionName })
          if (!r.ok) pushStatus({ level: 'warn', message: r.error.message, ttlMs: 5000 })
        }
      },
      {
        id: 'check-for-updates',
        title: 'Check for Updates',
        hint: 'Look for a new version on the update channel',
        enabled: updateStatus?.state !== 'checking' && updateStatus?.state !== 'downloading',
        run: checkForUpdates
      },
      {
        id: 'install-update',
        title: 'Restart to Install Update',
        hint: 'Quit and relaunch into the downloaded update',
        enabled: updateStatus?.state === 'downloaded',
        run: installUpdate
      },
      {
        id: 'disconnect',
        title: 'Disconnect',
        enabled: isActive,
        run: disconnect
      }
    ],
    [
      connState,
      isActive,
      pasteImage,
      uploadClipboard,
      pickImageFile,
      clearRemoteCache,
      checkForUpdates,
      installUpdate,
      disconnect,
      pushStatus,
      updateStatus?.state,
      openSettings,
      appSettings.tmuxSessionName,
      pushStatus
    ]
  )

  return (
    <div className={`app ${dragOver ? 'drag-over' : ''}`}>
      <TopBar
        connState={connState}
        connInfo={connInfo}
        provider={session?.provider ?? 'shell'}
        onProvider={setProvider}
        onDisconnect={disconnect}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => openSettings('general')}
        appInfo={appInfo}
      />
      <div className="workspace">
        <div className="terminal-pane">
          {connState === 'disconnected' || connState === 'connecting' ? (
            <ConnectionForm onConnect={connect} phase={connectPhase} />
          ) : (
            <>
              {connState === 'reconnecting' && reconnectInfo && (
                <div className="reconnect-banner">
                  <span>
                    Connection lost. Reconnecting (attempt {reconnectInfo.attempt}/10)
                    {reconnectInfo.nextRetryIn != null && `... next retry in ${reconnectInfo.nextRetryIn}s`}
                    {' · '}Paste image disabled until reconnected.
                  </span>
                  <button className="btn ghost" onClick={cancelReconnect}>Cancel</button>
                </div>
              )}
              <div className="term-toolbar">
                {appSettings.enableImageBridge && (
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12, padding: '2px 10px' }}
                    disabled={connState !== 'connected'}
                    onClick={() => void pasteImage()}
                    title="Upload clipboard image and inject into the terminal  ·  ⌘⇧V"
                  >
                    <span className="kbd">⌘⇧V</span> Paste image
                  </button>
                )}
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  {appSettings.terminalOnly
                    ? 'Terminal only · ⌘F find'
                    : connState === 'connected'
                      ? 'or File… / drop · ⌘F find'
                      : 'unavailable while reconnecting'}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  Provider:{' '}
                  <strong style={{ textTransform: 'capitalize', color: 'var(--text)' }}>
                    {session?.provider ?? 'shell'}
                  </strong>
                  {session?.provider !== 'shell' ? ' · interactive REPL' : ''}
                </span>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ fontSize: 12, padding: '2px 10px' }}
                  onClick={() => openSettings('terminal')}
                  title="Settings · Terminal  ·  ⌘,"
                >
                  Settings
                </button>
              </div>
              <Terminal
                settings={termSettings}
                onPasteImage={() => void pasteImage()}
              />
            </>
          )}
        </div>
        <div className="sidebar">
          {appSettings.enableImageBridge ? (
            <ImageShelf
              items={shelf}
              enabled={connState === 'connected'}
              onRepaste={repaste}
              onRetry={retryFailed}
              onRemove={removeShelfItem}
              onCopyPath={copyPath}
              onClear={clearShelf}
              onPickFile={pickImageFile}
            />
          ) : (
            <div className="sidebar-disabled-note">
              Image shelf off
              <button type="button" className="btn ghost" onClick={() => openSettings('general')}>
                Settings
              </button>
            </div>
          )}
          {appSettings.enablePortForwards ? (
            <PortForwards forwards={portForwards} enabled={connState === 'connected'} />
          ) : null}
        </div>
      </div>

      {dragOver && <div className="drop-overlay">Drop image to upload</div>}
      <PastePromptDialog
        open={!!promptMode}
        title={promptMode?.kind === 'file' ? 'Upload image file' : 'Paste clipboard image'}
        initialPrompt={appSettings.defaultPastePrompt}
        onCancel={() => setPromptMode(null)}
        onConfirm={(p) => void runPasteWithPrompt(p)}
      />
      <SettingsCenter
        open={settingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={() => {
          setSettingsOpen(false)
          focusTerminal()
        }}
        termSettings={termSettings}
        onTermChange={updateTermSettings}
        appSettings={appSettings}
        onAppChange={updateAppSettings}
        appInfo={appInfo}
        updateStatus={updateStatus}
        onCheckUpdates={() => void checkForUpdates()}
        onInstallUpdate={() => void installUpdate()}
      />
      {updateStatus && <UpdateBanner status={updateStatus} onInstall={installUpdate} />}
      {status && <div className={`status-banner ${status.level}`}>{status.message}</div>}
      <CommandPalette open={paletteOpen} actions={actions} onClose={closePalette} />
    </div>
  )
}

interface TopBarProps {
  connState: ConnectionState
  connInfo: ConnInfo
  provider: ProviderId
  onProvider: (p: ProviderId) => void
  onDisconnect: () => void
  onOpenPalette: () => void
  onOpenSettings: () => void
  appInfo: AppInfo | null
}

function TopBar({
  connState,
  connInfo,
  provider,
  onProvider,
  onDisconnect,
  onOpenPalette,
  onOpenSettings,
  appInfo
}: TopBarProps) {
  const dotClass =
    connState === 'connected'
      ? 'live'
      : connState === 'reconnecting'
        ? 'reconnecting'
        : connState === 'connecting'
          ? 'connecting'
          : ''

  const isActive = connState === 'connected' || connState === 'connecting' || connState === 'reconnecting'
  const isBeta = appInfo?.releaseChannel === 'beta'
  const displayName = appInfo?.name ?? 'Portico'

  return (
    <header className="topbar">
      <div className="brand">
        <span className={`dot ${dotClass}`} />
        {displayName}
        {isBeta && <span className="beta-badge" title="Beta channel">Beta</span>}
        {appInfo?.version && (
          <span className="version-label" title="App version">v{appInfo.version}</span>
        )}
        {connState === 'reconnecting' && (
          <span className="reconnect-label">Reconnecting...</span>
        )}
      </div>
      {connInfo && (
        <span className="conn">
          {connInfo.user}@{connInfo.alias ?? connInfo.host}
        </span>
      )}
      <div className="spacer" />
      {isActive && (
        <div className="provider-pills" title="Target AI provider">
          {(['claude', 'codex', 'shell'] as ProviderId[]).map((p) => (
            <button key={p} className={provider === p ? 'active' : ''} onClick={() => onProvider(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      <button className="btn ghost" onClick={onOpenSettings} title="Settings  ·  ⌘,">
        Settings
      </button>
      <button className="btn ghost" onClick={onOpenPalette} title="Command palette  ·  ⌘⇧P">
        ⌘⇧P
      </button>
      {isActive && (
        <button className="btn danger" onClick={onDisconnect}>
          Disconnect
        </button>
      )}
    </header>
  )
}

interface UpdateBannerProps {
  status: UpdateStatus
  onInstall: () => void
}

/**
 * Non-blocking update status banner. Only the "downloaded" state is actionable;
 * the others surface progress so the user knows an update is in flight without
 * offering a premature install.
 */
function UpdateBanner({ status, onInstall }: UpdateBannerProps) {
  let message: string
  switch (status.state) {
    case 'checking':
      message = 'Checking for updates…'
      break
    case 'available':
      // With autoDownload=true this is a brief transitional state before
      // download-progress; avoid implying a stuck fake download.
      message = status.version
        ? `Update ${status.version} available — starting download…`
        : 'Update available — starting download…'
      break
    case 'downloading':
      message =
        status.percent != null
          ? `Downloading update… ${Math.round(status.percent)}%`
          : 'Downloading update…'
      break
    case 'downloaded':
      message = status.version
        ? `Update ${status.version} is ready.`
        : 'An update is ready.'
      break
    case 'not-available':
      // Surfaced transiently via the status banner instead; nothing sticky here.
      return null
    case 'error':
      message = status.message ?? 'Update failed.'
      break
    case 'idle':
    default:
      return null
  }

  const actionable = status.state === 'downloaded'

  return (
    <div className={`update-banner ${actionable ? 'actionable' : status.state === 'error' ? 'error' : ''}`}>
      <span>{message}</span>
      {actionable && (
        <span className="actions">
          <button className="btn primary" onClick={onInstall}>Restart now</button>
        </span>
      )}
    </div>
  )
}
