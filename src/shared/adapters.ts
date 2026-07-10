/**
 * Provider adapters.
 *
 * Each adapter knows how to turn a remote image path (+ optional prompt) into
 * the text that should be injected into the terminal for a given AI coding CLI.
 *
 * The MVP baseline is *file-path-based* handoff. Native clipboard-image
 * simulation is treated as an enhancement and gated behind
 * `supportsNativeImagePaste`.
 */
import { unquotedPath } from './hash.js'
import { resolveImagePrompt } from './image-prompt.js'
import type { ProviderId, ProviderSession } from './types.js'

export interface ProviderAdapter {
  id: ProviderId
  detect(session: DetectContext): boolean
  /** Whether this provider can accept a pasted image natively (enhancement). */
  supportsNativeImagePaste(session: ProviderSession): boolean
  /**
   * Build the text to inject into the terminal.
   * `remotePath` may be a single path or multiple (multi-image paste).
   */
  formatImageReference(
    remotePath: string | string[],
    prompt: string | undefined,
    session: ProviderSession
  ): string
}

/** Normalize one-or-many remote paths and strip shell-unsafe quoting noise. */
function normalizePaths(remotePath: string | string[]): string[] {
  const list = Array.isArray(remotePath) ? remotePath : [remotePath]
  return list.map((p) => unquotedPath(p)).filter(Boolean)
}

export interface DetectContext {
  /** Recent lines of terminal output, oldest first. */
  recentOutput: string[]
  /** Full current input line / prompt fragment. */
  currentLine: string
  /** Process name if known, e.g. "claude", "codex", "bash". */
  processName?: string
  /**
   * When set (from local process tree), preferred over banner heuristics.
   * 'shell' means no AI child was found under the PTY.
   */
  processHint?: ProviderId | 'none'
}

const joined = (lines: string[]): string => lines.join('\n')

/** Strong Claude Code entry banners. */
const CLAUDE_STRONG =
  /claude\s*code|welcome to claude|anthropic.*claude|\bclaude\b.*\bv?\d+\.\d+/i

/** Strong Codex entry banners. */
const CODEX_STRONG =
  /openai\s*codex|welcome to codex|\bcodex\b.*\bv?\d+\.\d+|codex\s*cli/i

/**
 * UI / runtime hints that Claude is *still* the foreground app
 * (status lines, menus, permissions banner). Keep conservative — broad
 * matches prevent "back to shell" detection.
 */
const CLAUDE_ACTIVE =
  /claude\s*code|bypass permissions|\/btw\b|\/compact\b|╭─|╰─|anthropic\.com/i

const CODEX_ACTIVE = /openai\s*codex|codex\s*cli|\bcodex>\b/i

