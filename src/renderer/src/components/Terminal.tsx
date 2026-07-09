import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.js'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { TerminalSettings } from '../lib/terminal-settings.js'
import { xtermTheme } from '../lib/terminal-settings.js'
import { OutputBuffer } from '../lib/output-buffer.js'

interface Props {
  sessionId: string
  /** When false, terminal stays mounted but hidden (preserve scrollback). */
  active?: boolean
  settings: TerminalSettings
  /** Open the clipboard-image paste flow (parent owns the dialog). */
  onPasteImage?: () => void
}

type CtxMenu = { x: number; y: number } | null

/**
 * xterm.js wrapper for one connected SSH session (scoped by sessionId).
 *  - input/output + resize via window.portico
 *  - themes/fonts from settings
 *  - WebGL when enabled, search (⌘F), copy-on-select, context menu
 *  - Keep mounted when inactive so scrollback survives tab switches
 */
export function Terminal({ sessionId, active = true, settings, onPasteImage }: Props) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [ctx, setCtx] = useState<CtxMenu>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const copySelection = useCallback(async () => {
    const term = termRef.current
    if (!term?.hasSelection()) return
    const text = term.getSelection()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard permission */
    }
  }, [])

  const pasteText = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) window.portico.sendInput(sessionIdRef.current, text)
    } catch {
      /* denied */
    }
  }, [])

  // ---- mount terminal once (webgl preference applied at open) ------------
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const s = settingsRef.current
    const term = new XTerm({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      cursorBlink: true,
      scrollback: s.scrollback,
      allowProposedApi: true,
      theme: xtermTheme(s.themeId),
      macOptionIsMeta: false
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    fitRef.current = fit
    searchRef.current = search
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        // Open in system browser via temporary anchor (Electron will hand off).
        window.open(uri, '_blank', 'noopener,noreferrer')
      })
    )
    term.open(host)

    if (s.webgl) {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          try {
            webgl.dispose()
          } catch {
            /* ignore */
          }
          webglRef.current = null
        })
        term.loadAddon(webgl)
        webglRef.current = webgl
      } catch {
        webglRef.current = null
      }
    }

    try {
      fit.fit()
    } catch {
      /* layout pending */
    }
    termRef.current = term
    term.focus()

    // Shortcuts that must not reach the remote PTY.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      const meta = ev.metaKey || ev.ctrlKey
      if (!meta) return true

      const isV = ev.code === 'KeyV' || ev.key.toLowerCase() === 'v'
      const isC = ev.code === 'KeyC' || ev.key.toLowerCase() === 'c'
      const isF = ev.code === 'KeyF' || ev.key.toLowerCase() === 'f'

      // ⌘⇧V — paste image (main + App also handle this)
      if (ev.shiftKey && isV) return false

      // ⌘F — find in scrollback
      if (!ev.shiftKey && isF) {
        ev.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.focus())
        return false
      }

      // ⌘C — copy selection when present (else let terminal get Ctrl-C)
      if (!ev.shiftKey && isC && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        return false
      }

      return true
    })

    const inputDisp = term.onData((data) => window.portico.sendInput(sessionIdRef.current, data))

    // Coalesce bursty PTY output so large TUI redraws don't stall the UI thread.
    const outBuf = new OutputBuffer((data) => {
      try {
        term.write(data)
      } catch {
        /* xterm may be disposing */
      }
    })
    const offOutput = window.portico.onOutput((payload) => {
      if (payload.sessionId !== sessionIdRef.current) return
      outBuf.push(payload.data)
    })
    const onResize = term.onResize(({ cols, rows }) =>
      window.portico.resize(sessionIdRef.current, cols, rows)
    )

    const selDisp = term.onSelectionChange(() => {
      if (!settingsRef.current.copyOnSelect) return
      if (!term.hasSelection()) return
      const text = term.getSelection()
      if (text) void navigator.clipboard.writeText(text)
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    ro.observe(host)

    window.portico.resize(sessionIdRef.current, term.cols, term.rows)

    const onCtx = (e: MouseEvent) => {
      e.preventDefault()
      setCtx({ x: e.clientX, y: e.clientY })
    }
    host.addEventListener('contextmenu', onCtx)

    return () => {
      host.removeEventListener('contextmenu', onCtx)
      inputDisp.dispose()
      onResize.dispose()
      selDisp.dispose()
      offOutput()
      outBuf.dispose()
      ro.disconnect()
      try {
        webglRef.current?.dispose()
      } catch {
        /* ignore */
      }
      webglRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
    // Re-create when session identity or WebGL preference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, settings.webgl])

  // Focus + fit when becoming active.
  useEffect(() => {
    if (!active) return
    const term = termRef.current
    if (!term) return
    try {
      fitRef.current?.fit()
    } catch {
      /* ignore */
    }
    term.focus()
    window.portico.resize(sessionId, term.cols, term.rows)
  }, [active, sessionId])

  // ---- live-apply appearance when settings change without remount ---------
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = settings.fontFamily
    term.options.fontSize = settings.fontSize
    term.options.lineHeight = settings.lineHeight
    term.options.scrollback = settings.scrollback
    term.options.theme = xtermTheme(settings.themeId)
    try {
      fitRef.current?.fit()
    } catch {
      /* ignore */
    }
  }, [
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.scrollback,
    settings.themeId
  ])

  // Focus search field when opened.
  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchInputRef.current?.select())
  }, [searchOpen])

  const runSearch = (dir: 'next' | 'prev') => {
    const search = searchRef.current
    if (!search || !searchQuery) return
    if (dir === 'next') search.findNext(searchQuery)
    else search.findPrevious(searchQuery)
  }

  const closeCtx = () => setCtx(null)

  return (
    <div
      className={`term-host ${active ? 'active' : 'inactive'}`}
      style={active ? undefined : { display: 'none' }}
      aria-hidden={!active}
    >
      {searchOpen && active && (
        <div className="term-search-bar">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch(e.shiftKey ? 'prev' : 'next')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setSearchOpen(false)
                termRef.current?.focus()
              }
            }}
            placeholder={t('term.findPlaceholder')}
            spellCheck={false}
          />
          <button type="button" className="btn ghost" onClick={() => runSearch('prev')} title="Previous">
            ↑
          </button>
          <button type="button" className="btn ghost" onClick={() => runSearch('next')} title="Next">
            ↓
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setSearchOpen(false)
              termRef.current?.focus()
            }}
          >
            Esc
          </button>
        </div>
      )}
      <div ref={hostRef} className="xterm" />

      {ctx && (
        <>
          <div className="term-ctx-backdrop" onClick={closeCtx} onContextMenu={(e) => e.preventDefault()} />
          <div
            className="term-ctx-menu"
            style={{ left: ctx.x, top: ctx.y }}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              disabled={!termRef.current?.hasSelection()}
              onClick={() => {
                void copySelection()
                closeCtx()
              }}
            >
              {t('term.copy')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void pasteText()
                closeCtx()
              }}
            >
              {t('term.paste')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeCtx()
                onPasteImage?.()
              }}
            >
              {t('term.pasteImage')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeCtx()
                setSearchOpen(true)
              }}
            >
              {t('term.find')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
