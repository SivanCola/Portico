import { useEffect, useState } from 'react'
import type { AppInfo, UpdateStatus } from '@shared/types.js'
import type { TerminalSettings, TermThemeId } from '../lib/terminal-settings.js'
import {
  DEFAULT_SETTINGS as DEFAULT_TERM,
  FONT_PRESETS,
  TERM_THEMES
} from '../lib/terminal-settings.js'
import type { AppSettings } from '../lib/app-settings.js'
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from '../lib/app-settings.js'

export type SettingsSection = 'general' | 'terminal' | 'tmux' | 'image' | 'about'

const SECTIONS: { id: SettingsSection; label: string; hint: string }[] = [
  { id: 'general', label: 'General', hint: 'App behavior' },
  { id: 'terminal', label: 'Terminal', hint: 'Theme, font, WebGL' },
  { id: 'tmux', label: 'tmux', hint: 'Remote session reuse' },
  { id: 'image', label: 'Image bridge', hint: 'Paste & upload' },
  { id: 'about', label: 'About', hint: 'Version & updates' }
]

interface Props {
  open: boolean
  section?: SettingsSection
  onSectionChange?: (s: SettingsSection) => void
  onClose: () => void
  // Terminal
  termSettings: TerminalSettings
  onTermChange: (next: TerminalSettings) => void
  // App
  appSettings: AppSettings
  onAppChange: (next: AppSettings) => void
  // About
  appInfo: AppInfo | null
  updateStatus: UpdateStatus | null
  onCheckUpdates: () => void
  onInstallUpdate: () => void
}

