import { describe, it, expect } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  SESSION_RAIL_WIDTH,
  TOOL_SIDEBAR_WIDTH,
  clampSessionRailWidth,
  clampToolSidebarWidth,
  isToolSidebarVisible,
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

  it('defaults showToolSidebar to true', () => {
    expect(DEFAULT_APP_SETTINGS.showToolSidebar).toBe(true)
    expect(normalizeAppSettings({}).showToolSidebar).toBe(true)
    expect(normalizeAppSettings({ showToolSidebar: false }).showToolSidebar).toBe(false)
  })

  it('defaults showTermToolbar to true', () => {
    expect(DEFAULT_APP_SETTINGS.showTermToolbar).toBe(true)
    expect(normalizeAppSettings({}).showTermToolbar).toBe(true)
    expect(normalizeAppSettings({ showTermToolbar: false }).showTermToolbar).toBe(false)
  })

  it('defaults defaultSessionKind to local', () => {
    expect(DEFAULT_APP_SETTINGS.defaultSessionKind).toBe('local')
    expect(normalizeAppSettings({}).defaultSessionKind).toBe('local')
    expect(normalizeAppSettings({ defaultSessionKind: 'ask' }).defaultSessionKind).toBe('ask')
    expect(normalizeAppSettings({ defaultSessionKind: 'ssh' }).defaultSessionKind).toBe('ssh')
  })

  it('defaults restoreSessionsOnLaunch to true', () => {
    expect(DEFAULT_APP_SETTINGS.restoreSessionsOnLaunch).toBe(true)
    expect(normalizeAppSettings({}).restoreSessionsOnLaunch).toBe(true)
    expect(normalizeAppSettings({ restoreSessionsOnLaunch: false }).restoreSessionsOnLaunch).toBe(
      false
    )
  })

  it('isToolSidebarVisible respects toggle and L2 features', () => {
    expect(isToolSidebarVisible(DEFAULT_APP_SETTINGS)).toBe(true)
    expect(isToolSidebarVisible({ ...DEFAULT_APP_SETTINGS, showToolSidebar: false })).toBe(false)
    expect(
      isToolSidebarVisible({
        ...DEFAULT_APP_SETTINGS,
        showToolSidebar: true,
        enableImageBridge: false,
        enablePortForwards: false
      })
    ).toBe(false)
    expect(
      isToolSidebarVisible({
        ...DEFAULT_APP_SETTINGS,
        showToolSidebar: true,
        enableImageBridge: false,
        enablePortForwards: true
      })
    ).toBe(true)
    expect(
      isToolSidebarVisible({
        ...DEFAULT_APP_SETTINGS,
        terminalOnly: true,
        showToolSidebar: true
      })
    ).toBe(false)
  })

  it('clamps and defaults panel widths', () => {
    expect(DEFAULT_APP_SETTINGS.sessionRailWidth).toBe(SESSION_RAIL_WIDTH.default)
    expect(DEFAULT_APP_SETTINGS.toolSidebarWidth).toBe(TOOL_SIDEBAR_WIDTH.default)
    expect(normalizeAppSettings({}).sessionRailWidth).toBe(SESSION_RAIL_WIDTH.default)
    expect(normalizeAppSettings({ sessionRailWidth: 50 }).sessionRailWidth).toBe(
      SESSION_RAIL_WIDTH.min
    )
    expect(normalizeAppSettings({ sessionRailWidth: 9999 }).sessionRailWidth).toBe(
      SESSION_RAIL_WIDTH.max
    )
    expect(normalizeAppSettings({ toolSidebarWidth: 10 }).toolSidebarWidth).toBe(
      TOOL_SIDEBAR_WIDTH.min
    )
    expect(normalizeAppSettings({ toolSidebarWidth: 900 }).toolSidebarWidth).toBe(
      TOOL_SIDEBAR_WIDTH.max
    )
    expect(clampSessionRailWidth(NaN)).toBe(SESSION_RAIL_WIDTH.default)
    expect(clampToolSidebarWidth(Number.POSITIVE_INFINITY)).toBe(TOOL_SIDEBAR_WIDTH.default)
    expect(normalizeAppSettings({ sessionRailWidth: 280 }).sessionRailWidth).toBe(280)
  })
})
