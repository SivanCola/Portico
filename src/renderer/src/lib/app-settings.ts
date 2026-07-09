/**
 * App-wide preferences (renderer-only, localStorage).
 * Terminal appearance lives in `terminal-settings.ts`.
 * Runtime L2 flags are also pushed to main via setFeatureFlags.
 */
import type { AppLocale } from '../i18n/locales.js'
import { isAppLocale } from '../i18n/locales.js'

export interface AppSettings {
  /** UI language: system | en | zh-CN */
  locale: AppLocale
  /**
   * When true, ⌘⇧V / Paste image skips the prompt dialog and uses
   * `defaultPastePrompt` immediately.
   */
  skipPastePrompt: boolean
  /** Default prompt text for image paste / upload inject. */
  defaultPastePrompt: string
  /** Confirm before clearing the remote blob cache. */
  confirmClearCache: boolean
  /**
   * Terminal-only mode: disable image bridge, port forwards, provider auto-detect.
   * SSH PTY remains fully functional.
   */
  terminalOnly: boolean
  /** Image paste / SFTP upload (ignored when terminalOnly). */
  enableImageBridge: boolean
  /** Local port forwards (ignored when terminalOnly). */
  enablePortForwards: boolean
  /** Auto-detect Claude/Codex from output (ignored when terminalOnly). */
  enableProviderDetect: boolean
  /** Auto-update checks (main UpdateService). */
  enableAutoUpdate: boolean
  /**
   * Remote tmux after SSH connect:
   * - off: plain shell
   * - attach-if-exists: attach only when session already exists
   * - always: attach or create sessionName
   */
  tmuxMode: 'off' | 'attach-if-exists' | 'always'
  /** Default tmux session name for auto-enter / palette actions. */
  tmuxSessionName: string
  /**
   * Sync remote copy to the Mac clipboard:
   * - accept OSC 52 from the remote PTY
   * - on connect, try `tmux set-option -g set-clipboard on` (no conf edit)
   */
  syncRemoteClipboard: boolean
}

export const APP_SETTINGS_KEY = 'portico.appSettings'
/** Bump when shape changes so normalize can migrate. */
export const APP_SETTINGS_VERSION = 5

export const DEFAULT_APP_SETTINGS: AppSettings = {
  locale: 'system',
  skipPastePrompt: false,
  defaultPastePrompt: 'Analyze this image',
  confirmClearCache: true,
  terminalOnly: false,
  enableImageBridge: true,
  enablePortForwards: true,
  enableProviderDetect: true,
  enableAutoUpdate: true,
  tmuxMode: 'off',
  tmuxSessionName: 'portico',
  syncRemoteClipboard: true
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_APP_SETTINGS }
    return normalizeAppSettings(JSON.parse(raw) as Partial<AppSettings> & { version?: number })
  } catch {
    return { ...DEFAULT_APP_SETTINGS }
  }
}

export function saveAppSettings(s: AppSettings): void {
  try {
    localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({ ...normalizeAppSettings(s), version: APP_SETTINGS_VERSION })
    )
  } catch {
    /* ignore */
  }
}

export function normalizeAppSettings(
  partial: Partial<AppSettings> & { version?: number }
): AppSettings {
  const prompt =
    typeof partial.defaultPastePrompt === 'string' && partial.defaultPastePrompt.trim()
      ? partial.defaultPastePrompt.trim()
      : DEFAULT_APP_SETTINGS.defaultPastePrompt

  const terminalOnly = partial.terminalOnly ?? DEFAULT_APP_SETTINGS.terminalOnly

  // Terminal-only forces L2 off regardless of individual toggles.
  const enableImageBridge = terminalOnly
    ? false
    : (partial.enableImageBridge ?? DEFAULT_APP_SETTINGS.enableImageBridge)
  const enablePortForwards = terminalOnly
    ? false
    : (partial.enablePortForwards ?? DEFAULT_APP_SETTINGS.enablePortForwards)
  const enableProviderDetect = terminalOnly
    ? false
    : (partial.enableProviderDetect ?? DEFAULT_APP_SETTINGS.enableProviderDetect)

  const tmuxMode =
    partial.tmuxMode === 'always' ||
    partial.tmuxMode === 'attach-if-exists' ||
    partial.tmuxMode === 'off'
      ? partial.tmuxMode
      : DEFAULT_APP_SETTINGS.tmuxMode
  const tmuxSessionName = sanitizeTmuxName(
    typeof partial.tmuxSessionName === 'string'
      ? partial.tmuxSessionName
      : DEFAULT_APP_SETTINGS.tmuxSessionName
  )

  const locale = isAppLocale(partial.locale) ? partial.locale : DEFAULT_APP_SETTINGS.locale

  return {
    locale,
    skipPastePrompt: partial.skipPastePrompt ?? DEFAULT_APP_SETTINGS.skipPastePrompt,
    defaultPastePrompt: prompt,
    confirmClearCache: partial.confirmClearCache ?? DEFAULT_APP_SETTINGS.confirmClearCache,
    terminalOnly,
    enableImageBridge,
    enablePortForwards,
    enableProviderDetect,
    enableAutoUpdate: partial.enableAutoUpdate ?? DEFAULT_APP_SETTINGS.enableAutoUpdate,
    tmuxMode,
    tmuxSessionName,
    syncRemoteClipboard:
      partial.syncRemoteClipboard ?? DEFAULT_APP_SETTINGS.syncRemoteClipboard
  }
}

function sanitizeTmuxName(raw: string): string {
  const s = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
  return s || 'portico'
}

/** Map app settings → main-process tmux prefs. */
export function toTmuxPrefs(s: AppSettings): {
  mode: AppSettings['tmuxMode']
  sessionName: string
  syncRemoteClipboard: boolean
} {
  const n = normalizeAppSettings(s)
  return {
    mode: n.tmuxMode,
    sessionName: n.tmuxSessionName,
    syncRemoteClipboard: n.syncRemoteClipboard
  }
}

/** Map app settings → main-process feature flags. */
export function toFeatureFlags(s: AppSettings): {
  imageBridge: boolean
  portForwards: boolean
  providerDetect: boolean
  autoUpdate: boolean
} {
  const n = normalizeAppSettings(s)
  return {
    imageBridge: n.enableImageBridge,
    portForwards: n.enablePortForwards,
    providerDetect: n.enableProviderDetect,
    autoUpdate: n.enableAutoUpdate
  }
}
