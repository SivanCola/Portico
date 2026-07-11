/**
 * Auto-title for Portico session tabs.
 *
 * Combines host / tmux session / Claude worktree context into a short label.
 * Callers must respect `titleUserSet` and never overwrite a manual rename.
 */

/** Strip CSI ANSI so status lines with color still parse. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
}

export interface SessionTitleContext {
  /** SSH alias or host, e.g. noban-vm */
  hostLabel?: string | null
  /** Active tmux session, e.g. claude2 */
  tmuxSession?: string | null
  /**
   * Short Claude / agent work context:
   * worktree id (wt1), worktree folder name, or project basename.
   */
  workContext?: string | null
  kind?: 'local' | 'ssh' | null
  localShell?: string | null
}

/**
 * Infer Claude / agent work context from recent terminal scrollback.
 *
 * Patterns (most specific first):
 *  - status: `name@wt1` / `repo@worktree`
 *  - path: `.claude/worktrees/<name>`
 *  - path: `/.../ProjectName` near "worktree" banners
 */
export function parseClaudeWorkContext(lines: string[]): string | null {
  const start = Math.max(0, lines.length - 80)
  // Scan bottom-up (status bar + recent banners live near the end).
  for (let i = lines.length - 1; i >= start; i--) {
    const line = stripAnsi(lines[i] ?? '')

    // Claude Code footer: `Fable 5 | foo-bar@wt1 | 253k/1m …`
    const atWt = line.match(/\b([a-zA-Z0-9][a-zA-Z0-9._-]{0,48})@(wt\d+)\b/)
    if (atWt) {
      const name = atWt[1]!
      const wt = atWt[2]!
      // Always shorten long slugs: stateless-napping-lighthouse@wt1 → lighthouse@wt1
      return `${shortenSlug(name)}@${wt}`
    }

    // Bare worktree token when clearly in a worktree banner (avoid bare @ alone)
    const bareWt = line.match(/\b(wt\d+)\b/)
    if (bareWt && /worktree|claude|branch/i.test(line)) {
      return bareWt[1]!
    }

    // `.claude/worktrees/<slug>`
    const wtPath = line.match(/\.claude\/worktrees\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,48})/)
    if (wtPath) return shortenSlug(wtPath[1])

    // "Switched to worktree on branch foo" / path ending with project name
    const branch = line.match(
      /worktree[^\n]{0,40}branch\s+([a-zA-Z0-9][a-zA-Z0-9._/-]{0,40})/i
    )
    if (branch) return shortenSlug(branch[1].replace(/^.*\//, ''))
  }
  return null
}

/** Collapse long slugs for the rail (max ~16 visible chars). */
export function shortenSlug(raw: string): string {
  const s = raw.replace(/^-+|-+$/g, '')
  if (s.length <= 16) return s
  // Prefer last segment of hyphenated names: stateless-napping-lighthouse → lighthouse
  const parts = s.split(/[-_/]/).filter(Boolean)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!
    if (last.length >= 3 && last.length <= 16) return last
  }
  return s.slice(0, 14) + '…'
}

/**
 * Build the auto title string.
 *
 * Priority examples:
 *  - tmux + work  → `claude2 · wt1`
 *  - tmux only    → `claude2`  (or `host · claude2` when host is short)
 *  - work only    → `wt1` / `lighthouse@wt1`
 *  - host only    → alias/host
 *  - local shell  → shell basename
 */
export function composeSessionTitle(ctx: SessionTitleContext): string {
  if (ctx.kind === 'local') {
    return (ctx.localShell || 'Local').slice(0, 80)
  }

  const tmux = clean(ctx.tmuxSession)
  const work = clean(ctx.workContext)
  const host = clean(ctx.hostLabel)

  if (tmux && work) return clip(`${tmux} · ${work}`)
  if (tmux) {
    // Include host only when it adds info and stays short.
    if (host && host.length <= 12 && !host.includes(tmux)) {
      return clip(`${host} · ${tmux}`)
    }
    return clip(tmux)
  }
  if (work) {
    if (host && host.length <= 12) return clip(`${host} · ${work}`)
    return clip(work)
  }
  if (host) return clip(host)
  return 'Session'
}

function clean(s: string | null | undefined): string {
  return (s ?? '').trim()
}

function clip(s: string): string {
  return s.slice(0, 80)
}

/**
 * Whether an existing title looks like a generic host label we should replace
 * when richer context appears (still only when !titleUserSet).
 */
export function isGenericHostTitle(title: string, hostLabel: string | null | undefined): boolean {
  const t = title.trim()
  if (!t || t === 'New session' || t === 'Session') return true
  const h = (hostLabel ?? '').trim()
  if (h && t === h) return true
  // user@host form
  if (/^[^@\s]+@[^@\s]+$/.test(t)) return true
  return false
}
