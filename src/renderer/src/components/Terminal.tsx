import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

/**
 * xterm.js wrapper. One instance per connected session.
 *  - pipes renderer input -> window.portico.sendInput
 *  - pipes window.portico.onOutput -> terminal.write
 *  - keeps the server's PTY cols/rows in sync via fit + resize
 */
export function Terminal() {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new XTerm({
      fontFamily:
        "ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    try {
      fit.fit()
    } catch {
      /* container may not be laid out yet */
    }
    termRef.current = term
    term.focus()

    // Input -> main process
    const inputDisp = term.onData((data) => window.portico.sendInput(data))

    // Output -> terminal
    const off = window.portico.onOutput((data) => term.write(data))

    // Resize sync: report the fitted geometry to the server PTY.
    const onResize = term.onResize(({ cols, rows }) => window.portico.resize(cols, rows))
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    ro.observe(host)

    // Send the initial size once, after mount.
    window.portico.resize(term.cols, term.rows)

    return () => {
      inputDisp.dispose()
      onResize.dispose()
      off()
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [])

  return (
    <div className="term-host">
      <div ref={hostRef} className="xterm" />
    </div>
  )
}