export function SettingsCenter({
  open,
  section: controlledSection,
  onSectionChange,
  onClose,
  termSettings,
  onTermChange,
  appSettings,
  onAppChange,
  appInfo,
  updateStatus,
  onCheckUpdates,
  onInstallUpdate
}: Props) {
  const [localSection, setLocalSection] = useState<SettingsSection>('general')
  const section = controlledSection ?? localSection
  const setSection = (s: SettingsSection) => {
    onSectionChange?.(s)
    setLocalSection(s)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const setTerm = <K extends keyof TerminalSettings>(key: K, v: TerminalSettings[K]) => {
    onTermChange({ ...termSettings, [key]: v })
  }
  const setApp = <K extends keyof AppSettings>(key: K, v: AppSettings[K]) => {
    onAppChange({ ...appSettings, [key]: v })
  }

  return (
    <div className="modal-backdrop settings-backdrop" onClick={onClose}>
      <div
        className="settings-center"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <aside className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`settings-nav-item ${section === s.id ? 'active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <span className="settings-nav-label">{s.label}</span>
              <span className="settings-nav-hint">{s.hint}</span>
            </button>
          ))}
        </aside>

        <div className="settings-main">
          <header className="settings-main-header">
            <h2>{SECTIONS.find((s) => s.id === section)?.label ?? 'Settings'}</h2>
            <button type="button" className="btn ghost settings-close" onClick={onClose} title="Close">
              ✕
            </button>
          </header>

          <div className="settings-body">
            {section === 'general' && (
              <section className="settings-section">
                <p className="settings-lead">
                  Stability and app behavior. Preferences are stored on this device and
                  synced to the main process for L2 feature isolation.
                </p>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={appSettings.terminalOnly}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onAppChange(
                          normalizeAppSettings({ ...appSettings, terminalOnly: true })
                        )
                      } else {
                        // Leaving terminal-only re-enables L2 defaults.
                        onAppChange(
                          normalizeAppSettings({
                            ...appSettings,
                            terminalOnly: false,
                            enableImageBridge: true,
                            enablePortForwards: true,
                            enableProviderDetect: true
                          })
                        )
                      }
                    }}
                  />
                  <span>
                    Terminal only mode
                    <em>
                      Disable image bridge, port forwards, and provider auto-detect. SSH
                      terminal stays fully functional.
                    </em>
                  </span>
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={appSettings.enableAutoUpdate}
                    onChange={(e) => setApp('enableAutoUpdate', e.target.checked)}
                  />
                  <span>
                    Automatic update checks
                    <em>When off, Portico will not contact the update feed</em>
                  </span>
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={appSettings.confirmClearCache}
                    onChange={(e) => setApp('confirmClearCache', e.target.checked)}
                  />
                  <span>
                    Confirm before clearing remote image cache
                    <em>Ask once before deleting ~/.portico*/blobs</em>
                  </span>
                </label>
                {!appSettings.terminalOnly && (
                  <>
                    <div className="settings-note">Optional L2 capabilities (safe to disable):</div>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={appSettings.enableImageBridge}
                        onChange={(e) => setApp('enableImageBridge', e.target.checked)}
                      />
                      <span>Image paste / upload bridge</span>
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={appSettings.enablePortForwards}
                        onChange={(e) => setApp('enablePortForwards', e.target.checked)}
                      />
                      <span>Port forwarding</span>
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={appSettings.enableProviderDetect}
                        onChange={(e) => setApp('enableProviderDetect', e.target.checked)}
                      />
                      <span>Auto-detect Claude / Codex from output</span>
                    </label>
                  </>
                )}
                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      onAppChange({ ...DEFAULT_APP_SETTINGS })
                      onTermChange({ ...DEFAULT_TERM })
                    }}
                  >
                    Reset all settings
                  </button>
                </div>
              </section>
            )}

            {section === 'terminal' && (
              <section className="settings-section">
                <p className="settings-lead">
                  Appearance and rendering for the SSH terminal session.
                </p>

                <label className="settings-field">
                  <span>Theme</span>
                  <select
                    value={termSettings.themeId}
                    onChange={(e) => setTerm('themeId', e.target.value as TermThemeId)}
                  >
                    {(Object.keys(TERM_THEMES) as TermThemeId[]).map((id) => (
                      <option key={id} value={id}>
                        {TERM_THEMES[id].label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="settings-field">
                  <span>Font</span>
                  <select
                    value={
                      FONT_PRESETS.find((p) => p.value === termSettings.fontFamily)?.id ?? 'custom'
                    }
                    onChange={(e) => {
                      const preset = FONT_PRESETS.find((p) => p.id === e.target.value)
                      if (preset) setTerm('fontFamily', preset.value)
                    }}
                  >
                    {FONT_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    {!FONT_PRESETS.some((p) => p.value === termSettings.fontFamily) && (
                      <option value="custom">Custom</option>
                    )}
                  </select>
                </label>

                <label className="settings-field">
                  <span>Font size ({termSettings.fontSize}px)</span>
                  <input
                    type="range"
                    min={10}
                    max={22}
                    step={1}
                    value={termSettings.fontSize}
                    onChange={(e) => setTerm('fontSize', Number(e.target.value))}
                  />
                </label>

                <label className="settings-field">
                  <span>Line height ({termSettings.lineHeight.toFixed(1)})</span>
                  <input
                    type="range"
                    min={1}
                    max={1.8}
                    step={0.1}
                    value={termSettings.lineHeight}
                    onChange={(e) => setTerm('lineHeight', Number(e.target.value))}
                  />
                </label>

                <label className="settings-field">
                  <span>Scrollback lines</span>
                  <input
                    type="number"
                    min={1000}
                    max={50000}
                    step={1000}
                    value={termSettings.scrollback}
                    onChange={(e) => setTerm('scrollback', Number(e.target.value))}
                  />
                </label>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={termSettings.copyOnSelect}
                    onChange={(e) => setTerm('copyOnSelect', e.target.checked)}
                  />
                  <span>
                    Copy on select
                    <em>Automatically copy selected text to the clipboard</em>
                  </span>
                </label>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={termSettings.webgl}
                    onChange={(e) => setTerm('webgl', e.target.checked)}
                  />
                  <span>
                    WebGL renderer
                    <em>Faster full-screen TUI; reconnect if the GPU context is lost</em>
                  </span>
                </label>

                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => onTermChange({ ...DEFAULT_TERM })}
                  >
                    Reset terminal defaults
                  </button>
                </div>
              </section>
            )}

            {section === 'tmux' && (
              <section className="settings-section">
                <p className="settings-lead">
                  Reuse remote sessions with tmux so SSH disconnects do not kill Claude or long jobs.
                  Portico only shells out to the remote <code>tmux</code> CLI — it does not replace tmux.
                </p>

                <label className="settings-field">
                  <span>After connect</span>
                  <select
                    value={appSettings.tmuxMode}
                    onChange={(e) =>
                      setApp(
                        'tmuxMode',
                        e.target.value as AppSettings['tmuxMode']
                      )
                    }
                  >
                    <option value="off">Off — plain shell</option>
                    <option value="attach-if-exists">
                      Attach if session exists
                    </option>
                    <option value="always">Always attach or create</option>
                  </select>
                </label>

                <label className="settings-field">
                  <span>Default session name</span>
                  <input
                    type="text"
                    value={appSettings.tmuxSessionName}
                    onChange={(e) => setApp('tmuxSessionName', e.target.value)}
                    placeholder="portico"
                    spellCheck={false}
                  />
                </label>

                <div className="settings-note">
                  <strong>Tips</strong>
                  <ul className="settings-list">
                    <li>
                      Detach with tmux prefix (usually <kbd>Ctrl-b</kbd> then <kbd>d</kbd>) — Portico
                      shortcuts use ⌘ and never steal the prefix.
                    </li>
                    <li>
                      After reconnect, auto-enter runs again so you land back in the same session when
                      mode is not Off.
                    </li>
                    <li>
                      Command palette: list sessions, attach, or create new. Requires tmux on the remote
                      PATH.
                    </li>
                  </ul>
                </div>
              </section>
            )}

            {section === 'image' && (
              <section className="settings-section">
                <p className="settings-lead">
                  How clipboard and file images are uploaded and injected into the remote AI.
                </p>

                <label className="settings-field">
                  <span>Default paste prompt</span>
                  <input
                    type="text"
                    value={appSettings.defaultPastePrompt}
                    onChange={(e) => setApp('defaultPastePrompt', e.target.value)}
                    placeholder="Analyze this image"
                    spellCheck={false}
                  />
                </label>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={appSettings.skipPastePrompt}
                    onChange={(e) => setApp('skipPastePrompt', e.target.checked)}
                  />
                  <span>
                    Skip prompt dialog on paste
                    <em>⌘⇧V uploads immediately with the default prompt</em>
                  </span>
                </label>

                <div className="settings-note">
                  Images are uploaded to <code>~/.portico*/blobs</code> on the remote host, then a
                  path reference is injected into the terminal for Claude / Codex / shell.
                </div>
              </section>
            )}

            {section === 'about' && (
              <section className="settings-section">
                <div className="settings-about-card">
                  <div className="settings-about-name">{appInfo?.name ?? 'Portico'}</div>
                  <div className="settings-about-meta">
                    <span>Version {appInfo?.version ?? '—'}</span>
                    <span className="dot-sep">·</span>
                    <span className="cap">{appInfo?.releaseChannel ?? 'stable'}</span>
                    <span className="dot-sep">·</span>
                    <span>Update feed: {appInfo?.updateChannel ?? '—'}</span>
                  </div>
                  {appInfo?.isPackaged === false && (
                    <div className="settings-note">Running in development (updates disabled).</div>
                  )}
                </div>

                <div className="settings-field">
                  <span>Updates</span>
                  <div className="settings-about-update">
                    <span className="settings-update-state">
                      {formatUpdateStatus(updateStatus)}
                    </span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={onCheckUpdates}
                      disabled={
                        updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'
                      }
                    >
                      Check for updates
                    </button>
                    {updateStatus?.state === 'downloaded' && (
                      <button type="button" className="btn primary" onClick={onInstallUpdate}>
                        Restart to install
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-note">
                  Keyboard: <kbd>⌘V</kbd> text paste · <kbd>⌘⇧V</kbd> image bridge ·{' '}
                  <kbd>⌘,</kbd> settings · <kbd>⌘⇧P</kbd> palette · <kbd>⌘F</kbd> find
                  <br />
                  Recommended flow: Portico SSH → tmux session → Claude. Disconnect only drops SSH;
                  tmux keeps remote work alive.
                </div>
              </section>
            )}
          </div>

          <footer className="settings-footer">
            <button type="button" className="btn primary" onClick={onClose}>
              Done
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}

function formatUpdateStatus(s: UpdateStatus | null): string {
  if (!s) return 'Idle'
  switch (s.state) {
    case 'idle':
      return 'Idle'
    case 'checking':
      return 'Checking…'
    case 'available':
      return s.version ? `Update ${s.version} available` : 'Update available'
    case 'downloading':
      return s.percent != null ? `Downloading… ${Math.round(s.percent)}%` : 'Downloading…'
    case 'downloaded':
      return s.version ? `${s.version} ready to install` : 'Update ready'
    case 'not-available':
      return s.message ?? 'Up to date'
    case 'error':
      return s.message ?? 'Update error'
    default:
      return s.state
  }
}
