/**
 * tmux CLI helpers (pure).
 *
 * Portico does not speak the tmux control protocol — it shells out via SSH
 * exec / PTY inject. Keep commands conservative for wide version coverage.
 */

/** How Portico should interact with remote tmux after SSH is up. */
export type TmuxEnterMode = 'off' | 'attach-if-exists' | 'always'

export interface TmuxPrefs {
  mode: TmuxEnterMode
  /** Session name for auto-enter (sanitized). Default `portico`. */
  sessionName: string
  /**
   * Sync remote copy → Mac clipboard:
   * - accept OSC 52 from the PTY into Electron clipboard
   * - on connect, best-effort `tmux set-option -g set-clipboard on`
   */
  syncRemoteClipboard: boolean
}

export interface TmuxSessionInfo {
  name: string
  windows: number
  /** True when at least one client is attached. */
  attached: boolean
}

export const DEFAULT_TMUX_PREFS: TmuxPrefs = {
  mode: 'off',
  sessionName: 'portico',
  syncRemoteClipboard: true
}

/** Allow only safe session name characters (tmux is picky with specials). */
export function sanitizeSessionName(raw: string): string {
  const s = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s.slice(0, 64) || 'portico'
}

export function normalizeTmuxPrefs(partial: Partial<TmuxPrefs> = {}): TmuxPrefs {
  const mode =
    partial.mode === 'always' || partial.mode === 'attach-if-exists' || partial.mode === 'off'
      ? partial.mode
      : DEFAULT_TMUX_PREFS.mode
  return {
    mode,
    sessionName: sanitizeSessionName(partial.sessionName ?? DEFAULT_TMUX_PREFS.sessionName),
    syncRemoteClipboard:
      partial.syncRemoteClipboard ?? DEFAULT_TMUX_PREFS.syncRemoteClipboard
  }
}

/**
 * Parse `tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}'`.
 */
export function parseListSessions(stdout: string): TmuxSessionInfo[] {
  const out: TmuxSessionInfo[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    // Prefer tab-separated; fall back to colon-heavy legacy formats.
    const parts = t.includes('\t') ? t.split('\t') : t.split(':')
    const name = (parts[0] ?? '').trim()
    if (!name) continue
    const windows = Number(parts[1]) || 1
    const attachedRaw = (parts[2] ?? '0').trim()
    const attached = attachedRaw === '1' || /^attached/i.test(attachedRaw)
    out.push({ name, windows, attached })
  }
  return out
}

/** Single-quote for embedding in a remote shell one-liner. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Probe whether `tmux` exists on PATH (exit via echo). */
export function buildHasTmuxCommand(): string {
  return 'command -v tmux >/dev/null 2>&1 && echo yes || echo no'
}

/** Probe whether the current shell is already inside tmux. */
export function buildInTmuxCommand(): string {
  return '[ -n "${TMUX-}" ] && echo yes || echo no'
}

/**
 * Build the interactive PTY one-liner that attaches or creates a session.
 * Returns null when mode is `off`.
 */
export function buildEnterShellCommand(prefs: Partial<TmuxPrefs>): string | null {
  const p = normalizeTmuxPrefs(prefs)
  if (p.mode === 'off') return null
  const name = shQuote(p.sessionName)

  // Guard: skip if already nested or tmux missing.
  // attach-if-exists: only attach when session exists.
  // always: attach or create.
  if (p.mode === 'attach-if-exists') {
    return (
      `command -v tmux >/dev/null 2>&1 && [ -z "\${TMUX-}" ] && ` +
      `tmux has-session -t ${name} 2>/dev/null && tmux attach -t ${name}`
    )
  }
  // always
  return (
    `command -v tmux >/dev/null 2>&1 && [ -z "\${TMUX-}" ] && ` +
    `{ tmux has-session -t ${name} 2>/dev/null && tmux attach -t ${name} || tmux new -s ${name}; }`
  )
}

/** list-sessions with a stable format string. */
export function buildListSessionsCommand(): string {
  return "tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}' 2>/dev/null"
}

/**
 * Best-effort enable OSC 52 clipboard in the remote tmux server (no conf edit).
 * Safe to run when tmux is missing — the shell no-ops.
 */
export function buildEnableClipboardCommand(): string {
  return (
    'command -v tmux >/dev/null 2>&1 && ' +
    'tmux set-option -g set-clipboard on 2>/dev/null; ' +
    'echo ok'
  )
}

/** Attach to a named session (interactive line). */
export function buildAttachCommand(sessionName: string): string {
  const name = shQuote(sanitizeSessionName(sessionName))
  return (
    `command -v tmux >/dev/null 2>&1 && [ -z "\${TMUX-}" ] && tmux attach -t ${name}`
  )
}

/** Create a new named session (interactive line). */
export function buildNewSessionCommand(sessionName: string): string {
  const name = shQuote(sanitizeSessionName(sessionName))
  return (
    `command -v tmux >/dev/null 2>&1 && [ -z "\${TMUX-}" ] && tmux new -s ${name}`
  )
}

/** Strip CSI / OSC-ish ANSI so status bars with color still parse. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
}

/**
 * Infer the active tmux session from recent terminal scrollback.
 *
 * Matches common status-left styles like `[claude2] 0:bash*` / `[portico] 1:claude`.
 * Requires `N:windowname` after the bracket so chat text like `[optional]` does not match.
 */
export function parseTmuxSessionFromOutput(lines: string[]): string | null {
  // [session] 0:window  or  [session] 0:window* 1:other-
  const statusRe = /\[([a-zA-Z0-9_-]{1,64})\]\s+\d+:[^\s\]]+/
  const start = Math.max(0, lines.length - 50)
  for (let i = lines.length - 1; i >= start; i--) {
    const line = stripAnsi(lines[i] ?? '')
    // Prefer the rightmost match on the line (status bar is often at the end).
    let found: string | null = null
    const re = new RegExp(statusRe.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      found = m[1]
    }
    if (found) return sanitizeSessionName(found)
  }
  return null
}

/**
 * Infer a tmux session name from a completed shell command line the user typed.
 * Handles attach / new variants; ignores unrelated commands.
 */
export function inferTmuxSessionFromShellLine(line: string): string | null {
  const s = line.trim()
  if (!s || s.startsWith('#') || !/^tmux\b/.test(s)) return null

  const tFlag = s.match(/(?:^|\s)-t\s*=?\s*["']?([a-zA-Z0-9_-]+)/)
  const sFlag = s.match(/(?:^|\s)-s\s*=?\s*["']?([a-zA-Z0-9_-]+)/)

  // attach / a / at / switch-client → -t name
  if (/\b(?:attach(?:-session)?|a|at|switch-client)\b/.test(s) && tFlag?.[1]) {
    return sanitizeSessionName(tFlag[1])
  }
  // new / new-session → -s name (some people use -t)
  if (/\bnew(?:-session)?\b/.test(s)) {
    const name = sFlag?.[1] ?? tFlag?.[1]
    if (name) return sanitizeSessionName(name)
  }
  return null
}
