/**
 * Minimal `~/.ssh/config` parser for OpenSSH-style alias expansion.
 *
 * Portico does not shell out to the system `ssh`, so to let the connection
 * form accept SSH aliases (e.g. `ssh noban-vm-7aafd1-db5db4`) it must read and
 * expand `~/.ssh/config` itself. Only the directives we actually need are
 * understood:
 *
 *   Host <name> [<name> ...]   — starts a block; whitespace-separated tokens
 *   HostName <fqdn>            — real address; defaults to the alias itself
 *   User <name>                — login user; left unset if not specified
 *   Port <n>                   — TCP port; defaults to 22
 *   IdentityFile <path>        — private key path; first one wins
 *   Include <path>             — recursive glob include (relative to ~/.ssh)
 *
 * Everything else (ProxyJump, ServerAlive*, etc.) is ignored for now — those
 * are out of scope for the first cut. Matching follows OpenSSH semantics:
 * first matching block wins, per-key first value wins, and `*`/`?` globbing
 * is honored on Host tokens.
 *
 * Failure model mirrors `host-key.ts`: read/parse errors are logged as warns
 * and yield an empty result, never a throw — a missing or malformed config
 * must not block manual host entry.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getLogger } from './logger.js'
import type { ResolvedSshTarget, SshHostAlias } from '@shared/types.js'

const log = getLogger()

/** Upper recursion cap so a cyclic `Include` cannot hang the parser. */
const MAX_INCLUDE_DEPTH = 5

/** A single `Host <names>` block with its resolved directives. */
export interface SshHostBlock {
  /** Raw Host tokens (may contain `*`/`?` glob patterns). */
  patterns: string[]
  hostName?: string
  user?: string
  port?: number
  /** First IdentityFile seen in the block (OpenSSH uses the first match). */
  identityFile?: string
}

/**
 * A flat, ordered list of host blocks as collected during parsing. Order is
 * significant: first-match-wins resolution walks this in order.
 */
export type SshConfig = SshHostBlock[]

/** Tokens returned by the line tokenizer. */
interface TokenLine {
  keyword: string
  args: string[]
}

/** Split a config body into non-empty, non-comment token lines. */
function tokenize(content: string): TokenLine[] {
  const out: TokenLine[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    // Strip inline comments (# may appear unquoted; we treat a leading-or-
    // whitespace # as a comment start, matching common ssh config usage).
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const parts = line.split(/\s+/).filter(Boolean)
    if (parts.length === 0) continue
    out.push({ keyword: parts[0].toLowerCase(), args: parts.slice(1) })
  }
  return out
}

/** Remove a trailing `# comment`, respecting simple double-quoted segments. */
function stripComment(line: string): string {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === '#' && !inQuote && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i)
    }
  }
  return line
}

/** Apply a single non-Host, non-Include directive onto a host block. */
function applyDirective(cur: SshHostBlock, keyword: string, args: string[]): void {
  switch (keyword) {
    case 'hostname':
      if (args[0] && cur.hostName === undefined) cur.hostName = args[0]
      break
    case 'user':
      if (args[0] && cur.user === undefined) cur.user = args[0]
      break
    case 'port':
      if (args[0] && cur.port === undefined) {
        const n = Number(args[0])
        if (Number.isFinite(n) && n > 0) cur.port = n
      }
      break
    case 'identityfile':
      if (args[0] && cur.identityFile === undefined) cur.identityFile = expandHome(args[0])
      break
    // Other directives are intentionally ignored (out of scope).
  }
}

/**
 * Parse config text into ordered host blocks. `Include` directives are left
 * as-is here; expansion happens in `loadSshConfig` where filesystem context
 * is available.
 *
 * Exported for unit tests that operate on literal strings.
 */
export function parseSshConfig(content: string): SshConfig {
  const lines = tokenize(content)
  const config: SshConfig = []
  let cur: SshHostBlock | null = null

  for (const { keyword, args } of lines) {
    if (keyword === 'host') {
      // Start a new block. OpenSSH allows multiple Host lines contributing to
      // separate blocks; each `Host` line opens a fresh one.
      cur = { patterns: args.filter(Boolean) }
      config.push(cur)
      continue
    }
    // Include is handled by the loader (needs filesystem context); ignore here.
    if (keyword === 'include') continue
    if (!cur) continue // directive before any Host — ignored by OpenSSH
    applyDirective(cur, keyword, args)
  }

  return config
}

/** Expand a leading `~` (only form OpenSSH uses for IdentityFile). */
function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return homedir() + p.slice(1)
  return p
}

/** OpenSSH-style glob: `*` any chars, `?` single char, literal otherwise. */
function globMatch(pattern: string, input: string): boolean {
  // Anchor the pattern; ssh config host patterns are matched against the full
  // alias token, so a `*` suffix still must consume the remainder.
  const re = new RegExp(
    '^' +
      pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') +
      '$',
    'i'
  )
  return re.test(input)
}

/** True when a Host token contains glob metacharacters (so it's not a literal). */
function isGlob(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?')
}

