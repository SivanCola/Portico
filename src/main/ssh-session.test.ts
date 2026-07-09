import { describe, it, expect, vi } from 'vitest'
import { homedir } from 'node:os'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (key: string) => `/tmp/fake-${key}`,
    getVersion: () => '0.1.0'
  }
}))

const { expandHomePath } = await import('./ssh-session.js')

describe('expandHomePath', () => {
  it('expands bare ~ to homedir', () => {
    expect(expandHomePath('~')).toBe(homedir())
  })

  it('expands ~/... paths', () => {
    expect(expandHomePath('~/.ssh/id_ed25519')).toBe(`${homedir()}/.ssh/id_ed25519`)
  })

  it('leaves absolute paths unchanged', () => {
    expect(expandHomePath('/Users/me/.ssh/id_rsa')).toBe('/Users/me/.ssh/id_rsa')
  })

  it('leaves relative paths unchanged', () => {
    expect(expandHomePath('keys/id_rsa')).toBe('keys/id_rsa')
  })
})
