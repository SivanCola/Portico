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
import type { ProviderId, ProviderSession } from './types.js'

export interface ProviderAdapter {
  id: ProviderId
  detect(session: DetectContext): boolean
  /** Whether this provider can accept a pasted image natively (enhancement). */
  supportsNativeImagePaste(session: ProviderSession): boolean
  /** Build the text to inject into the terminal. */
  formatImageReference(remotePath: string, prompt: string | undefined, session: ProviderSession): string
}

export interface DetectContext {
  /** Recent lines of terminal output, oldest first. */
  recentOutput: string[]
  /** Full current input line / prompt fragment. */
  currentLine: string
  /** Process name if known, e.g. "claude", "codex", "bash". */
  processName?: string
}

const has = (haystack: string[], needle: string | RegExp): boolean =>
  haystack.some((l) => (typeof needle === 'string' ? l.includes(needle) : needle.test(l)))

/** Claude Code: a REPL whose banner / prompts mention "claude". */
export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  detect(ctx) {
    const all = [...ctx.recentOutput, ctx.currentLine]
    if (ctx.processName === 'claude') return true
    if (has(all, /\bclaude\b/i)) return true
    // Claude Code's interactive prompt marker
    if (has(ctx.recentOutput, /^>\s*$/m)) return false
    return false
  },
  supportsNativeImagePaste() {
    return false
  },
  formatImageReference(remotePath, prompt) {
    const path = unquotedPath(remotePath)
    const text = (prompt ?? 'Analyze this image').trim()
    // Claude Code reads paths in prompts; keep it natural-language.
    return `${text}: ${path}`
  }
}

/**
 * Codex CLI:
 *  - Non-interactive / command mode: `codex -i <path> "<prompt>"`.
 *  - Interactive session: native composer paste is best, but as a safe
 *    baseline we hand the path with a short instruction. We never emit a
 *    bare `codex` command while already inside Codex (that would nest).
 */
export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  detect(ctx) {
    const all = [...ctx.recentOutput, ctx.currentLine]
    if (ctx.processName === 'codex') return true
    if (has(all, /\bcodex\b/i)) return true
    return false
  },
  supportsNativeImagePaste(session) {
    // Enhancement only; we only claim support when explicitly flagged.
    return session.nativePasteAvailable
  },
  formatImageReference(remotePath, prompt, session) {
    const path = unquotedPath(remotePath)
    const text = (prompt ?? 'Analyze this image').trim().replace(/"/g, '\\"')
    if (!session.interactive) {
      // Command mode: a fresh invocation with the image flag.
      return `codex -i ${path} "${text}"`
    }
    // Inside an interactive Codex session: prefer path-based instruction.
    // (When native paste is detectable in a later version, we'd simulate
    //  a clipboard paste here instead.)
    return `${text}: ${path}`
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
    const path = unquotedPath(remotePath)
    if (!prompt) return `# image uploaded to ${path}`
    return `# ${prompt}\n# image: ${path}`
  }
}

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  shell: shellAdapter
}

/** Run detection across adapters in priority order; returns first match. */
export function detectProvider(ctx: DetectContext): ProviderId {
  for (const id of ['claude', 'codex'] as const) {
    if (ADAPTERS[id].detect(ctx)) return id
  }
  return 'shell'
}

/** Convenience wrapper used by the main process. */
export function formatForProvider(
  provider: ProviderId,
  remotePath: string,
  prompt: string | undefined,
  session: ProviderSession
): string {
  return ADAPTERS[provider].formatImageReference(remotePath, prompt, session)
}
