import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import type {
  AppInfo,
  ConnectPhase,
  ConnectionState,
  PortForwardStatus,
  ProviderId,
  ProviderSession,
  SessionId,
  SessionSummary,
  ShelfItem,
  SshTarget,
  UpdateStatus
} from '@shared/types.js'
import type { ConnStatePayload, StatusPayload } from '@shared/ipc.js'
import { SessionConnectHub } from './components/SessionConnectHub.js'
import { Terminal } from './components/Terminal.js'
import { ImageShelf } from './components/ImageShelf.js'
import { PortForwards } from './components/PortForwards.js'
import { SessionRail } from './components/SessionRail.js'
import { GearIcon, PanelIcon } from './components/icons.js'
import { CommandPalette, type PaletteAction } from './components/CommandPalette.js'
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
  isToolSidebarVisible,
  toFeatureFlags,
  toTmuxPrefs,
  type AppSettings
} from './lib/app-settings.js'
import {
  applySessionOrder,
  loadSessionOrder,
  moveSessionId,
  saveSessionOrder
} from './lib/session-order.js'
import { I18nProvider, useI18n } from './i18n/index.js'

/** Merge main summaries into UI list, preserving drag order + unread flags. */
function mergeSessionList(
  prev: SessionSummary[],
  incoming: SessionSummary[]
): SessionSummary[] {
  const unreadMap = new Map(prev.map((s) => [s.id, s.unread]))
  const withUnread = incoming.map((s) => ({
    ...s,
    unread: unreadMap.get(s.id) ?? false
  }))
  const order = prev.length > 0 ? prev.map((s) => s.id) : loadSessionOrder()
  const ordered = applySessionOrder(withUnread, order)
  saveSessionOrder(ordered.map((s) => s.id))
  return ordered
}

type ConnInfo = { user: string; host: string; alias?: string } | null

interface SessionUi {
  connState: ConnectionState
  connectPhase: ConnectPhase | null
  connInfo: ConnInfo
  reconnectInfo: { attempt: number; nextRetryIn?: number } | null
  provider: ProviderSession | null
  shelf: ShelfItem[]
  portForwards: PortForwardStatus[]
  /** True once the session has been connected at least once (mount Terminal). */
  everLive: boolean
}

function emptyUi(partial?: Partial<SessionUi>): SessionUi {
  return {
    connState: 'disconnected',
    connectPhase: null,
    connInfo: null,
    reconnectInfo: null,
    provider: null,
    shelf: [],
    portForwards: [],
    everLive: false,
    ...partial
  }
}

/** Root: load locale preference then provide i18n to the tree. */
export function App() {
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings())
  return (
    <I18nProvider localePref={appSettings.locale}>
      <AppInner appSettings={appSettings} setAppSettings={setAppSettings} />
    </I18nProvider>
  )
}

