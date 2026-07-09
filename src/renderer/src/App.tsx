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
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const openPastePrompt = useCallback(() => {
    if (connState !== 'connected') return
    setPromptMode({ kind: 'clipboard' })
  }, [connState])

  const runPasteWithPrompt = useCallback(
    async (prompt: string) => {
      const mode = promptMode
      setPromptMode(null)
      if (!mode) return
      if (mode.kind === 'clipboard') {
        const r = await window.portico.pasteImage({ prompt })
        if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
      } else {
        const r = await window.portico.uploadLocalImage({ path: mode.path, prompt, inject: true })
        if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
      }
    },
    [promptMode, pushStatus]
  )

  const pasteImage = openPastePrompt

  const uploadClipboard = useCallback(async () => {
    const r = await window.portico.uploadClipboard()
    if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
    else pushStatus({ level: 'info', message: `Uploaded to ${r.value.remotePath}`, ttlMs: 4000 })
  }, [pushStatus])

  const pickImageFile = useCallback(async () => {
    if (connState !== 'connected') return
    const r = await window.portico.pickImageFile()
    if (!r.ok || !r.value) return
    setPromptMode({ kind: 'file', path: r.value })
  }, [connState])

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
      // Re-open the same source: file path when known, otherwise clipboard.
      if (item.sourcePath) {
        setPromptMode({ kind: 'file', path: item.sourcePath })
      } else {
        setPromptMode({ kind: 'clipboard' })
      }
    },
    []
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
      setPromptMode({ kind: 'file', path })
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [connState, pushStatus])

  const focusTerminal = useCallback(() => {
    document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }, [])

  const closePalette = useCallback(() => {
    setPaletteOpen(false)
    focusTerminal()
  }, [focusTerminal])

  const clearRemoteCache = useCallback(async () => {
    const r = await window.portico.clearRemoteCache()
    if (r.ok) pushStatus({ level: 'info', message: `Cleared ${r.value.deleted} blob(s).`, ttlMs: 4000 })
    else pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
  }, [pushStatus])

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

  // ---- global shortcuts: ⌘⇧P palette, ⌘⇧V paste image ----------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'v') {
        // Align with palette: only paste when fully connected (not reconnecting).
        if (connState === 'connected') {
          e.preventDefault()
          void pasteImage()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connState, pasteImage])

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
      updateStatus?.state
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
                <span className="kbd">⌘⇧V</span>
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  {connState === 'connected' ? 'paste image' : 'paste image (unavailable while reconnecting)'}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  Provider:{' '}
                  <strong style={{ textTransform: 'capitalize', color: 'var(--text)' }}>
                    {session?.provider ?? 'shell'}
                  </strong>
                  {session?.provider !== 'shell' ? ' · interactive REPL' : ''}
                </span>
              </div>
              <Terminal />
            </>
          )}
        </div>
        <div className="sidebar">
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
          <PortForwards forwards={portForwards} enabled={connState === 'connected'} />
        </div>
      </div>

      {dragOver && <div className="drop-overlay">Drop image to upload</div>}
      <PastePromptDialog
        open={!!promptMode}
        title={promptMode?.kind === 'file' ? 'Upload image file' : 'Paste clipboard image'}
        onCancel={() => setPromptMode(null)}
        onConfirm={(p) => void runPasteWithPrompt(p)}
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
  appInfo: AppInfo | null
}

function TopBar({ connState, connInfo, provider, onProvider, onDisconnect, onOpenPalette, appInfo }: TopBarProps) {
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
