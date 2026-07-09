/**
 * Terminal appearance + behavior settings (renderer-only, localStorage).
 */
import type { ITheme } from '@xterm/xterm'

export type TermThemeId = 'portico' | 'dracula' | 'solarized' | 'high-contrast'

export interface TerminalSettings {
  themeId: TermThemeId
  fontFamily: string
  fontSize: number
  lineHeight: number
  scrollback: number
  /** Copy selection to the system clipboard automatically. */
  copyOnSelect: boolean
  /** Prefer WebGL renderer when available. */
  webgl: boolean
}

export const STORAGE_KEY = 'portico.terminalSettings'

export const DEFAULT_FONT =
  "ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace"

export const FONT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'system', label: 'System mono', value: DEFAULT_FONT },
  {
    id: 'sf',
    label: 'SF Mono',
    value: "'SF Mono', ui-monospace, Menlo, monospace"
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    value: "'JetBrains Mono', ui-monospace, Menlo, monospace"
  },
  {
    id: 'fira',
    label: 'Fira Code',
    value: "'Fira Code', ui-monospace, Menlo, monospace"
  },
  {
    id: 'cascadia',
    label: 'Cascadia Code',
    value: "'Cascadia Code', ui-monospace, Consolas, monospace"
  }
]

export const DEFAULT_SETTINGS: TerminalSettings = {
  themeId: 'portico',
  fontFamily: DEFAULT_FONT,
  fontSize: 13,
  lineHeight: 1.2,
  scrollback: 10_000,
  copyOnSelect: true,
  webgl: true
}

/** Named themes for xterm (and short labels for the settings UI). */
export const TERM_THEMES: Record<
  TermThemeId,
  { label: string; theme: ITheme }
> = {
  portico: {
    label: 'Portico Dark',
    theme: {
      background: '#0e1116',
      foreground: '#e6edf3',
      cursor: '#e6edf3',
      cursorAccent: '#0e1116',
      selectionBackground: '#264f78',
      selectionForeground: '#ffffff',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc'
    }
  },
  dracula: {
    label: 'Dracula',
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },
  solarized: {
    label: 'Solarized Dark',
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#839496',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  },
  'high-contrast': {
    label: 'High Contrast',
    theme: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffffff',
      cursorAccent: '#000000',
      selectionBackground: '#ffffff',
      selectionForeground: '#000000',
      black: '#000000',
      red: '#ff5555',
      green: '#55ff55',
      yellow: '#ffff55',
      blue: '#5555ff',
      magenta: '#ff55ff',
      cyan: '#55ffff',
      white: '#bbbbbb',
      brightBlack: '#555555',
      brightRed: '#ff5555',
      brightGreen: '#55ff55',
      brightYellow: '#ffff55',
      brightBlue: '#5555ff',
      brightMagenta: '#ff55ff',
      brightCyan: '#55ffff',
      brightWhite: '#ffffff'
    }
  }
}

export function loadTerminalSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<TerminalSettings>
    return normalizeSettings(parsed)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveTerminalSettings(s: TerminalSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(s)))
  } catch {
    /* quota / private mode */
  }
}

export function normalizeSettings(partial: Partial<TerminalSettings>): TerminalSettings {
  const themeId =
    partial.themeId && partial.themeId in TERM_THEMES
      ? partial.themeId
      : DEFAULT_SETTINGS.themeId
  const fontSize = clamp(Number(partial.fontSize) || DEFAULT_SETTINGS.fontSize, 10, 28)
  const lineHeight = clamp(Number(partial.lineHeight) || DEFAULT_SETTINGS.lineHeight, 1, 2)
  const scrollback = clamp(
    Math.round(Number(partial.scrollback) || DEFAULT_SETTINGS.scrollback),
    1000,
    50_000
  )
  return {
    themeId,
    fontFamily:
      typeof partial.fontFamily === 'string' && partial.fontFamily.trim()
        ? partial.fontFamily.trim()
        : DEFAULT_SETTINGS.fontFamily,
    fontSize,
    lineHeight,
    scrollback,
    copyOnSelect: partial.copyOnSelect ?? DEFAULT_SETTINGS.copyOnSelect,
    webgl: partial.webgl ?? DEFAULT_SETTINGS.webgl
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

export function xtermTheme(id: TermThemeId): ITheme {
  return TERM_THEMES[id]?.theme ?? TERM_THEMES.portico.theme
}
