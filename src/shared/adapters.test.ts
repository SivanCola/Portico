import { describe, it, expect } from 'vitest'
import {
  ADAPTERS,
  claudeAdapter,
  codexAdapter,
  detectProvider,
  formatForProvider,
  shellAdapter
} from './adapters.js'
import type { ProviderSession } from './types.js'

const interactive = (overrides: Partial<ProviderSession> = {}): ProviderSession => ({
  provider: 'shell',
  interactive: true,
  nativePasteAvailable: false,
  ...overrides
})

const PATH = '~/.portico/blobs/abc123.png'

describe('claude adapter', () => {
  it('formats a natural-language prompt with the remote path', () => {
    expect(claudeAdapter.formatImageReference(PATH, 'Analyze this image', interactive())).toBe(
      'Analyze this image: ~/.portico/blobs/abc123.png'
    )
  })

  it('falls back to a default prompt when none is supplied', () => {
    expect(claudeAdapter.formatImageReference(PATH, undefined, interactive())).toBe(
      'Analyze this image: ~/.portico/blobs/abc123.png'
    )
  })

  it('lists multiple remote paths on separate lines', () => {
    const paths = [PATH, '~/.portico/blobs/def456.png']
    expect(claudeAdapter.formatImageReference(paths, 'Compare', interactive())).toBe(
      'Compare:\n~/.portico/blobs/abc123.png\n~/.portico/blobs/def456.png'
    )
  })

  it('defaults multi-image prompt wording when none is supplied', () => {
    const paths = [PATH, '~/.portico/blobs/def456.png']
    expect(claudeAdapter.formatImageReference(paths, undefined, interactive())).toBe(
      'Analyze these images:\n~/.portico/blobs/abc123.png\n~/.portico/blobs/def456.png'
    )
  })

  it('upgrades stock singular prompt to multi when many paths', () => {
    const paths = [PATH, '~/.portico/blobs/def456.png']
    expect(claudeAdapter.formatImageReference(paths, 'Analyze this image', interactive())).toBe(
      'Analyze these images:\n~/.portico/blobs/abc123.png\n~/.portico/blobs/def456.png'
    )
  })

  it('does not claim native clipboard paste support', () => {
    expect(claudeAdapter.supportsNativeImagePaste(interactive())).toBe(false)
  })
})

describe('codex adapter', () => {
  it('uses codex -i <path> in command (non-interactive) mode', () => {
    const out = codexAdapter.formatImageReference(PATH, 'Fix the logo', interactive({ provider: 'codex', interactive: false }))
    expect(out).toBe('codex -i ~/.portico/blobs/abc123.png "Fix the logo"')
  })

  it('uses multiple -i flags for multi-image non-interactive mode', () => {
    const paths = [PATH, '~/.portico/blobs/def456.png']
    const out = codexAdapter.formatImageReference(
      paths,
      'Compare',
      interactive({ provider: 'codex', interactive: false })
    )
    expect(out).toBe(
      'codex -i ~/.portico/blobs/abc123.png -i ~/.portico/blobs/def456.png "Compare"'
    )
  })

  it('escapes embedded double quotes in the prompt', () => {
    const out = codexAdapter.formatImageReference(
      PATH,
      'say "hi"',
      interactive({ provider: 'codex', interactive: false })
    )
    expect(out).toBe('codex -i ~/.portico/blobs/abc123.png "say \\"hi\\""')
  })

  it('uses the path-based fallback inside an interactive session', () => {
    const out = codexAdapter.formatImageReference(PATH, 'Look here', interactive({ provider: 'codex' }))
    expect(out).toBe('Look here: ~/.portico/blobs/abc123.png')
  })

  it('lists multiple paths interactively without nesting codex', () => {
    const paths = [PATH, '~/.portico/blobs/def456.png']
    const out = codexAdapter.formatImageReference(paths, 'Look', interactive({ provider: 'codex' }))
    expect(out).toBe('Look:\n~/.portico/blobs/abc123.png\n~/.portico/blobs/def456.png')
    expect(out.startsWith('codex ')).toBe(false)
  })

  it('does not emit a nested codex command interactively', () => {
    const out = codexAdapter.formatImageReference(PATH, 'x', interactive({ provider: 'codex' }))
    expect(out.startsWith('codex ')).toBe(false)
  })
})

describe('shell adapter', () => {
  it('emits a comment with the path when no prompt', () => {
    expect(shellAdapter.formatImageReference(PATH, undefined, interactive())).toBe(
      `# image uploaded to ${PATH}`
    )
  })

  it('includes the prompt as a comment header', () => {
    expect(shellAdapter.formatImageReference(PATH, 'note this', interactive())).toBe(
      `# note this\n# image: ${PATH}`
    )
  })

  it('lists each path as a comment for multi-image', () => {
    const paths = [PATH, '~/.portico/blobs/def456.png']
    expect(shellAdapter.formatImageReference(paths, 'batch', interactive())).toBe(
      `# batch\n# image: ${PATH}\n# image: ~/.portico/blobs/def456.png`
    )
  })
})

describe('detectProvider', () => {
  it('detects claude from banner output', () => {
    expect(
      detectProvider({ recentOutput: ['Welcome to Claude Code v1.2.3', '> '], currentLine: '' })
    ).toBe('claude')
  })

  it('detects codex from process name', () => {
    expect(detectProvider({ recentOutput: [], currentLine: '', processName: 'codex' })).toBe('codex')
  })

  it('falls back to shell when nothing matches', () => {
    expect(detectProvider({ recentOutput: ['ubuntu@host:~$ '], currentLine: '' })).toBe('shell')
  })

  it('ignores casual mentions without a strong banner', () => {
    expect(
      detectProvider({ recentOutput: ['claude and codex mentioned'], currentLine: '' })
    ).toBe('shell')
  })

  it('prefers the more recent banner when both appear', () => {
    expect(
      detectProvider({
        recentOutput: ['Welcome to Claude Code v1.2.3', 'OpenAI Codex v0.1.0'],
        currentLine: ''
      })
    ).toBe('codex')
    expect(
      detectProvider({
        recentOutput: ['OpenAI Codex v0.1.0', 'Welcome to Claude Code v1.2.3'],
        currentLine: ''
      })
    ).toBe('claude')
  })

  it('returns shell after shell prompt when AI UI is gone', () => {
    expect(
      detectProvider({
        recentOutput: [
          'Welcome to Claude Code v1.2.3',
          'some work',
          'ubuntu@host:~$ '
        ],
        currentLine: ''
      })
    ).toBe('shell')
  })

  it('uses processHint claude over shell-looking output', () => {
    expect(
      detectProvider({
        recentOutput: ['ubuntu@host:~$ '],
        currentLine: '',
        processHint: 'claude'
      })
    ).toBe('claude')
  })

  it('processHint none forces shell even if old banner remains', () => {
    expect(
      detectProvider({
        recentOutput: ['Welcome to Claude Code v1.2.3', 'ubuntu@host:~$ '],
        currentLine: '',
        processHint: 'none'
      })
    ).toBe('shell')
  })
})

describe('formatForProvider dispatch', () => {
  it('routes to the right adapter by id', () => {
    const s = interactive()
    expect(formatForProvider('claude', PATH, 'p', s)).toBe(`p: ${PATH}`)
    expect(formatForProvider('codex', PATH, 'p', { ...s, interactive: false })).toBe(
      `codex -i ${PATH} "p"`
    )
    expect(ADAPTERS.shell.formatImageReference(PATH, undefined, s)).toBe(`# image uploaded to ${PATH}`)
  })
})
