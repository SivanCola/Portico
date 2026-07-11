import { describe, it, expect } from 'vitest'
import {
  sanitizeSessionName,
  parseListSessions,
  buildEnterShellCommand,
  buildAttachCommand,
  normalizeTmuxPrefs,
  shQuote,
  parseTmuxSessionFromOutput,
  inferTmuxSessionFromShellLine
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
  it('defaults mode to off and clipboard sync on', () => {
    const p = normalizeTmuxPrefs({})
    expect(p.mode).toBe('off')
    expect(p.syncRemoteClipboard).toBe(true)
  })
})

describe('buildEnableClipboardCommand', () => {
  it('sets set-clipboard on', async () => {
    const { buildEnableClipboardCommand } = await import('./tmux.js')
    expect(buildEnableClipboardCommand()).toContain('set-clipboard on')
  })
})

describe('parseTmuxSessionFromOutput', () => {
  it('reads status-left style [session] N:window', () => {
    expect(
      parseTmuxSessionFromOutput([
        'some chat [optional] text',
        '[claude2] 0:claude* 1:bash-                          "host" 17:21 10-Jul-26'
      ])
    ).toBe('claude2')
  })

  it('ignores bracketed text without window index', () => {
    expect(parseTmuxSessionFromOutput(['see [optional] note and [issue]'])).toBeNull()
  })

  it('strips ANSI color before matching', () => {
    expect(
      parseTmuxSessionFromOutput(['\x1b[42m\x1b[30m[portico] 0:zsh*\x1b[0m'])
    ).toBe('portico')
  })
})

describe('inferTmuxSessionFromShellLine', () => {
  it('parses attach / new variants', () => {
    expect(inferTmuxSessionFromShellLine('tmux attach -t claude2')).toBe('claude2')
    expect(inferTmuxSessionFromShellLine('tmux a -t work')).toBe('work')
    expect(inferTmuxSessionFromShellLine('tmux new -s mysess')).toBe('mysess')
    expect(inferTmuxSessionFromShellLine('ls -la')).toBeNull()
  })
})