/**
 * Read `~/.ssh/config` and recursively expand `Include` directives.
 *
 * Relative include paths resolve against `~/.ssh`; absolute paths are used
 * verbatim; globs (`config.d/*`) are expanded. Recursion is capped at
 * `MAX_INCLUDE_DEPTH` to defeat include cycles. Read failures are logged and
 * skipped — the parse always returns a usable (possibly empty) config.
 */
export function loadSshConfig(sshDir = join(homedir(), '.ssh')): SshConfig {
  const merged: SshConfig = []
  const seen = new Set<string>()
  loadFile(join(sshDir, 'config'), sshDir, 0, merged, seen)
  return merged
}

function loadFile(
  file: string,
  sshDir: string,
  depth: number,
  into: SshConfig,
  seen: Set<string>
): void {
  if (depth > MAX_INCLUDE_DEPTH) {
    log.warn('ssh-config', 'include recursion cap reached, stopping', { file, depth })
    return
  }
  if (seen.has(file)) {
    // Defense against include cycles; OpenSSH itself does the same.
    return
  }
  seen.add(file)
  if (!existsSync(file)) return

  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch (e) {
    log.warn('ssh-config', 'failed to read config file', { file, err: e as Error })
    return
  }

  // Walk tokens in order so `Include` expands *inline* at its lexical position
  // (OpenSSH semantics). Appending includes after the whole file would invert
  // first-match-wins relative to a trailing `Host *` defaults block.
  let cur: SshHostBlock | null = null
  for (const { keyword, args } of tokenize(content)) {
    if (keyword === 'include') {
      // Include closes the current host context for subsequent directives in
      // this file; OpenSSH re-enters Host blocks only on a new `Host` line.
      cur = null
      const spec = args.join(' ')
      if (!spec) continue
      for (const resolved of resolveInclude(spec, sshDir)) {
        loadFile(resolved, sshDir, depth + 1, into, seen)
      }
      continue
    }
    if (keyword === 'host') {
      cur = { patterns: args.filter(Boolean) }
      into.push(cur)
      continue
    }
    if (!cur) continue
    applyDirective(cur, keyword, args)
  }
}

/** Expand an `Include` spec into concrete file paths (absolute). */
function resolveInclude(spec: string, sshDir: string): string[] {
  // OpenSSH allows whitespace-separated lists in a single Include.
  return spec
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((tok) => {
      const abs = tok.startsWith('/') ? tok : join(sshDir, tok)
      // Glob expand directory wildcards (e.g. config.d/*). For patterns that
      // don't contain metacharacters, just return the literal path and let
      // the reader's existsSync check handle existence.
      if (!/[.*?[\]{}]/.test(tok)) return [abs]
      return globFiles(abs)
    })
}

/** Expand a glob path to existing files (not directories). */
function globFiles(glob: string): string[] {
  try {
    // Lightweight glob: node:fs has no built-in glob, so we implement a
    // minimal split-and-match against directory entries. Only non-recursive
    // patterns (no **) are supported, which covers OpenSSH usage.
    const dirIdx = glob.lastIndexOf('/')
    if (dirIdx === -1) return []
    const dir = glob.slice(0, dirIdx)
    const pat = glob.slice(dirIdx + 1)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name: string) => globMatch(pat, name))
      .map((name: string) => join(dir, name))
      .filter((f: string) => {
        try {
          return statSync(f).isFile()
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

/**
 * Resolve a connection alias against a config.
 *
 * Walks blocks in order and applies OpenSSH "first-match-wins" per key: the
 * first block whose Host token matches supplies HostName/User/Port/IdentityFile,
 * but a later matching block may fill in keys the first one left unset.
 */
export function resolveAlias(alias: string, config: SshConfig = loadSshConfig()): ResolvedSshTarget {
  let host: string | undefined
  let user: string | undefined
  let port: number | undefined
  let identityFile: string | undefined
  let matched = false

  for (const block of config) {
    if (!block.patterns.some((p) => globMatch(p, alias))) continue
    matched = true
    if (host === undefined && block.hostName !== undefined) host = block.hostName
    if (user === undefined && block.user !== undefined) user = block.user
    if (port === undefined && block.port !== undefined) port = block.port
    if (identityFile === undefined && block.identityFile !== undefined) {
      identityFile = block.identityFile
    }
    // OpenSSH keeps walking subsequent blocks to fill remaining unset keys,
    // so we don't break here.
  }

  return {
    matched,
    host: host ?? alias,
    user,
    port: port ?? 22,
    identityFile,
    alias
  }
}

/**
 * List configured host aliases for the dropdown picker.
 *
 * Only literal (non-glob) Host tokens are returned — patterns like `Host *`
 * are useless as picker entries. Each is resolved to its best-known HostName
 * for the secondary line.
 */
export function listHostAliases(config: SshConfig = loadSshConfig()): SshHostAlias[] {
  const out: SshHostAlias[] = []
  const seen = new Set<string>()
  for (const block of config) {
    for (const p of block.patterns) {
      if (isGlob(p)) continue
      if (seen.has(p)) continue
      seen.add(p)
      out.push({
        alias: p,
        hostName: block.hostName,
        port: block.port,
        user: block.user
      })
    }
  }
  return out
}
