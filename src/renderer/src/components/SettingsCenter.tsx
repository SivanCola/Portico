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
import { useI18n, LOCALE_OPTIONS, type AppLocale } from '../i18n/index.js'

export type SettingsSection = 'general' | 'terminal' | 'tmux' | 'image' | 'about'

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
  const { t } = useI18n()
  const [localSection, setLocalSection] = useState<SettingsSection>('general')
  const section = controlledSection ?? localSection
  const setSection = (s: SettingsSection) => {
    onSectionChange?.(s)
    setLocalSection(s)
  }

  const sections: { id: SettingsSection; label: string; hint: string }[] = [
    { id: 'general', label: t('settings.nav.general'), hint: t('settings.nav.generalHint') },
    { id: 'terminal', label: t('settings.nav.terminal'), hint: t('settings.nav.terminalHint') },
    { id: 'tmux', label: t('settings.nav.tmux'), hint: t('settings.nav.tmuxHint') },
    { id: 'image', label: t('settings.nav.image'), hint: t('settings.nav.imageHint') },
    { id: 'about', label: t('settings.nav.about'), hint: t('settings.nav.aboutHint') }
  ]

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
        aria-label={t('settings.title')}
      >
        <aside className="settings-nav">
          <div className="settings-nav-title">{t('settings.title')}</div>
          {sections.map((s) => (
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
            <h2>{sections.find((s) => s.id === section)?.label ?? t('settings.title')}</h2>
            <button type="button" className="btn ghost settings-close" onClick={onClose} title="Close">
              ✕
            </button>
          </header>

          <div className="settings-body">
            {section === 'general' && (
              <section className="settings-section">
                <p className="settings-lead">{t('settings.general.lead')}</p>
                <div className="settings-field">
                  <span>{t('settings.general.language')}</span>
                  <div className="locale-pills" role="group" aria-label={t('settings.general.language')}>
                    {LOCALE_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={appSettings.locale === o.id ? 'active' : ''}
                        onClick={() => setApp('locale', o.id as AppLocale)}
                      >
                        {t(o.labelKey)}
                      </button>
                    ))}
                  </div>
                  <em className="settings-field-hint">{t('settings.general.languageHint')}</em>
                </div>
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
                    {t('settings.general.terminalOnly')}
                    <em>{t('settings.general.terminalOnlyHint')}</em>
                  </span>
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={appSettings.enableAutoUpdate}
                    onChange={(e) => setApp('enableAutoUpdate', e.target.checked)}
                  />
                  <span>
                    {t('settings.general.autoUpdate')}
                    <em>{t('settings.general.autoUpdateHint')}</em>
                  </span>
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={appSettings.confirmClearCache}
                    onChange={(e) => setApp('confirmClearCache', e.target.checked)}
                  />
                  <span>
                    {t('settings.general.confirmCache')}
                    <em>{t('settings.general.confirmCacheHint')}</em>
                  </span>
                </label>
                <div className="settings-field">
                  <span className="settings-field-label">{t('settings.general.defaultSessionKind')}</span>
                  <div className="locale-pills">
                    {(
                      [
                        ['local', 'settings.general.kindLocal'],
                        ['ssh', 'settings.general.kindSsh'],
                        ['ask', 'settings.general.kindAsk']
                      ] as const
                    ).map(([value, labelKey]) => (
                      <button
                        key={value}
                        type="button"
                        className={appSettings.defaultSessionKind === value ? 'active' : ''}
                        onClick={() => setApp('defaultSessionKind', value)}
                      >
                        {t(labelKey)}
                      </button>
                    ))}
                  </div>
                  <em className="settings-field-hint">{t('settings.general.defaultSessionKindHint')}</em>
                </div>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={appSettings.restoreSessionsOnLaunch}
                    onChange={(e) => {
                      const v = e.target.checked
                      setApp('restoreSessionsOnLaunch', v)
                      void window.portico.setRestoreOnLaunch(v)
                    }}
                  />
                  <span>
                    {t('settings.general.restoreSessions')}
                    <em>{t('settings.general.restoreSessionsHint')}</em>
                  </span>
                </label>
                {!appSettings.terminalOnly && (
                  <>
                    <div className="settings-note">{t('settings.general.l2Note')}</div>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={appSettings.enableImageBridge}
                        onChange={(e) => setApp('enableImageBridge', e.target.checked)}
                      />
                      <span>{t('settings.general.imageBridge')}</span>
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={appSettings.enablePortForwards}
                        onChange={(e) => setApp('enablePortForwards', e.target.checked)}
                      />
                      <span>{t('settings.general.portForwards')}</span>
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={appSettings.showToolSidebar}
                        onChange={(e) => setApp('showToolSidebar', e.target.checked)}
                      />
                      <span>
                        {t('settings.general.showToolSidebar')}
                        <em>{t('settings.general.showToolSidebarHint')}</em>
                      </span>
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={appSettings.enableProviderDetect}
                        onChange={(e) => setApp('enableProviderDetect', e.target.checked)}
                      />
                      <span>{t('settings.general.providerDetect')}</span>
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
                    {t('common.resetAll')}
                  </button>
                </div>
              </section>
            )}

            {section === 'terminal' && (
              <section className="settings-section">
                <p className="settings-lead">{t('settings.terminal.lead')}</p>

                <label className="settings-field">
                  <span>{t('settings.terminal.theme')}</span>
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
                  <span>{t('settings.terminal.font')}</span>
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
                  <span>{t('settings.terminal.fontSize', { n: termSettings.fontSize })}</span>
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
                  <span>{t('settings.terminal.lineHeight', { n: termSettings.lineHeight.toFixed(1) })}</span>
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
                  <span>{t('settings.terminal.scrollback')}</span>
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
                    {t('settings.terminal.copyOnSelect')}
                    <em>{t('settings.terminal.copyOnSelectHint')}</em>
                  </span>
                </label>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={termSettings.webgl}
                    onChange={(e) => setTerm('webgl', e.target.checked)}
                  />
                  <span>
                    {t('settings.terminal.webgl')}
                    <em>{t('settings.terminal.webglHint')}</em>
                  </span>
                </label>

                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => onTermChange({ ...DEFAULT_TERM })}
                  >
                    {t('settings.terminal.reset')}
                  </button>
                </div>
              </section>
            )}

            {section === 'tmux' && (
              <section className="settings-section">
                <p className="settings-lead">{t('settings.tmux.lead')}</p>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={appSettings.syncRemoteClipboard}
                    onChange={(e) => setApp('syncRemoteClipboard', e.target.checked)}
                  />
                  <span>
                    {t('settings.tmux.syncClipboard')}
                    <em>{t('settings.tmux.syncClipboardHint')}</em>
                  </span>
                </label>

                <label className="settings-field">
                  <span>{t('settings.tmux.afterConnect')}</span>
                  <select
                    value={appSettings.tmuxMode}
                    onChange={(e) =>
                      setApp(
                        'tmuxMode',
                        e.target.value as AppSettings['tmuxMode']
                      )
                    }
                  >
                    <option value="off">{t('settings.tmux.modeOff')}</option>
                    <option value="attach-if-exists">{t('settings.tmux.modeAttach')}</option>
                    <option value="always">{t('settings.tmux.modeAlways')}</option>
                  </select>
                </label>

                <label className="settings-field">
                  <span>{t('settings.tmux.sessionName')}</span>
                  <input
                    type="text"
                    value={appSettings.tmuxSessionName}
                    onChange={(e) => setApp('tmuxSessionName', e.target.value)}
                    placeholder="portico"
                    spellCheck={false}
                  />
                </label>

                <div className="settings-note">
                  <strong>{t('settings.tmux.tips')}</strong>
                  <ul className="settings-list">
                    <li>{t('settings.tmux.tipDetach')}</li>
                    <li>{t('settings.tmux.tipReconnect')}</li>
                    <li>{t('settings.tmux.tipPalette')}</li>
                    <li>{t('settings.tmux.tipBuffer')}</li>
                  </ul>
                </div>
              </section>
            )}

            {section === 'image' && (
              <section className="settings-section">
                <p className="settings-lead">{t('settings.image.lead')}</p>

                <label className="settings-field">
                  <span>{t('settings.image.defaultPrompt')}</span>
                  <input
                    type="text"
                    value={appSettings.defaultPastePrompt}
                    onChange={(e) => setApp('defaultPastePrompt', e.target.value)}
                    placeholder={t('paste.defaultPrompt')}
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
                    {t('settings.image.skipDialog')}
                    <em>{t('settings.image.skipDialogHint')}</em>
                  </span>
                </label>

                <div className="settings-note">{t('settings.image.note')}</div>
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
                    <div className="settings-note">{t('settings.about.dev')}</div>
                  )}
                </div>

                <div className="settings-field">
                  <span>{t('settings.about.updates')}</span>
                  <div className="settings-about-update">
                    <span className="settings-update-state">
                      {formatUpdateStatus(updateStatus, t)}
                    </span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={onCheckUpdates}
                      disabled={
                        updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'
                      }
                    >
                      {t('settings.about.check')}
                    </button>
                    {updateStatus?.state === 'downloaded' && (
                      <button type="button" className="btn primary" onClick={onInstallUpdate}>
                        {t('settings.about.install')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-note">
                  {t('settings.about.keyboard')}
                  <br />
                  {t('settings.about.workflow')}
                </div>
              </section>
            )}
          </div>

          <footer className="settings-footer">
            <button type="button" className="btn primary" onClick={onClose}>
              {t('common.done')}
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}

function formatUpdateStatus(
  s: UpdateStatus | null,
  t: (key: import('../i18n/index.js').MessageKey, vars?: Record<string, string | number>) => string
): string {
  if (!s) return t('update.idle')
  switch (s.state) {
    case 'idle':
      return t('update.idle')
    case 'checking':
      return t('update.checking')
    case 'available':
      return s.version ? `${t('update.available')} ${s.version}` : t('update.available')
    case 'downloading':
      return s.percent != null ? `${t('update.downloading')} ${Math.round(s.percent)}%` : t('update.downloading')
    case 'downloaded':
      return s.version ? `${s.version} — ${t('update.ready')}` : t('update.ready')
    case 'not-available':
      return s.message ?? t('update.upToDate')
    case 'error':
      return s.message ?? t('update.error')
    default:
      return s.state
  }
}
