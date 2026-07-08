import { describe, it, expect } from 'vitest'
import { blobPath, shellQuote, sha256Hex } from './hash.js'
import { PORTICO_REMOTE_DIR } from './constants.js'

describe('sha256Hex', () => {
  it('produces a stable hex digest', () => {
    expect(sha256Hex(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    )
  })

  it('is deterministic for identical bytes', () => {
    expect(sha256Hex(Buffer.from([1, 2, 3]))).toBe(sha256Hex(Buffer.from([1, 2, 3])))
  })
})

describe('blobPath', () => {
  it('uses the canonical ~/.portico/blobs dir and lowercased ext', () => {
    expect(blobPath(PORTICO_REMOTE_DIR, 'abc', 'PNG')).toBe('~/.portico/blobs/abc.png')
    expect(blobPath(PORTICO_REMOTE_DIR, 'abc', '.jpg')).toBe('~/.portico/blobs/abc.jpg')
  })

  it('handles a custom dir without duplicating slashes', () => {
    expect(blobPath('/tmp/blobs/', 'xyz', 'gif')).toBe('/tmp/blobs/xyz.gif')
  })

  it('content-addresses: same bytes => same path', () => {
    const data = Buffer.from('portico-test-image')
    const hash = sha256Hex(data)
    const a = blobPath(PORTICO_REMOTE_DIR, hash, 'png')
    const b = blobPath(PORTICO_REMOTE_DIR, sha256Hex(data), 'png')
    expect(a).toBe(b)
  })
})

describe('shellQuote', () => {
  it('wraps a plain path in single quotes', () => {
    expect(shellQuote('/tmp/a b.png')).toBe("'/tmp/a b.png'")
  })

  it('escapes embedded single quotes', () => {
    expect(shellQuote("/tmp/it's.png")).toBe("'/tmp/it'\\''s.png'")
  })

  it('handles non-ASCII and spaces verbatim', () => {
    expect(shellQuote('/home/u/スクリーンショット 1.png')).toBe(
      "'/home/u/スクリーンショット 1.png'"
    )
  })
})
