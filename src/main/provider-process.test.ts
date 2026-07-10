import { describe, it, expect } from 'vitest'
import { classifyCommandLine } from './provider-process.js'

describe('classifyCommandLine', () => {
  it('detects claude binary', () => {
    expect(classifyCommandLine('/usr/local/bin/claude')).toBe('claude')
    expect(classifyCommandLine('node /Users/x/.npm/claude-code/cli.js')).toBe('claude')
  })

  it('detects codex binary', () => {
    expect(classifyCommandLine('codex')).toBe('codex')
    expect(classifyCommandLine('/opt/homebrew/bin/codex resume')).toBe('codex')
  })

  it('ignores unrelated processes', () => {
    expect(classifyCommandLine('zsh')).toBeUndefined()
    expect(classifyCommandLine('node server.js')).toBeUndefined()
  })
})
