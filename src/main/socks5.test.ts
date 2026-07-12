import { describe, it, expect } from 'vitest'
import { formatBytes } from './socks5.js'

describe('formatBytes', () => {
  it('formats small and large sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toMatch(/KB/)
    expect(formatBytes(2 * 1024 * 1024)).toMatch(/MB/)
  })
})
