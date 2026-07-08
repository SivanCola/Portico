import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionState, PortForwardStatus, ProviderId, ProviderSession, ShelfItem, SshTarget } from '@shared/types.js'
import type { ConnStatePayload, StatusPayload } from '@shared/ipc.js'
import { ConnectionForm } from './components/ConnectionForm.js'
import { Terminal } from './components/Terminal.js'
import { ImageShelf } from './components/ImageShelf.js'
import { PortForwards } from './components/PortForwards.js'
import { CommandPalette, type PaletteAction } from './components/CommandPalette.js'

type ConnInfo = { user: string; host: string } | null

export function App() {
  const [connState, setConnState] = useState<ConnectionState>('disconnected')
  const [connInfo, setConnInfo] = useState<ConnInfo>(null)
  const [reconnectInfo, setReconnectInfo] = useState<{ attempt: number; nextRetryIn?: number } | null>(null)
  const [session, setSession] = useState<ProviderSession | null>(null)
  const [shelf, setShelf] = useState<ShelfItem[]>([])
  const [portForwards, setPortForwards] = useState<PortForwardStatus[]>([])
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
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
        if (r.value.user && r.value.host) setConnInfo({ user: r.value.user, host: r.value.host })
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
      setConnInfo({ user: t.user, host: t.host })
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
  const pasteImage = useCallback(async () => {
    const r = await window.portico.pasteImage({})
    if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
  }, [pushStatus])

  const uploadClipboard = useCallback(async () => {
    const r = await window.portico.uploadClipboard()
    if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
    else pushStatus({ level: 'info', message: `Uploaded to ${r.value.remotePath}`, ttlMs: 4000 })
  }, [pushStatus])

  const repaste = useCallback(
    async (item: ShelfItem) => {
      const r = await window.portico.pasteRemotePath(item.remotePath, item.prompt)
      if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
    },
    [pushStatus]
  )

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

  // ---- global shortcuts: ⌘⇧P palette, ⌘⇧V paste image ----------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'v') {
        if (isActive) {
          e.preventDefault()
          void pasteImage()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, pasteImage])

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
        id: 'detect-provider',
        title: 'Re-detect AI provider',
        hint: 'Heuristically detect Claude / Codex / shell',
        enabled: connState === 'connected',
        run: async () => {
          const r = await window.portico.detectProvider()
          if (r.ok) pushStatus({ level: 'info', message: `Detected: ${r.value}`, ttlMs: 3000 })
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
        id: 'disconnect',
        title: 'Disconnect',
        enabled: isActive,
        run: disconnect
      }
    ],
    [connState, isActive, pasteImage, uploadClipboard, clearRemoteCache, disconnect, pushStatus]
  )

  return (
    <div className="app">
      <TopBar
        connState={connState}
        connInfo={connInfo}
        provider={session?.provider ?? 'shell'}
        onProvider={setProvider}
        onDisconnect={disconnect}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className="workspace">
        <div className="terminal-pane">
          {connState === 'disconnected' || connState === 'connecting' ? (
            <ConnectionForm onConnect={connect} />
          ) : (
            <>
              {connState === 'reconnecting' && reconnectInfo && (
                <div className="reconnect-banner">
                  <span>
                    Connection lost. Reconnecting (attempt {reconnectInfo.attempt}/10)
                    {reconnectInfo.nextRetryIn != null && `... next retry in ${reconnectInfo.nextRetryIn}s`}
                  </span>
                  <button className="btn ghost" onClick={cancelReconnect}>Cancel</button>
                </div>
              )}
              <div className="term-toolbar">
                <span className="kbd">⌘⇧V</span>
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>paste image</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  Provider:{' '}
                  <strong style={{ textTransform: 'capitalize', color: 'var(--text)' }}>
                    {session?.provider ?? 'shell'}
                  </strong>
                  {session?.interactive ? ' · interactive' : ' · command'}
                </span>
              </div>
              <Terminal />
            </>
          )}
        </div>
        <div className="sidebar">
          <ImageShelf items={shelf} onRepaste={repaste} onCopyPath={copyPath} onClear={clearShelf} />
          <PortForwards forwards={portForwards} enabled={connState === 'connected'} />
        </div>
      </div>

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
}

function TopBar({ connState, connInfo, provider, onProvider, onDisconnect, onOpenPalette }: TopBarProps) {
  const dotClass =
    connState === 'connected'
      ? 'live'
      : connState === 'reconnecting'
        ? 'reconnecting'
        : connState === 'connecting'
          ? 'connecting'
          : ''

  const isActive = connState === 'connected' || connState === 'connecting' || connState === 'reconnecting'

  return (
    <header className="topbar">
      <div className="brand">
        <span className={`dot ${dotClass}`} />
        Portico
        {connState === 'reconnecting' && (
          <span className="reconnect-label">Reconnecting...</span>
        )}
      </div>
      {connInfo && (
        <span className="conn">
          {connInfo.user}@{connInfo.host}
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
