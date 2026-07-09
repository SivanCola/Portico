/**
 * Unit tests for clipboard path resolution (no real Electron clipboard needed).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  clipboard: {
    readImage: () => ({ isEmpty: () => true }),
    read: () => ''
  },
  nativeImage: {
    createFromBuffer: () => ({ isEmpty: () => true })
  }
}))

const { resolveCandidate } = await import('./clipboard.js')

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
