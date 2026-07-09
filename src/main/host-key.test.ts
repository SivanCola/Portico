import { describe, it, expect, vi } from 'vitest'

vi.mock('./logger.js', () => ({
  getLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  })
}))

const {
  hostMatchPatterns,
  parseKnownHosts,
  verifyHostKey,
  createHostVerifier,
  keyTypeFromBlob
} = await import('./host-key.js')
import type { KnownHostEntry } from './host-key.js'

/** Fixture key blobs (decoded from typical known_hosts base64 fields). */
const KEY_A = Buffer.from(
  'AAAAC3NzaC1lZDI1NTE5AAAAILSgV91QxpxliyaQLHlsH2xbCFNLF1dHDsne+jAGkbIo',
  'base64'
)
const KEY_B = Buffer.from(
  'AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'base64'
)

const FIXTURE = `
# comment
example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILSgV91QxpxliyaQLHlsH2xbCFNLF1dHDsne+jAGkbIo
[example.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILSgV91QxpxliyaQLHlsH2xbCFNLF1dHDsne+jAGkbIo
10.0.0.4,alias.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILSgV91QxpxliyaQLHlsH2xbCFNLF1dHDsne+jAGkbIo
|1|abc|def ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILSgV91QxpxliyaQLHlsH2xbCFNLF1dHDsne+jAGkbIo
@cert-authority *.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILSgV91QxpxliyaQLHlsH2xbCFNLF1dHDsne+jAGkbIo
`.trim()

describe('parseKnownHosts', () => {
  it('parses plain host lines and skips hashed / marker lines', () => {
    const entries = parseKnownHosts(FIXTURE)
    expect(entries).toHaveLength(3)
    expect(entries[0].hosts).toEqual(['example.com'])
    expect(entries[0].keyType).toBe('ssh-ed25519')
    expect(entries[0].key.equals(KEY_A)).toBe(true)

    expect(entries[1].hosts).toEqual(['[example.com]:2222'])
    expect(entries[2].hosts).toEqual(['10.0.0.4', 'alias.local'])
  })

  it('skips hashed host entries entirely', () => {
    const entries = parseKnownHosts(
      '|1|salt|hash ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILSgV91QxpxliyaQLHlsH2xbCFNLF1dHDsne+jAGkbIo\n'
    )
    expect(entries).toHaveLength(0)
  })
})

describe('hostMatchPatterns', () => {
  it('includes bare host and [host]:port', () => {
    expect(hostMatchPatterns('h.example', 22)).toEqual(['h.example', '[h.example]:22'])
    expect(hostMatchPatterns('h.example', 2222)).toEqual(['h.example', '[h.example]:2222'])
  })
})

describe('verifyHostKey', () => {
  const entries: KnownHostEntry[] = parseKnownHosts(FIXTURE)

  it('matches a known host key', () => {
    expect(verifyHostKey(entries, 'example.com', 22, KEY_A)).toBe('match')
  })

  it('matches [host]:port form', () => {
    expect(verifyHostKey(entries, 'example.com', 2222, KEY_A)).toBe('match')
  })

  it('matches comma-separated aliases', () => {
    expect(verifyHostKey(entries, 'alias.local', 22, KEY_A)).toBe('match')
  })

  it('rejects when the host is known but the key differs', () => {
    expect(verifyHostKey(entries, 'example.com', 22, KEY_B)).toBe('mismatch')
  })

  it('returns unknown when the host has no entry', () => {
    expect(verifyHostKey(entries, 'never-seen.example', 22, KEY_A)).toBe('unknown')
  })

  it('ignores hashed entries for matching', () => {
    const onlyHashed = parseKnownHosts(
      '|1|salt|hash ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILSgV91QxpxliyaQLHlsH2xbCFNLF1dHDsne+jAGkbIo\n'
    )
    expect(verifyHostKey(onlyHashed, 'example.com', 22, KEY_A)).toBe('unknown')
  })

  it('treats a different key algorithm as unknown (not mismatch)', () => {
    // Host only has ssh-rsa recorded; server presents ssh-ed25519.
    const rsaOnly = parseKnownHosts(
      'multi.example.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7examplekeymaterialnotreal000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000=\n'
    )
    // KEY_A is ssh-ed25519 wire format — no same-type entry, so not MITM.
    expect(verifyHostKey(rsaOnly, 'multi.example.com', 22, KEY_A)).toBe('unknown')
  })

  it('still mismatches when the same key type differs', () => {
    // KEY_A and KEY_B are both ssh-ed25519 wire blobs with different material.
    expect(verifyHostKey(entries, 'example.com', 22, KEY_B)).toBe('mismatch')
  })
})

describe('keyTypeFromBlob', () => {
  it('reads the type string from a wire-format public key', () => {
    expect(keyTypeFromBlob(KEY_A)).toBe('ssh-ed25519')
  })
})

describe('createHostVerifier', () => {
  const entries = parseKnownHosts(FIXTURE)

  it('accepts matching keys', async () => {
    const v = createHostVerifier('example.com', 22, entries)
    await new Promise<void>((resolve, reject) => {
      v(KEY_A, (ok) => (ok ? resolve() : reject(new Error('expected accept'))))
    })
  })

  it('rejects mismatched keys', async () => {
    const v = createHostVerifier('example.com', 22, entries)
    await new Promise<void>((resolve, reject) => {
      v(KEY_B, (ok) => (!ok ? resolve() : reject(new Error('expected reject'))))
    })
  })

  it('accepts unknown hosts (first-connect)', async () => {
    const v = createHostVerifier('brand-new.example', 22, entries)
    await new Promise<void>((resolve, reject) => {
      v(KEY_A, (ok) => (ok ? resolve() : reject(new Error('expected accept'))))
    })
  })
})