/** Looks like a normal shell prompt at the end of recent output. */
const SHELL_PROMPT =
  /(?:^|\n)(?:\S+@\S+(?::[^\n#\$]*)?\s*[#\$]\s*|[%❯›➜]\s+|\$\s+)$/m

/** Explicit exit / goodbye noise from AI CLIs. */
const AI_EXIT =
  /(?:^|\n)\s*(?:goodbye|bye[!.,]?|exiting|session ended)\b/i

/** Claude Code: banner / process name / strong versioned mention. */
export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  detect(ctx) {
    if (ctx.processName === 'claude') return true
    return CLAUDE_STRONG.test(joined([...ctx.recentOutput.slice(-40), ctx.currentLine]))
  },
  supportsNativeImagePaste() {
    return false
  },
  formatImageReference(remotePath, prompt) {
    const paths = normalizePaths(remotePath)
    const multi = paths.length > 1
    const text = resolveImagePrompt(prompt, paths.length)
    // Claude Code reads paths in prompts; keep it natural-language.
    if (!multi) return `${text}: ${paths[0] ?? ''}`
    return `${text}:\n${paths.join('\n')}`
  }
}

/**
 * Codex CLI:
 *  - Non-interactive / command mode: `codex -i <path> "<prompt>"`.
 *  - Interactive session: path-based instruction (never nest `codex`).
 */
export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  detect(ctx) {
    if (ctx.processName === 'codex') return true
    return CODEX_STRONG.test(joined([...ctx.recentOutput.slice(-40), ctx.currentLine]))
  },
  supportsNativeImagePaste(session) {
    return session.nativePasteAvailable
  },
  formatImageReference(remotePath, prompt, session) {
    const paths = normalizePaths(remotePath)
    const multi = paths.length > 1
    const text = resolveImagePrompt(prompt, paths.length).replace(/"/g, '\\"')
    if (!session.interactive) {
      // Multiple -i flags: one path per image.
      const flags = paths.map((p) => `-i ${p}`).join(' ')
      return `codex ${flags} "${text}"`
    }
    if (!multi) return `${text}: ${paths[0] ?? ''}`
    return `${text}:\n${paths.join('\n')}`
  }
}

/** Plain shell: just echo the path so the user can copy/use it. */
export const shellAdapter: ProviderAdapter = {
  id: 'shell',
  detect() {
    return true // fallback
  },
  supportsNativeImagePaste() {
    return false
  },
  formatImageReference(remotePath, prompt) {
    const paths = normalizePaths(remotePath)
    if (paths.length === 0) return prompt ? `# ${prompt}` : '# no image path'
    if (paths.length === 1) {
      if (!prompt) return `# image uploaded to ${paths[0]}`
      return `# ${prompt}\n# image: ${paths[0]}`
    }
    const lines = paths.map((p) => `# image: ${p}`)
    if (!prompt) return `# images uploaded\n${lines.join('\n')}`
    return `# ${prompt}\n${lines.join('\n')}`
  }
}

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  shell: shellAdapter
}

/**
 * Detect active provider from process tree (if available) + terminal output.
 *
 * Priority:
 *  1. Local process tree hint (most reliable on local PTY)
 *  2. Shell prompt / exit at the *tail* → shell (exit Claude/Codex)
 *  3. Active AI UI chrome in the last few lines
 *  4. Strong entry banners still “near” the tail
 *  5. Default shell
 */
export function detectProvider(ctx: DetectContext): ProviderId {
  // 1) Live process under local PTY — authoritative when present
  if (ctx.processHint === 'claude' || ctx.processHint === 'codex') {
    return ctx.processHint
  }
  if (ctx.processHint === 'none') {
    // AI child gone; do not keep sticky banner from scrollback
    return 'shell'
  }

  if (ctx.processName === 'claude') return 'claude'
  if (ctx.processName === 'codex') return 'codex'

  const recent = joined(ctx.recentOutput.slice(-12).concat(ctx.currentLine ? [ctx.currentLine] : []))
  const tail = joined(ctx.recentOutput.slice(-4).concat(ctx.currentLine ? [ctx.currentLine] : []))
  const lastLine = (ctx.currentLine || ctx.recentOutput[ctx.recentOutput.length - 1] || '').trim()

  // 2) Back at a shell prompt (or explicit exit) — prefer shell unless the
  //    last line itself is still an AI banner/UI line.
  const tailIsShell = SHELL_PROMPT.test(tail) || AI_EXIT.test(tail)
  const lastIsAi =
    CLAUDE_STRONG.test(lastLine) ||
    CODEX_STRONG.test(lastLine) ||
    CLAUDE_ACTIVE.test(lastLine) ||
    CODEX_ACTIVE.test(lastLine)

  if (tailIsShell && !lastIsAi) {
    return 'shell'
  }

  // 3) Still-active UI in recent lines
  if (CLAUDE_ACTIVE.test(recent) || CLAUDE_STRONG.test(recent)) {
    if (CODEX_ACTIVE.test(recent) || CODEX_STRONG.test(recent)) {
      const claudeIdx = Math.max(
        recent.toLowerCase().lastIndexOf('claude'),
        recent.indexOf('╭')
      )
      const codexIdx = Math.max(
        recent.toLowerCase().lastIndexOf('codex'),
        recent.toLowerCase().lastIndexOf('openai')
      )
      return codexIdx > claudeIdx ? 'codex' : 'claude'
    }
    return 'claude'
  }
  if (CODEX_ACTIVE.test(recent) || CODEX_STRONG.test(recent)) return 'codex'

  // 4) Older banners further up the buffer (entry without process probe)
  const window = joined(ctx.recentOutput.slice(-40).concat(ctx.currentLine ? [ctx.currentLine] : []))
  if (CLAUDE_STRONG.test(window)) return 'claude'
  if (CODEX_STRONG.test(window)) return 'codex'

  return 'shell'
}

/** Convenience wrapper used by the main process. */
export function formatForProvider(
  provider: ProviderId,
  remotePath: string | string[],
  prompt: string | undefined,
  session: ProviderSession
): string {
  return ADAPTERS[provider].formatImageReference(remotePath, prompt, session)
}
