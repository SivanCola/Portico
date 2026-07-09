/**
 * UI locale for the renderer. "system" follows the OS language at load time.
 */
export type AppLocale = 'system' | 'en' | 'zh-CN'

export type ResolvedLocale = 'en' | 'zh-CN'

export const LOCALE_OPTIONS: { id: AppLocale; labelKey: 'locale.system' | 'locale.en' | 'locale.zhCN' }[] =
  [
    { id: 'system', labelKey: 'locale.system' },
    { id: 'en', labelKey: 'locale.en' },
    { id: 'zh-CN', labelKey: 'locale.zhCN' }
  ]

/** Map AppLocale + navigator to a concrete catalog. */
export function resolveLocale(pref: AppLocale, navigatorLanguage?: string): ResolvedLocale {
  if (pref === 'en' || pref === 'zh-CN') return pref
  const nav =
    navigatorLanguage ??
    (typeof navigator !== 'undefined' ? navigator.language || navigator.languages?.[0] : 'en')
  const lower = (nav || 'en').toLowerCase()
  if (lower.startsWith('zh')) return 'zh-CN'
  return 'en'
}

export function isAppLocale(v: unknown): v is AppLocale {
  return v === 'system' || v === 'en' || v === 'zh-CN'
}
