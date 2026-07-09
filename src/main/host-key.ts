/**
 * SSH host-key verification against OpenSSH known_hosts.
 *
 * Strategy (good-enough for desktop UX):
 *  - Parse plain `host[,alias] keytype base64key` lines from ~/.ssh/known_hosts
 *    (and known_hosts2 when present).
 *  - Hashed host entries (`|1|...`) are skipped — we cannot match them without
 *    the HMAC salt dance, and ssh2 does not expose a Hosts helper.
 *  - Unknown host (no matching entry): accept for this session, log a warn
 *    (first-connect UX).
 *  - Known host with mismatched key: reject with HOST_KEY_MISMATCH.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getLogger } from './logger.js'

const log = getLogger()

export interface KnownHostEntry {
  /** Host tokens from the line (may include `[host]:port` forms). */
  hosts: string[]
  keyType: string
  /** Raw public-key blob (decoded from the base64 field). */
  key: Buffer
}

/** Host patterns that should match a connect target. */
export function hostMatchPatterns(host: string, port: number): string[] {
  const patterns = [host]
  if (port !== 22) {
    patterns.push(`[${host}]:${port}`)
  } else {
    // OpenSSH may still store non-default form; always include both.
    patterns.push(`[${host}]:${port}`)
  }
  return patterns
}

/**
 * Parse known_hosts file contents into structured entries.
 * Exported for unit tests.
 */
export function parseKnownHosts(content: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // Optional @cert-authority / @revoked markers — skip for MVP.
    if (line.startsWith('@')) continue

    const parts = line.split(/\s+/)
    if (parts.length < 3) continue

    const hostField = parts[0]
    const keyType = parts[1]
    const keyB64 = parts[2]
    if (!hostField || !keyType || !keyB64) continue

    let key: Buffer
    try {
      key = Buffer.from(keyB64, 'base64')
      if (key.length === 0) continue
    } catch {
      continue
    }

    // Hashed hosts (`|1|salt|hash`) need HMAC to match; skip for MVP.
    if (hostField.startsWith('|1|')) continue

    const hosts = hostField.split(',').filter(Boolean)
    if (hosts.length === 0) continue
    entries.push({ hosts, keyType, key })
  }
  return entries
}

/** Best-effort load of ~/.ssh/known_hosts (+ known_hosts2). */
export function loadKnownHosts(sshDir = join(homedir(), '.ssh')): KnownHostEntry[] {
  const files = [join(sshDir, 'known_hosts'), join(sshDir, 'known_hosts2')]
  const all: KnownHostEntry[] = []
  for (const f of files) {
    try {
      if (!existsSync(f)) continue
      all.push(...parseKnownHosts(readFileSync(f, 'utf8')))
    } catch (e) {
      log.warn('ssh', 'failed to read known_hosts', { file: f, err: e as Error })
    }
  }
  return all
}

/**
 * Decide whether `presented` matches known_hosts for `host`:`port`.
 * Returns:
 *  - 'accept' — match found, or no entry (first connect)
 *  - 'reject' — host is known but key differs
 *  - 'unknown' — no matching host entry (caller may accept with warn)
 */
export function verifyHostKey(
  entries: KnownHostEntry[],
  host: string,
  port: number,
  presented: Buffer
): 'match' | 'mismatch' | 'unknown' {
  const patterns = new Set(hostMatchPatterns(host, port))
  let sawHost = false

  for (const entry of entries) {
    const hostHit = entry.hosts.some((h) => patterns.has(h))
    if (!hostHit) continue
    sawHost = true
    if (entry.key.equals(presented)) return 'match'
  }

  return sawHost ? 'mismatch' : 'unknown'
}

/**
 * Build an ssh2-compatible `hostVerifier` callback for the given host/port.
 */
export function createHostVerifier(
  host: string,
  port = 22,
  entries: KnownHostEntry[] = loadKnownHosts()
): (key: Buffer, verify: (ok: boolean) => void) => void {
  return (key: Buffer, verify: (ok: boolean) => void) => {
    const result = verifyHostKey(entries, host, port, key)
    if (result === 'match') {
      verify(true)
      return
    }
    if (result === 'unknown') {
      log.warn('ssh', 'host key not in known_hosts; accepting for this session', {
        host,
        port
      })
      verify(true)
      return
    }
    log.error('ssh', 'HOST_KEY_MISMATCH', { host, port })
    verify(false)
  }
}
