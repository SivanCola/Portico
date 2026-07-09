import { describe, it, expect } from 'vitest'
import {
  sanitizeSessionName,
  parseListSessions,
  buildEnterShellCommand,
  buildAttachCommand,
  normalizeTmuxPrefs,
  shQuote
} from './tmux.js'

describe('sanitizeSessionName', () => {
  it('strips unsafe characters', () => {
    expect(sanitizeSessionName('my session!')).toBe('my-session')
    expect(sanitizeSessionName('../../../etc')).toBe('etc')
  })
  it('falls back to portico', () => {
    expect(sanitizeSessionName('@@@')).toBe('portico')
  })
})

describe('parseListSessions', () => {
  it('parses tab format', () => {
    const list = parseListSessions('work\t3\t1\nportico\t1\t0\n')
    expect(list).toEqual([
      { name: 'work', windows: 3, attached: true },
      { name: 'portico', windows: 1, attached: false }
    ])
  })
})

describe('buildEnterShellCommand', () => {
  it('returns null for off', () => {
    expect(buildEnterShellCommand({ mode: 'off', sessionName: 'x' })).toBeNull()
  })
  it('includes attach-or-new for always', () => {
    const cmd = buildEnterShellCommand({ mode: 'always', sessionName: 'portico' })
    expect(cmd).toContain('tmux new')
    expect(cmd).toContain('tmux attach')
    expect(cmd).toContain(shQuote('portico'))
  })
  it('attach-if-exists does not create', () => {
    const cmd = buildEnterShellCommand({ mode: 'attach-if-exists', sessionName: 's' })!
    expect(cmd).toContain('has-session')
    expect(cmd).not.toContain('tmux new')
  })
})

describe('buildAttachCommand', () => {
  it('quotes the session name', () => {
    expect(buildAttachCommand('a b')).toContain(shQuote('a-b'))
  })
})

describe('normalizeTmuxPrefs', () => {
  it('defaults mode to off', () => {
    expect(normalizeTmuxPrefs({}).mode).toBe('off')
  })
})
