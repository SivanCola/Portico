import { describe, it, expect } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  toFeatureFlags
} from './app-settings.js'

describe('normalizeAppSettings', () => {
  it('fills defaults', () => {
    expect(normalizeAppSettings({})).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('accepts locale prefs', () => {
    expect(normalizeAppSettings({ locale: 'zh-CN' }).locale).toBe('zh-CN')
    expect(normalizeAppSettings({ locale: 'nope' as never }).locale).toBe('system')
  })

  it('keeps custom prompt and flags', () => {
    const s = normalizeAppSettings({
      skipPastePrompt: true,
      defaultPastePrompt: '  Look at this  ',
      confirmClearCache: false
    })
    expect(s.skipPastePrompt).toBe(true)
    expect(s.defaultPastePrompt).toBe('Look at this')
    expect(s.confirmClearCache).toBe(false)
  })

  it('falls back empty prompt to default', () => {
    expect(normalizeAppSettings({ defaultPastePrompt: '   ' }).defaultPastePrompt).toBe(
      DEFAULT_APP_SETTINGS.defaultPastePrompt
    )
  })

  it('terminalOnly forces L2 features off', () => {
    const s = normalizeAppSettings({
      terminalOnly: true,
      enableImageBridge: true,
      enablePortForwards: true,
      enableProviderDetect: true
    })
    expect(s.enableImageBridge).toBe(false)
    expect(s.enablePortForwards).toBe(false)
    expect(s.enableProviderDetect).toBe(false)
    expect(toFeatureFlags(s).imageBridge).toBe(false)
  })

  it('normalizes tmux prefs', () => {
    const s = normalizeAppSettings({
      tmuxMode: 'always',
      tmuxSessionName: 'my session!'
    })
    expect(s.tmuxMode).toBe('always')
    expect(s.tmuxSessionName).toBe('my-session')
  })

  it('defaults syncRemoteClipboard to true', () => {
    expect(DEFAULT_APP_SETTINGS.syncRemoteClipboard).toBe(true)
    expect(normalizeAppSettings({}).syncRemoteClipboard).toBe(true)
    expect(normalizeAppSettings({ syncRemoteClipboard: false }).syncRemoteClipboard).toBe(false)
  })
})
