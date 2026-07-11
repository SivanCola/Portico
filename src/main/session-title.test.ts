import { describe, it, expect } from 'vitest'
import {
  composeSessionTitle,
  parseClaudeWorkContext,
  shortenSlug,
  isGenericHostTitle
} from './session-title.js'

describe('parseClaudeWorkContext', () => {
  it('parses Claude status name@wtN', () => {
    expect(
      parseClaudeWorkContext([
        'noise',
        'Fable 5 | stateless-napping-lighthouse@wt1 | 253k/1m (25%) | effort: xhigh'
      ])
    ).toBe('lighthouse@wt1')
  })

  it('parses .claude/worktrees path', () => {
    expect(
      parseClaudeWorkContext([
        'path: /root/DeepSeek-Reasonix/.claude/worktrees/synchron-seeking-thacker'
      ])
    ).toBe('thacker')
  })

  it('returns null without signals', () => {
    expect(parseClaudeWorkContext(['hello world', 'ls -la'])).toBeNull()
  })
})

describe('composeSessionTitle', () => {
  it('combines tmux + work context', () => {
    expect(
      composeSessionTitle({
        hostLabel: 'noban-vm',
        tmuxSession: 'claude2',
        workContext: 'wt1'
      })
    ).toBe('claude2 · wt1')
  })

  it('uses tmux alone when no work context', () => {
    expect(
      composeSessionTitle({
        hostLabel: 'noban-vm-7aafd1-db',
        tmuxSession: 'claude2'
      })
    ).toBe('claude2')
  })

  it('short host + tmux when host is compact', () => {
    expect(
      composeSessionTitle({
        hostLabel: 'noban',
        tmuxSession: 'claude2'
      })
    ).toBe('noban · claude2')
  })

  it('local shell', () => {
    expect(composeSessionTitle({ kind: 'local', localShell: 'zsh' })).toBe('zsh')
  })
})

describe('shortenSlug / isGenericHostTitle', () => {
  it('shortens long hyphenated names', () => {
    expect(shortenSlug('stateless-napping-lighthouse')).toBe('lighthouse')
  })

  it('detects generic host titles', () => {
    expect(isGenericHostTitle('noban-vm', 'noban-vm')).toBe(true)
    expect(isGenericHostTitle('root@10.0.0.1', 'x')).toBe(true)
    expect(isGenericHostTitle('claude2 · wt1', 'noban-vm')).toBe(false)
  })
})
