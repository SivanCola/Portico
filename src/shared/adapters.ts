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

const joined = (ctx: DetectContext): string =>
  [...ctx.recentOutput.slice(-40), ctx.currentLine].join('\n')

/** Strong Claude Code signals — avoid locking on a casual "claude" mention. */
const CLAUDE_STRONG =
  /claude\s*code|welcome to claude|anthropic.*claude|\bclaude\b.*\bv?\d+\.\d+/i

/** Strong Codex signals. */
const CODEX_STRONG =
  /openai\s*codex|welcome to codex|\bcodex\b.*\bv?\d+\.\d+|codex\s*cli/i

/** Claude Code: banner / process name / strong versioned mention. */
export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  detect(ctx) {
    if (ctx.processName === 'claude') return true
    return CLAUDE_STRONG.test(joined(ctx))
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
 *  - Interactive session: path-based instruction (never nest `codex`).
 */
export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  detect(ctx) {
    if (ctx.processName === 'codex') return true
    return CODEX_STRONG.test(joined(ctx))
  },
  supportsNativeImagePaste(session) {
    return session.nativePasteAvailable
  },
  formatImageReference(remotePath, prompt, session) {
    const path = unquotedPath(remotePath)
    const text = (prompt ?? 'Analyze this image').trim().replace(/"/g, '\\"')
    if (!session.interactive) {
      return `codex -i ${path} "${text}"`
    }
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
