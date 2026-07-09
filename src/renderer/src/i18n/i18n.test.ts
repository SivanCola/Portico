import { describe, it, expect } from 'vitest'
import { resolveLocale, isAppLocale } from './locales.js'
import { translate } from './messages.js'

describe('resolveLocale', () => {
  it('honors explicit prefs', () => {
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
  })
  it('maps system zh* to zh-CN', () => {
    expect(resolveLocale('system', 'zh-CN')).toBe('zh-CN')
    expect(resolveLocale('system', 'zh-Hans-CN')).toBe('zh-CN')
  })
  it('maps other system languages to en', () => {
    expect(resolveLocale('system', 'en-US')).toBe('en')
    expect(resolveLocale('system', 'ja-JP')).toBe('en')
  })
})

describe('isAppLocale', () => {
  it('validates', () => {
    expect(isAppLocale('zh-CN')).toBe(true)
    expect(isAppLocale('fr')).toBe(false)
  })
})

describe('translate', () => {
  it('returns Chinese for zh-CN', () => {
    expect(translate('zh-CN', 'common.settings')).toBe('设置')
  })
  it('interpolates vars', () => {
    expect(translate('en', 'settings.terminal.fontSize', { n: 14 })).toContain('14')
    expect(translate('zh-CN', 'reconnect.banner', { attempt: 2 })).toContain('2')
  })
})
