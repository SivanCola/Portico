/**
 * Unit tests for clipboard path resolution (no real Electron clipboard needed).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  clipboard: {
    readImage: () => ({ isEmpty: () => true }),
    read: () => '',
    readBuffer: () => Buffer.alloc(0)
  },
  nativeImage: {
    createFromBuffer: () => ({ isEmpty: () => true })
  }
}))

const {
  resolveCandidate,
  extractPathsFromPlistText,
  extractAbsolutePathsFromBinary
} = await import('./clipboard.js')

describe('resolveCandidate', () => {
  it('maps Windows file:///C:/... URLs to a drive path', () => {
    const out = resolveCandidate('file:///C:/Users/me/Pictures/shot.png')
    // fileURLToPath yields platform-native separators.
    expect(out?.replace(/\\/g, '/')).toBe('C:/Users/me/Pictures/shot.png')
  })

  it('maps Unix file:///Users/... URLs', () => {
    expect(resolveCandidate('file:///Users/me/shot.png')).toBe('/Users/me/shot.png')
  })

  it('accepts bare Unix absolute paths', () => {
    expect(resolveCandidate('/tmp/a.png')).toBe('/tmp/a.png')
  })

  it('accepts bare Windows drive paths', () => {
    expect(resolveCandidate('C:\\Users\\me\\a.png')?.replace(/\\/g, '/')).toBe('C:/Users/me/a.png')
    expect(resolveCandidate('D:/img.jpg')).toBe('D:/img.jpg')
  })

  it('rejects relative / non-path junk', () => {
    expect(resolveCandidate('shot.png')).toBeNull()
    expect(resolveCandidate('https://example.com/a.png')).toBeNull()
  })

  it('decodes percent-encoded spaces in file URLs', () => {
    const out = resolveCandidate('file:///Users/me/My%20Photos/a.png')
    expect(out).toBe('/Users/me/My Photos/a.png')
  })
})

describe('extractPathsFromPlistText', () => {
  it('pulls multiple absolute paths from an XML plist', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
  <string>/Users/me/a.png</string>
  <string>/Users/me/b.jpg</string>
</array>
</plist>`
    expect(extractPathsFromPlistText(xml)).toEqual(['/Users/me/a.png', '/Users/me/b.jpg'])
  })

  it('unescapes basic XML entities in paths', () => {
    const xml = '<string>/Users/me/a&amp;b.png</string>'
    expect(extractPathsFromPlistText(xml)).toEqual(['/Users/me/a&b.png'])
  })
})

describe('extractAbsolutePathsFromBinary', () => {
  it('scans null-separated absolute paths from a buffer', () => {
    const buf = Buffer.from('/Users/me/one.png\0/Users/me/two.webp\0', 'utf8')
    expect(extractAbsolutePathsFromBinary(buf)).toEqual([
      '/Users/me/one.png',
      '/Users/me/two.webp'
    ])
  })
})
