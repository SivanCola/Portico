import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  xtermTheme
} from './terminal-settings.js'

describe('normalizeSettings', () => {
  it('fills defaults for empty input', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps font size and scrollback', () => {
    const s = normalizeSettings({ fontSize: 99, scrollback: 10 })
    expect(s.fontSize).toBe(28)
    expect(s.scrollback).toBe(1000)
  })

  it('rejects unknown theme ids', () => {
    const s = normalizeSettings({ themeId: 'nope' as never })
    expect(s.themeId).toBe('portico')
  })
})

describe('xtermTheme', () => {
  it('returns a theme with background', () => {
    expect(xtermTheme('dracula').background).toBeTruthy()
    expect(xtermTheme('portico').foreground).toBeTruthy()
  })
})
