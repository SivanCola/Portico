import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode
} from 'react'
import type { AppLocale, ResolvedLocale } from './locales.js'
import { resolveLocale } from './locales.js'
import { translate, type MessageKey, type TranslateVars } from './messages.js'

export type TFunction = (key: MessageKey, vars?: TranslateVars) => string

interface I18nValue {
  /** Preference (may be system). */
  localePref: AppLocale
  /** Concrete catalog language. */
  locale: ResolvedLocale
  t: TFunction
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({
  localePref,
  children
}: {
  localePref: AppLocale
  children: ReactNode
}) {
  const locale = useMemo(() => resolveLocale(localePref), [localePref])
  const t = useCallback<TFunction>(
    (key, vars) => translate(locale, key, vars),
    [locale]
  )
  // Keep <html lang> in sync for a11y and font selection hints.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en'
    }
  }, [locale])
  const value = useMemo(() => ({ localePref, locale, t }), [localePref, locale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    // Fallback for components rendered outside provider (tests).
    const locale = resolveLocale('system')
    return {
      localePref: 'system',
      locale,
      t: (key, vars) => translate(locale, key, vars)
    }
  }
  return ctx
}