function AppInner({
  appSettings,
  setAppSettings
}: {
  appSettings: AppSettings
  setAppSettings: Dispatch<SetStateAction<AppSettings>>
}) {
  const { t } = useI18n()
  const [sessionList, setSessionList] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<SessionId | null>(null)
  const [byId, setById] = useState<Record<SessionId, SessionUi>>({})
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [committing, setCommitting] = useState(false)
  /** Subtle pill flash when provider auto-detects (no floating toast). */
  const [providerFlash, setProviderFlash] = useState<ProviderId | null>(null)
  /** Bump to open terminal find on the active session. */
  const [findNonce, setFindNonce] = useState(0)
  const [termSettings, setTermSettings] = useState<TerminalSettings>(() => loadTerminalSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const providerFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Next provider change from user click — skip auto-detect flash. */
  const providerChangeFromUser = useRef(false)
  const activeRef = useRef<SessionId | null>(null)
  activeRef.current = activeSessionId

  const flashProviderPill = useCallback((p: ProviderId) => {
    setProviderFlash(p)
    if (providerFlashTimer.current) clearTimeout(providerFlashTimer.current)
    providerFlashTimer.current = setTimeout(() => {
      setProviderFlash(null)
      providerFlashTimer.current = null
    }, 2200)
  }, [])

  const activeUi = activeSessionId ? byId[activeSessionId] : undefined
  const connState = activeUi?.connState ?? 'disconnected'
  const connectPhase = activeUi?.connectPhase ?? null
  const connInfo = activeUi?.connInfo ?? null
  const reconnectInfo = activeUi?.reconnectInfo ?? null
  const session = activeUi?.provider ?? null
  const shelf = activeUi?.shelf ?? []
  const portForwards = activeUi?.portForwards ?? []

  const patchUi = useCallback((id: SessionId, patch: Partial<SessionUi> | ((prev: SessionUi) => SessionUi)) => {
    setById((prev) => {
      const cur = prev[id] ?? emptyUi()
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch }
      return { ...prev, [id]: next }
    })
  }, [])

  const markUnread = useCallback((id: SessionId) => {
    if (id === activeRef.current) return
    setSessionList((list) =>
      list.map((s) => (s.id === id && !s.unread ? { ...s, unread: true } : s))
    )
  }, [])

  const clearUnread = useCallback((id: SessionId) => {
    setSessionList((list) =>
      list.map((s) => (s.id === id && s.unread ? { ...s, unread: false } : s))
    )
  }, [])

  const selectSession = useCallback(
    (id: SessionId) => {
      setActiveSessionId(id)
      clearUnread(id)
      void window.portico.setActiveSessionId(id)
    },
    [clearUnread]
  )

  const updateTermSettings = useCallback((next: TerminalSettings) => {
    setTermSettings(next)
    saveTerminalSettings(next)
  }, [])

  const syncMainPrefs = useCallback(async (s: AppSettings) => {
    try {
      await window.portico.setFeatureFlags(toFeatureFlags(s))
      await window.portico.setTmuxPrefs(toTmuxPrefs(s))
      await window.portico.setRestoreOnLaunch(s.restoreSessionsOnLaunch)
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
    [syncMainPrefs, setAppSettings]
  )

  useEffect(() => {
    void syncMainPrefs(loadAppSettings())
  }, [syncMainPrefs])

  const openSettings = useCallback((section: SettingsSection = 'general') => {
    setSettingsSection(section)
    setSettingsOpen(true)
  }, [])

  const isActive =
    connState === 'connected' || connState === 'connecting' || connState === 'reconnecting'

  const toolSidebarOpen = isToolSidebarVisible(appSettings)

  const pushStatus = useCallback((s: StatusPayload) => {
    const ttl =
      s.ttlMs != null && s.ttlMs > 0
        ? s.ttlMs
        : s.level === 'info'
          ? 3500
          : s.level === 'warn'
            ? 6000
            : 0
    setStatus(s)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    if (ttl > 0) {
      statusTimer.current = setTimeout(() => setStatus(null), ttl)
    }
  }, [])

  const dismissStatus = useCallback(() => {
    if (statusTimer.current) clearTimeout(statusTimer.current)
    setStatus(null)
  }, [])

  const toggleToolSidebar = useCallback(() => {
    // If L2 panels are both off, open settings rather than a no-op toggle.
    if (!appSettings.enableImageBridge && !appSettings.enablePortForwards) {
      openSettings('general')
      pushStatus({
        level: 'info',
        message: t('sidebar.enableFeaturesFirst'),
        ttlMs: 4000
      })
      return
    }
    updateAppSettings({ ...appSettings, showToolSidebar: !appSettings.showToolSidebar })
  }, [appSettings, updateAppSettings, openSettings, pushStatus, t])

  useEffect(() => window.portico.onStatus(pushStatus), [pushStatus])

  useEffect(() => {
    window.portico
      .getAppInfo()
      .then((r) => {
        if (r.ok) setAppInfo(r.value)
      })
      .catch(() => {})
  }, [])

  useEffect(() => window.portico.onUpdateStatus(setUpdateStatus), [])

  // ---- bootstrap session list + restore SSH/tmux tabs --------------------
  useEffect(() => {
    void (async () => {
      const r = await window.portico.listSessions()
      if (!r.ok || r.value.length === 0) return
      const merged = mergeSessionList([], r.value.map((s) => ({ ...s, unread: false })))
      setSessionList(merged)
      const firstId = merged[0]?.id ?? null
      setActiveSessionId((cur) => cur ?? firstId)
      if (firstId) void window.portico.setActiveSessionId(firstId)
      setById((prev) => {
        const next = { ...prev }
        for (const s of r.value) {
          if (!next[s.id])
            next[s.id] = emptyUi({
              connState: s.state,
              provider: {
                provider: s.provider,
                interactive: true,
                nativePasteAvailable: false
              }
            })
        }
        return next
      })

      const settings = loadAppSettings()
      const hasRestorable = merged.some((s) => s.kind === 'local' || s.kind === 'ssh')

      // Restore saved SSH/tmux tabs (key/agent only). Main hydrates the list already.
      if (settings.restoreSessionsOnLaunch && hasRestorable) {
        await window.portico.setRestoreOnLaunch(true)
        await window.portico.restoreConnections()
        // Refresh UI after reconnects start
        const again = await window.portico.listSessions()
        if (again.ok) {
          setSessionList((prev) => mergeSessionList(prev, again.value))
          setById((prev) => {
            const next = { ...prev }
            for (const s of again.value) {
              if (!next[s.id]) next[s.id] = emptyUi({ connState: s.state })
              else next[s.id] = {
                ...next[s.id],
                connState: s.state,
                everLive: next[s.id].everLive || s.state === 'connected' || s.state === 'connecting'
              }
            }
            return next
          })
        }
        return
      }

      // Cold start: open local shell when preference is local and only a draft exists.
      const pref = settings.defaultSessionKind
      const draft = merged[0]
      if (
        pref === 'local' &&
        draft &&
        draft.state === 'disconnected' &&
        !draft.kind &&
        merged.length === 1
      ) {
        const lr = await window.portico.connectLocal(draft.id)
        if (lr.ok) {
          patchUi(draft.id, {
            connState: 'connected',
            everLive: true,
            connInfo: { user: '', host: 'localhost', alias: 'local' }
          })
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return window.portico.onSessionsChanged((sessions) => {
      setSessionList((prev) => mergeSessionList(prev, sessions))
      setById((prev) => {
        const next = { ...prev }
        for (const s of sessions) {
          if (!next[s.id]) next[s.id] = emptyUi({ connState: s.state })
        }
        // Drop closed sessions from local UI cache (keep everLive terminals cleaned)
        for (const id of Object.keys(next)) {
          if (!sessions.some((s) => s.id === id)) delete next[id]
        }
        return next
      })
      setActiveSessionId((cur) => {
        if (cur && sessions.some((s) => s.id === cur)) return cur
        // Prefer first in saved UI order, not main's default order.
        const ordered = applySessionOrder(sessions, loadSessionOrder())
        return ordered[0]?.id ?? null
      })
    })
  }, [])

  useEffect(() => {
    return window.portico.onSessionChanged((payload) => {
      const fromUser = providerChangeFromUser.current
      providerChangeFromUser.current = false
      setById((prev) => {
        const cur = prev[payload.sessionId] ?? emptyUi()
        const prevP = cur.provider?.provider
        const nextP = payload.session.provider
        // Auto-detect (or palette re-detect): flash the pill instead of a toast.
        if (
          !fromUser &&
          payload.sessionId === activeRef.current &&
          prevP != null &&
          prevP !== nextP
        ) {
          queueMicrotask(() => flashProviderPill(nextP))
        }
        return {
          ...prev,
          [payload.sessionId]: { ...cur, provider: payload.session }
        }
      })
    })
  }, [flashProviderPill])

  useEffect(() => {
    return window.portico.onConnectionState((payload: ConnStatePayload) => {
      const { sessionId } = payload
      patchUi(sessionId, (cur) => {
        const next = { ...cur, connState: payload.state }
        if (payload.state === 'connecting') {
          next.connectPhase = payload.phase ?? 'resolving'
        } else {
          next.connectPhase = null
        }
        if (payload.state === 'reconnecting') {
          next.reconnectInfo = {
            attempt: payload.attempt ?? 1,
            nextRetryIn: payload.nextRetryIn
          }
        } else {
          next.reconnectInfo = null
        }
        if (payload.state === 'connected' || payload.state === 'reconnecting' || payload.state === 'connecting') {
          next.everLive = true
          if (payload.user && payload.host) {
            next.connInfo = { user: payload.user, host: payload.host, alias: payload.alias }
          }
        }
        if (payload.state === 'disconnected') {
          next.connInfo = null
          next.provider = null
          next.portForwards = []
          // Local shell exit or clean disconnect: clear everLive so the
          // connect hub reappears. SSH drops go through reconnecting first,
          // so cur.connState will be 'reconnecting' — keep everLive for those.
          if (cur.connState === 'connected') {
            next.everLive = false
          }
        }
        return next
      })
      // Refresh list titles/state from main (keep drag order)
      void window.portico.listSessions().then((r) => {
        if (!r.ok) return
        setSessionList((prev) => mergeSessionList(prev, r.value))
      })
    })
  }, [patchUi])

  const reorderSessions = useCallback(
    (fromId: SessionId, toId: SessionId, position: 'before' | 'after') => {
      setSessionList((prev) => {
        const prevIds = prev.map((s) => s.id)
        const ids = moveSessionId(prevIds, fromId, toId, position)
        if (ids.length !== prevIds.length || ids.every((id, i) => id === prevIds[i])) {
          return prev
        }
        const map = new Map(prev.map((s) => [s.id, s]))
        const next = ids.map((id) => map.get(id)).filter((s): s is SessionSummary => !!s)
        if (next.length !== prev.length) return prev
        saveSessionOrder(next.map((s) => s.id))
        return next
      })
    },
    []
  )

  // Mark unread on background terminal output
  useEffect(() => {
    return window.portico.onOutput((payload) => {
      markUnread(payload.sessionId)
    })
  }, [markUnread])

  useEffect(() => {
    if (connState !== 'reconnecting' || !activeSessionId) return
    const t = setInterval(() => {
      patchUi(activeSessionId, (cur) => {
        if (!cur.reconnectInfo || cur.reconnectInfo.nextRetryIn == null) return cur
        if (cur.reconnectInfo.nextRetryIn <= 0) return cur
        return {
          ...cur,
          reconnectInfo: {
            ...cur.reconnectInfo,
            nextRetryIn: cur.reconnectInfo.nextRetryIn - 1
          }
        }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [connState, activeSessionId, patchUi])

  useEffect(() => {
    return window.portico.onPortForwardChanged((payload) => {
      patchUi(payload.sessionId, { portForwards: payload.forwards })
    })
  }, [patchUi])

  useEffect(() => {
    return window.portico.onShelfItemUpdated((payload) => {
      patchUi(payload.sessionId, (cur) => {
        const idx = cur.shelf.findIndex((i) => i.id === payload.item.id)
        if (idx === -1) return { ...cur, shelf: [payload.item, ...cur.shelf] }
        const shelfNext = [...cur.shelf]
        shelfNext[idx] = { ...shelfNext[idx], ...payload.item }
        return { ...cur, shelf: shelfNext }
      })
    })
  }, [patchUi])

  // ---- session actions ---------------------------------------------------
  const connect = useCallback(
    async (target: SshTarget): Promise<string | null> => {
      if (!activeSessionId) return 'No active session'
      const r = await window.portico.connect(activeSessionId, target)
      if (!r.ok) return r.error.message
      patchUi(activeSessionId, {
        connInfo: { user: target.user, host: target.host, alias: target.alias },
        everLive: true
      })
      const sl = await window.portico.shelfList(activeSessionId)
      if (sl.ok) patchUi(activeSessionId, { shelf: sl.value })
      const pr = await window.portico.getSession(activeSessionId)
      if (pr.ok) patchUi(activeSessionId, { provider: pr.value })
      return null
    },
    [activeSessionId, patchUi]
  )

  const connectLocal = useCallback(
    async (sessionId?: SessionId): Promise<string | null> => {
      const id = sessionId ?? activeSessionId
      if (!id) return 'No active session'
      const r = await window.portico.connectLocal(id)
      if (!r.ok) return r.error.message
      patchUi(id, {
        connInfo: { user: '', host: 'localhost', alias: 'local' },
        everLive: true,
        connState: 'connected'
      })
      const pr = await window.portico.getSession(id)
      if (pr.ok) patchUi(id, { provider: pr.value })
      return null
    },
    [activeSessionId, patchUi]
  )

  /** Always open a draft tab and show the Local / SSH chooser (never auto-connect). */
  const createSession = useCallback(async () => {
    const r = await window.portico.createSession()
    if (!r.ok) {
      pushStatus({ level: 'warn', message: r.error.message, ttlMs: 5000 })
      return
    }
    selectSession(r.value.id)
    // Do not auto-connectLocal here — user expects the connect hub so they can pick SSH.
  }, [pushStatus, selectSession])

  const closeSession = useCallback(
    async (id: SessionId) => {
      const r = await window.portico.closeSession(id)
      if (!r.ok) {
        pushStatus({ level: 'error', message: r.error.message, ttlMs: 5000 })
      }
    },
    [pushStatus]
  )

  const renameSession = useCallback(
    async (id: SessionId, title: string) => {
      const r = await window.portico.renameSession(id, title)
      if (!r.ok) pushStatus({ level: 'warn', message: r.error.message, ttlMs: 4000 })
    },
    [pushStatus]
  )

  const disconnect = useCallback(async () => {
    if (!activeSessionId) return
    const id = activeSessionId
    await window.portico.disconnect(id)
    setById((prev) => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], connInfo: null, connState: 'disconnected', provider: null, portForwards: [], everLive: false } }
    })
  }, [activeSessionId])

  const cancelReconnect = useCallback(async () => {
    if (!activeSessionId) return
    const id = activeSessionId
    await window.portico.cancelReconnect(id)
    setById((prev) => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], connInfo: null, connState: 'disconnected', provider: null, portForwards: [], reconnectInfo: null, everLive: false } }
    })
  }, [activeSessionId])

  const setProvider = useCallback(
    async (p: ProviderId) => {
      if (!activeSessionId) return
      providerChangeFromUser.current = true
      const r = await window.portico.setProvider(activeSessionId, p)
      if (r.ok) {
        patchUi(activeSessionId, { provider: r.value })
        setProviderFlash(null)
      } else {
        providerChangeFromUser.current = false
      }
    },
    [activeSessionId, patchUi]
  )

  /** After staging, ensure the tool sidebar (commit UI) is visible. */
  const ensureShelfVisible = useCallback(() => {
    if (!isToolSidebarVisible(appSettings)) {
      updateAppSettings({ ...appSettings, showToolSidebar: true })
    }
  }, [appSettings, updateAppSettings])

  const refreshShelf = useCallback(async () => {
    if (!activeSessionId) return
    const sl = await window.portico.shelfList(activeSessionId)
    if (sl.ok) patchUi(activeSessionId, { shelf: sl.value })
  }, [activeSessionId, patchUi])

  /** Stage clipboard image(s) only — no upload until commit. */
  const stageClipboard = useCallback(async () => {
    if (!appSettings.enableImageBridge) {
      pushStatus({ level: 'warn', message: t('status.imageBridgeOff'), ttlMs: 5000 })
      return
    }
    if (connState !== 'connected' || !activeSessionId) {
      pushStatus({ level: 'warn', message: t('status.connectFirst'), ttlMs: 4000 })
      return
    }
    try {
      const has = await window.portico.clipboardHasImage()
      if (has.ok && !has.value) {
        pushStatus({ level: 'warn', message: t('status.noClipboardImage'), ttlMs: 5000 })
        return
      }
    } catch {
      /* main will surface NO_IMAGE */
    }
    const r = await window.portico.pasteImage({ sessionId: activeSessionId })
    if (!r.ok) {
      pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
      return
    }
    await refreshShelf()
    ensureShelfVisible()
    const sl = await window.portico.shelfList(activeSessionId)
    const stagedTotal = sl.ok
      ? sl.value.filter((i) => i.status === 'staged').length
      : r.value.length
    pushStatus({
      level: 'info',
      message: t('status.staged', { n: r.value.length, total: stagedTotal }),
      ttlMs: 5000
    })
  }, [
    appSettings.enableImageBridge,
    connState,
    activeSessionId,
    pushStatus,
    t,
    refreshShelf,
    ensureShelfVisible
  ])

  const stageLocalFiles = useCallback(
    async (path: string | string[]) => {
      if (!activeSessionId) return
      if (!appSettings.enableImageBridge) {
        pushStatus({ level: 'warn', message: t('status.imageBridgeOff'), ttlMs: 5000 })
        return
      }
      if (connState !== 'connected') {
        pushStatus({ level: 'warn', message: t('status.connectFirst'), ttlMs: 4000 })
        return
      }
      const r = await window.portico.uploadLocalImage({
        sessionId: activeSessionId,
        path
      })
      if (!r.ok) {
        pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
        return
      }
      await refreshShelf()
      ensureShelfVisible()
      const sl = await window.portico.shelfList(activeSessionId)
      const stagedTotal = sl.ok ? sl.value.filter((i) => i.status === 'staged').length : r.value.length
      pushStatus({
        level: 'info',
        message: t('status.staged', { n: r.value.length, total: stagedTotal }),
        ttlMs: 5000
      })
    },
    [
      activeSessionId,
      appSettings.enableImageBridge,
      connState,
      pushStatus,
      t,
      refreshShelf,
      ensureShelfVisible
    ]
  )

  /** Upload all staged images, inject paths, submit Enter to Claude. */
  const commitStaged = useCallback(
    async (prompt: string) => {
      if (!activeSessionId) return
      setCommitting(true)
      try {
        // Main also resolves single/multi stock wording; pass through for custom text.
        const r = await window.portico.commitStaged({
          sessionId: activeSessionId,
          prompt,
          inject: true,
          submit: true
        })
        if (!r.ok) {
          pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
        } else {
          pushStatus({
            level: 'info',
            message: t('status.committed', { n: r.value.length }),
            ttlMs: 4000
          })
        }
        await refreshShelf()
      } finally {
        setCommitting(false)
      }
    },
    [activeSessionId, pushStatus, t, refreshShelf]
  )

  const pasteImage = stageClipboard
  const beginFileUpload = stageLocalFiles

  const uploadClipboard = useCallback(async () => {
    await stageClipboard()
  }, [stageClipboard])

  const pickImageFile = useCallback(async () => {
    if (connState !== 'connected') return
    const r = await window.portico.pickImageFile()
    if (!r.ok || !r.value || r.value.length === 0) return
    await stageLocalFiles(r.value.length === 1 ? r.value[0]! : r.value)
  }, [connState, stageLocalFiles])

  const repaste = useCallback(
    async (item: ShelfItem) => {
      if (!activeSessionId) return
      const r = await window.portico.pasteRemotePath(activeSessionId, item.remotePath, item.prompt)
      if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
    },
    [pushStatus, activeSessionId]
  )

  const retryFailed = useCallback(
    (item: ShelfItem) => {
      if (!activeSessionId) return
      void window.portico.shelfRemove(activeSessionId, item.id)
      patchUi(activeSessionId, (cur) => ({
        ...cur,
        shelf: cur.shelf.filter((i) => i.id !== item.id)
      }))
      if (item.sourcePath) void beginFileUpload(item.sourcePath)
      else void pasteImage()
    },
    [beginFileUpload, pasteImage, activeSessionId, patchUi]
  )

  const removeShelfItem = useCallback(
    async (item: ShelfItem) => {
      if (!activeSessionId) return
      await window.portico.shelfRemove(activeSessionId, item.id)
      patchUi(activeSessionId, (cur) => ({
        ...cur,
        shelf: cur.shelf.filter((i) => i.id !== item.id)
      }))
    },
    [activeSessionId, patchUi]
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
    if (!activeSessionId) return
    await window.portico.shelfClear(activeSessionId)
    patchUi(activeSessionId, { shelf: [] })
  }, [activeSessionId, patchUi])

  useEffect(() => {
    const isFileDrag = (e: DragEvent) =>
      [...(e.dataTransfer?.types ?? [])].includes('Files')

    const onDragOver = (e: DragEvent) => {
      // Ignore internal session-rail reorders (custom MIME, no Files).
      if (!isFileDrag(e)) return
      if (connState !== 'connected') return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      setDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      // dragleave bubbles; only clear when leaving the window.
      if (e.relatedTarget != null) return
      setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      setDragOver(false)
      if (!isFileDrag(e)) return
      if (connState !== 'connected') return
      e.preventDefault()
      const files = [...(e.dataTransfer?.files ?? [])]
      const imageFiles = files.filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0) {
        pushStatus({ level: 'warn', message: t('drop.warnImage'), ttlMs: 3000 })
        return
      }
      const paths = imageFiles
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => !!p)
      if (paths.length === 0) {
        pushStatus({ level: 'error', message: t('drop.pathError'), ttlMs: 4000 })
        return
      }
      void beginFileUpload(paths.length === 1 ? paths[0]! : paths)
    }
    // Block browser default for non-file drags so we don't flash "copy" UI.
    const onDragStart = (e: DragEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.session-rail-grip')) return
      // Allow native file drops only; kill text/selection drags.
      if (e.dataTransfer?.types?.includes('Files')) return
      e.preventDefault()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragstart', onDragStart, true)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragstart', onDragStart, true)
    }
  }, [connState, pushStatus, beginFileUpload, t])

  const focusTerminal = useCallback(() => {
    document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }, [])

  const closePalette = useCallback(() => {
    setPaletteOpen(false)
    focusTerminal()
  }, [focusTerminal])

  const clearRemoteCache = useCallback(async () => {
    if (!activeSessionId) return
    if (appSettings.confirmClearCache) {
      const ok = window.confirm(t('status.clearCacheConfirm'))
      if (!ok) return
    }
    const r = await window.portico.clearRemoteCache(activeSessionId)
    if (r.ok) pushStatus({ level: 'info', message: `Cleared ${r.value.deleted} blob(s).`, ttlMs: 4000 })
    else pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
  }, [pushStatus, appSettings.confirmClearCache, t, activeSessionId])

  const checkForUpdates = useCallback(async () => {
    const r = await window.portico.checkForUpdates()
    if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
    else if (r.value.state === 'not-available') {
      pushStatus({
        level: 'info',
        message: r.value.message ?? 'You are on the latest version.',
        ttlMs: 4000
      })
    }
  }, [pushStatus])

  const installUpdate = useCallback(async () => {
    const r = await window.portico.installUpdate()
    if (!r.ok) pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
  }, [pushStatus])

  const switchSessionByOffset = useCallback(
    (delta: number) => {
      if (sessionList.length === 0) return
      const idx = sessionList.findIndex((s) => s.id === activeSessionId)
      const base = idx < 0 ? 0 : idx
      const next = sessionList[(base + delta + sessionList.length) % sessionList.length]
      if (next) selectSession(next.id)
    },
    [sessionList, activeSessionId, selectSession]
  )

  // Shortcuts: ⌘, settings · ⌘⇧P palette · ⌘⇧V paste · ⌘\ tool sidebar · ⌘⇧[ / ] session
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const isP = e.code === 'KeyP' || e.key.toLowerCase() === 'p'
      const isV = e.code === 'KeyV' || e.key.toLowerCase() === 'v'
      const isComma = e.code === 'Comma' || e.key === ','
      const isBracketLeft = e.code === 'BracketLeft' || e.key === '['
      const isBracketRight = e.code === 'BracketRight' || e.key === ']'
      const isBackslash = e.code === 'Backslash' || e.key === '\\'

      if (!e.shiftKey && isComma) {
        e.preventDefault()
        openSettings(settingsOpen ? settingsSection : 'general')
        return
      }
      if (!e.shiftKey && isBackslash) {
        e.preventDefault()
        toggleToolSidebar()
        return
      }
      if (e.shiftKey && isP) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (e.shiftKey && isV) {
        e.preventDefault()
        void pasteImage()
      } else if (e.shiftKey && isBracketLeft) {
        e.preventDefault()
        switchSessionByOffset(-1)
      } else if (e.shiftKey && isBracketRight) {
        e.preventDefault()
        switchSessionByOffset(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    pasteImage,
    openSettings,
    settingsOpen,
    settingsSection,
    switchSessionByOffset,
    toggleToolSidebar
  ])

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

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'new-session',
        title: t('palette.newSession'),
        hint: t('palette.newSessionHint'),
        enabled: true,
        run: () => void createSession()
      },
      {
        id: 'toggle-tool-sidebar',
        title: toolSidebarOpen ? t('palette.hideToolSidebar') : t('palette.showToolSidebar'),
        hint: t('palette.toggleToolSidebarHint'),
        enabled: true,
        run: toggleToolSidebar
      },
      {
        id: 'paste-image',
        title: t('palette.pasteImage'),
        hint: t('palette.pasteImageHint'),
        enabled: connState === 'connected',
        run: pasteImage
      },
      {
        id: 'upload-clipboard',
        title: t('palette.uploadClipboard'),
        hint: t('palette.uploadClipboardHint'),
        enabled: connState === 'connected',
        run: uploadClipboard
      },
      {
        id: 'upload-file',
        title: t('palette.uploadFile'),
        hint: t('palette.uploadFileHint'),
        enabled: connState === 'connected',
        run: pickImageFile
      },
      {
        id: 'commit-staged',
        title: t('palette.commitStaged'),
        hint: t('palette.commitStagedHint'),
        enabled:
          connState === 'connected' &&
          !!activeSessionId &&
          shelf.some((i) => i.status === 'staged') &&
          !committing,
        run: () => void commitStaged(appSettings.defaultPastePrompt)
      },
      {
        id: 'detect-provider',
        title: t('palette.detectProvider'),
        hint: t('palette.detectProviderHint'),
        enabled: connState === 'connected' && !!activeSessionId,
        run: async () => {
          if (!activeSessionId) return
          // Treat as auto path so the pill flashes (not a floating toast).
          providerChangeFromUser.current = false
          const r = await window.portico.detectProvider(activeSessionId)
          if (!r.ok) {
            pushStatus({ level: 'error', message: r.error.message, ttlMs: 6000 })
            return
          }
          flashProviderPill(r.value)
        }
      },
      {
        id: 'clear-remote-cache',
        title: t('palette.clearCache'),
        hint: t('palette.clearCacheHint'),
        enabled: connState === 'connected',
        run: clearRemoteCache
      },
      {
        id: 'settings',
        title: t('palette.settings'),
        hint: t('palette.settingsHint'),
        enabled: true,
        run: () => openSettings('general')
      },
      {
        id: 'terminal-settings',
        title: t('palette.terminalSettings'),
        hint: t('palette.terminalSettingsHint'),
        enabled: true,
        run: () => openSettings('terminal')
      },
      {
        id: 'tmux-settings',
        title: t('palette.tmuxSettings'),
        hint: t('palette.tmuxSettingsHint'),
        enabled: true,
        run: () => openSettings('tmux')
      },
      {
        id: 'tmux-enter',
        title: t('palette.tmuxEnter'),
        hint: t('palette.tmuxEnterHint', { name: appSettings.tmuxSessionName }),
        enabled: connState === 'connected' && !!activeSessionId,
        run: async () => {
          if (!activeSessionId) return
          const r = await window.portico.enterTmux({
            sessionId: activeSessionId,
            mode: 'always',
            sessionName: appSettings.tmuxSessionName
          })
          if (!r.ok) pushStatus({ level: 'warn', message: r.error.message, ttlMs: 5000 })
        }
      },
      {
        id: 'tmux-list',
        title: t('palette.tmuxList'),
        hint: t('palette.tmuxListHint'),
        enabled: connState === 'connected' && !!activeSessionId,
        run: async () => {
          if (!activeSessionId) return
          const r = await window.portico.listTmuxSessions(activeSessionId)
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
        title: t('palette.tmuxNew'),
        hint: t('palette.tmuxNewHint', { name: appSettings.tmuxSessionName }),
        enabled: connState === 'connected' && !!activeSessionId,
        run: async () => {
          if (!activeSessionId) return
          const r = await window.portico.enterTmux({
            sessionId: activeSessionId,
            createNew: appSettings.tmuxSessionName
          })
          if (!r.ok) pushStatus({ level: 'warn', message: r.error.message, ttlMs: 5000 })
        }
      },
      {
        id: 'check-for-updates',
        title: t('palette.checkUpdates'),
        hint: t('palette.checkUpdatesHint'),
        enabled: updateStatus?.state !== 'checking' && updateStatus?.state !== 'downloading',
        run: checkForUpdates
      },
      {
        id: 'install-update',
        title: t('palette.installUpdate'),
        hint: t('palette.installUpdateHint'),
        enabled: updateStatus?.state === 'downloaded',
        run: installUpdate
      },
      {
        id: 'disconnect',
        title: t('palette.disconnect'),
        enabled: isActive,
        run: disconnect
      },
      ...sessionList.map((s) => ({
        id: `switch-${s.id}`,
        title: t('palette.switchSession', { title: s.title }),
        hint: s.state,
        enabled: s.id !== activeSessionId,
        run: () => selectSession(s.id)
      }))
    ],
    [
      connState,
      isActive,
      pasteImage,
      uploadClipboard,
      pickImageFile,
      commitStaged,
      committing,
      shelf,
      flashProviderPill,
      clearRemoteCache,
      checkForUpdates,
      installUpdate,
      disconnect,
      pushStatus,
      updateStatus?.state,
      openSettings,
      appSettings.tmuxSessionName,
      appSettings.defaultPastePrompt,
      t,
      activeSessionId,
      createSession,
      sessionList,
      selectSession,
      toolSidebarOpen,
      toggleToolSidebar
    ]
  )

  // Sessions that need a kept-alive Terminal instance
  const liveSessionIds = useMemo(
    () =>
      sessionList
        .filter((s) => {
          const ui = byId[s.id]
          if (!ui) return false
          return (
            ui.everLive ||
            ui.connState === 'connected' ||
            ui.connState === 'reconnecting' ||
            ui.connState === 'connecting'
          )
        })
        .map((s) => s.id),
    [sessionList, byId]
  )

  const showForm =
    !activeSessionId ||
    !activeUi ||
    activeUi.connState === 'disconnected' ||
    (activeUi.connState === 'connecting' && !activeUi.everLive)

  return (
    <div className={`app ${dragOver ? 'drag-over' : ''}`}>
      <TopBar
        connState={connState}
        connInfo={connInfo}
        provider={session?.provider ?? 'shell'}
        providerFlash={providerFlash}
        onProvider={setProvider}
        onDisconnect={disconnect}
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleToolSidebar={toggleToolSidebar}
        toolSidebarOpen={toolSidebarOpen}
        appInfo={appInfo}
      />
      <div className={`workspace ${toolSidebarOpen ? '' : 'tool-sidebar-collapsed'}`.trim()}>
        <SessionRail
          sessions={sessionList}
          activeId={activeSessionId}
          onSelect={selectSession}
          onCreate={() => void createSession()}
          onClose={(id) => void closeSession(id)}
          onRename={(id, title) => void renameSession(id, title)}
          onReorder={reorderSessions}
          onOpenSettings={() => openSettings('general')}
        />
        <div className="terminal-pane">
          {/* Form for draft / connecting first time — keep Terminals mounted underneath. */}
          {showForm && (
            <SessionConnectHub
              onConnectSsh={connect}
              onConnectLocal={() => connectLocal()}
              phase={connectPhase}
              preferSsh={appSettings.defaultSessionKind === 'ssh'}
            />
          )}
          {!showForm && connState === 'reconnecting' && reconnectInfo && (
            <div className="reconnect-banner">
              <span>
                {t('reconnect.banner', { attempt: reconnectInfo.attempt })}
                {reconnectInfo.nextRetryIn != null && `... ${reconnectInfo.nextRetryIn}s`}
                {' · '}
                {t('reconnect.pasteDisabled')}
              </span>
              <button className="btn ghost" onClick={cancelReconnect}>
                {t('reconnect.cancel')}
              </button>
            </div>
          )}
          {!showForm && (
            <div className="term-toolbar">
              {appSettings.enableImageBridge && (
                <>
                  <button
                    type="button"
                    className="btn ghost term-toolbar-btn"
                    disabled={connState !== 'connected'}
                    onClick={() => void pasteImage()}
                    title={t('palette.pasteImageHint')}
                  >
                    <span className="kbd">⌘⇧V</span> {t('toolbar.pasteImage')}
                  </button>
                  <button
                    type="button"
                    className="btn ghost term-toolbar-btn"
                    disabled={connState !== 'connected'}
                    onClick={() => void pickImageFile()}
                    title={t('palette.uploadFileHint')}
                  >
                    {t('toolbar.file')}
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn ghost term-toolbar-btn"
                onClick={() => setFindNonce((n) => n + 1)}
                title={t('toolbar.findHint')}
              >
                <span className="kbd">⌘F</span> {t('toolbar.find')}
              </button>
              <span className="term-toolbar-spacer" />
              {appSettings.enableImageBridge &&
                connState === 'connected' &&
                shelf.filter((i) => i.status === 'staged').length > 0 && (
                  <button
                    type="button"
                    className="btn ghost term-toolbar-btn term-toolbar-staged"
                    onClick={() => {
                      if (!isToolSidebarVisible(appSettings)) {
                        updateAppSettings({ ...appSettings, showToolSidebar: true })
                      }
                    }}
                    title={t('toolbar.stagedHint')}
                  >
                    {t('toolbar.stagedCount', {
                      n: shelf.filter((i) => i.status === 'staged').length
                    })}
                  </button>
                )}
              <button
                type="button"
                className="btn ghost icon-btn term-toolbar-btn"
                onClick={() => openSettings('terminal')}
                title={t('palette.terminalSettingsHint')}
                aria-label={t('palette.terminalSettings')}
              >
                <GearIcon size={14} />
              </button>
            </div>
          )}
          {/* Always keep live terminals mounted so switching to a draft doesn't drop scrollback. */}
          <div className="term-stack" style={showForm ? { display: 'none' } : undefined}>
            {liveSessionIds.map((id) => (
              <Terminal
                key={id}
                sessionId={id}
                active={!showForm && id === activeSessionId}
                connState={byId[id]?.connState ?? 'disconnected'}
                settings={termSettings}
                onPasteImage={() => void pasteImage()}
                findNonce={!showForm && id === activeSessionId ? findNonce : 0}
              />
            ))}
          </div>
        </div>
        {toolSidebarOpen && (
          <div className="sidebar">
            {appSettings.enableImageBridge ? (
              <ImageShelf
                items={shelf}
                defaultPrompt={appSettings.defaultPastePrompt}
                enabled={connState === 'connected'}
                committing={committing}
                onRepaste={repaste}
                onRetry={retryFailed}
                onRemove={removeShelfItem}
                onCopyPath={copyPath}
                onClear={clearShelf}
                onPickFile={pickImageFile}
                onCommitStaged={(p) => void commitStaged(p)}
              />
            ) : null}
            {appSettings.enablePortForwards && activeSessionId ? (
              <PortForwards
                sessionId={activeSessionId}
                forwards={portForwards}
                enabled={connState === 'connected'}
              />
            ) : null}
          </div>
        )}
      </div>

      {dragOver && <div className="drop-overlay">{t('drop.overlay')}</div>}
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
      {status && (
        <div
          className={`status-banner ${status.level}`}
          role="status"
          onClick={dismissStatus}
          title={t('status.dismissHint')}
        >
          <span className="status-banner-text">{status.message}</span>
          <button
            type="button"
            className="status-banner-close"
            aria-label={t('common.cancel')}
            onClick={(e) => {
              e.stopPropagation()
              dismissStatus()
            }}
          >
            ×
          </button>
        </div>
      )}
      <CommandPalette open={paletteOpen} actions={actions} onClose={closePalette} />
    </div>
  )
}

interface TopBarProps {
  connState: ConnectionState
  connInfo: ConnInfo
  provider: ProviderId
  /** When set, that pill shows a brief auto-detect flash. */
  providerFlash: ProviderId | null
  onProvider: (p: ProviderId) => void
  onDisconnect: () => void
  onOpenPalette: () => void
  onToggleToolSidebar: () => void
  toolSidebarOpen: boolean
  appInfo: AppInfo | null
}

function TopBar({
  connState,
  connInfo,
  provider,
  providerFlash,
  onProvider,
  onDisconnect,
  onOpenPalette,
  onToggleToolSidebar,
  toolSidebarOpen,
  appInfo
}: TopBarProps) {
  const { t } = useI18n()
  const dotClass =
    connState === 'connected'
      ? 'live'
      : connState === 'reconnecting'
        ? 'reconnecting'
        : connState === 'connecting'
          ? 'connecting'
          : ''

  const isActive =
    connState === 'connected' || connState === 'connecting' || connState === 'reconnecting'
  const isBeta = appInfo?.releaseChannel === 'beta'
  // Brand is always "Portico"; channel is shown only via the beta badge
  // (avoids "Portico Beta" + yellow Beta being redundant).
  const displayName = 'Portico'

  return (
    <header className="topbar">
      <div className="brand">
        <span className={`dot ${dotClass}`} />
        <span className="brand-name">{displayName}</span>
        {isBeta && (
          <span className="beta-badge" title={appInfo?.name ?? 'Portico Beta'}>
            Beta
          </span>
        )}
        {appInfo?.version && (
          <span className="version-label" title="version">
            v{appInfo.version}
          </span>
        )}
        {connState === 'reconnecting' && (
          <span className="reconnect-label">{t('topbar.reconnecting')}</span>
        )}
      </div>
      {connInfo && (
        <span className="conn" title={
          !connInfo.user || connInfo.host === 'localhost'
            ? connInfo.alias ?? 'local'
            : `${connInfo.user}@${connInfo.alias ?? connInfo.host}`
        }>
          {!connInfo.user || connInfo.host === 'localhost'
            ? connInfo.alias ?? 'local'
            : `${connInfo.user}@${connInfo.alias ?? connInfo.host}`}
        </span>
      )}
      <div className="spacer" />
      <div className="actions">
        {isActive && (
          <div
            className="provider-pills"
            title={
              providerFlash
                ? t('toolbar.providerAutoDetected', { name: providerFlash })
                : t('toolbar.provider')
            }
          >
            {(['claude', 'codex', 'shell'] as ProviderId[]).map((p) => (
              <button
                key={p}
                type="button"
                className={[
                  provider === p ? 'active' : '',
                  providerFlash === p ? 'just-detected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onProvider(p)}
              >
                {p}
                {providerFlash === p ? (
                  <span className="provider-auto-badge" aria-hidden>
                    {t('toolbar.providerAutoBadge')}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={`btn ghost icon-btn ${toolSidebarOpen ? 'active-toggle' : ''}`}
          onClick={onToggleToolSidebar}
          title={t('topbar.toggleToolSidebar')}
          aria-label={toolSidebarOpen ? t('topbar.hideSidebar') : t('topbar.showSidebar')}
          aria-pressed={toolSidebarOpen}
        >
          <PanelIcon open={toolSidebarOpen} />
        </button>
        <button
          type="button"
          className="btn ghost icon-btn"
          onClick={onOpenPalette}
          title={t('topbar.commandPalette')}
          aria-label={t('topbar.commandPalette')}
        >
          <span className="topbar-kbd">⌘⇧P</span>
        </button>
        {isActive && (
          <button type="button" className="btn ghost danger" onClick={onDisconnect}>
            {t('common.disconnect')}
          </button>
        )}
      </div>
    </header>
  )
}

interface UpdateBannerProps {
  status: UpdateStatus
  onInstall: () => void
}

function UpdateBanner({ status, onInstall }: UpdateBannerProps) {
  let message: string
  switch (status.state) {
    case 'checking':
      message = 'Checking for updates…'
      break
    case 'available':
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
      message = status.version ? `Update ${status.version} is ready.` : 'An update is ready.'
      break
    case 'not-available':
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
    <div
      className={`update-banner ${actionable ? 'actionable' : status.state === 'error' ? 'error' : ''}`}
    >
      <span>{message}</span>
      {actionable && (
        <span className="actions">
          <button className="btn primary" onClick={onInstall}>
            Restart now
          </button>
        </span>
      )}
    </div>
  )
}
