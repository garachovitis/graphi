// Document themes (Word's Design ▸ Themes / Colors / Fonts).
//
// A theme is the twelve OOXML colour slots plus a heading/body font pair — the same model
// as Word's theme1.xml, so it round-trips through DOCX. Styles, tables, links and any text
// coloured from the "Theme Colors" rows of a colour menu refer to the theme instead of a
// fixed hex value, so switching the theme recolours the whole document at once.
//
// Theme-linked colours are stored in the document as CSS custom properties with the
// resolved colour as fallback: `var(--th-accent1-l40, #8fdcd7)` = "Accent 1, Lighter 40%".
// The editor resolves them live from the variables that surfaceCss() emits; exporters
// resolve them with resolveColor() (and DOCX writes them back as real theme colours).
import { t, type Key } from '../i18n'

export const SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const
export type Slot = (typeof SLOTS)[number]
export type ThemeColors = Record<Slot, string>
export interface ThemeFonts { major: string; minor: string }
export interface DocTheme { id: string; name: string; colors: ThemeColors; fonts: ThemeFonts }

/** Fonts a theme may use (the app ships Calibri/Carlito, Arial/Arimo and Tahoma). */
export const THEME_FONTS = ['Calibri Light', 'Calibri', 'Arial', 'Tahoma']

// ───────────── colour maths (HSL, as OOXML's lumMod/lumOff) ─────────────
export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)
export function toHex(s: string): string | null {
  const v = s.trim().replace(/^#?/, '#').toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v.slice(1).split('').map((x) => x + x).join('')
  return null
}
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((x) => x / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  return rgbHex(f(5) * 255, f(3) * 255, f(1) * 255)
}
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((x) => x / 255)
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, max === 0 ? 0 : d / max, max]
}

/** Word's "Lighter n%" (pct > 0) / "Darker n%" (pct < 0): HSL luminance modulation. */
export function tintShade(hex: string, pct: number): string {
  if (!pct) return hex.toLowerCase()
  const [h, s, l] = hexToHsl(hex)
  const f = Math.abs(pct) / 100
  return hslToHex(h, s, pct > 0 ? l * (1 - f) + f : l * (1 - f))
}

/** The five variants under each theme colour, as Word lays them out (depends on how light the colour is). */
export function variantsOf(hex: string): number[] {
  const l = hexToHsl(hex)[2]
  if (l < 0.2) return [50, 35, 25, 15, 5]
  if (l > 0.8) return [-5, -15, -25, -35, -50]
  return [80, 60, 40, -25, -50]
}
// Every variant that gets a CSS variable: Word's picker rows plus the shades the style sets use.
const ALL_PCTS = [88, 80, 60, 50, 42, 40, 35, 30, 25, 22, 18, 15, 12, 10, 5, -5, -10, -12, -15, -18, -22, -25, -30, -35, -42, -50]

// ───────────── WCAG contrast ─────────────
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((x) => { const c = x / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** Readable text colour (black or white) on a background. */
export const inkOn = (bg: string) => (contrast(bg, '#000000') >= contrast(bg, '#ffffff') ? '#000000' : '#ffffff')

// ───────────── built-in palettes, font pairs and themes ─────────────
const pal = (dk2: string, lt2: string, a: string[], hlink: string, folHlink: string, dk1 = '#000000', lt1 = '#ffffff'): ThemeColors => ({
  dk1, lt1, dk2, lt2, accent1: a[0], accent2: a[1], accent3: a[2], accent4: a[3], accent5: a[4], accent6: a[5], hlink, folHlink,
})

export interface Palette { id: string; readonly name: string; colors: ThemeColors }
const P = (id: string, colors: ThemeColors): Palette => ({ id, get name() { return t(`thm.${id}` as Key) }, colors })
export const PALETTES: Palette[] = [
  P('grafi', pal('#0d4745', '#e8f6f5', ['#1ab3ac', '#ee7b30', '#8e7cc3', '#f2b632', '#3b82c4', '#6aaf50'], '#117470', '#7c5295')),
  P('office', pal('#44546a', '#e7e6e6', ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'], '#0563c1', '#954f72')),
  P('ocean', pal('#1b3a57', '#e6eef5', ['#1f6fb2', '#17a2b8', '#5dade2', '#f5a623', '#2e4a7d', '#7fb77e'], '#1f6fb2', '#6b4e9b')),
  P('forest', pal('#2f3e2e', '#eef2e6', ['#3e7b3a', '#8db255', '#c9a227', '#a0522d', '#5e8c8c', '#7a6a53'], '#2e6b2a', '#6b5b3e')),
  P('sunset', pal('#4a2c2a', '#fbefe8', ['#e4572e', '#f3a712', '#c0392b', '#8e44ad', '#f28fad', '#29335c'], '#c0392b', '#8e44ad')),
  P('berry', pal('#3d1f3a', '#f6ecf4', ['#a23b72', '#e26d5c', '#6c4ab6', '#f1a208', '#3c91e6', '#59a96a'], '#a23b72', '#6c4ab6')),
  P('slate', pal('#334155', '#eef1f5', ['#475569', '#0ea5e9', '#64748b', '#f59e0b', '#10b981', '#e11d48'], '#2563eb', '#7c3aed')),
  P('lavender', pal('#2e2a4f', '#f1effa', ['#6d5bd0', '#a78bfa', '#d946ef', '#f472b6', '#60a5fa', '#34d399'], '#5b4bc4', '#9d4edd')),
  P('citrus', pal('#3b3b1f', '#faf7e6', ['#e0a100', '#7cb518', '#f46036', '#2e86ab', '#a23b72', '#5b8e7d'], '#2e86ab', '#a23b72')),
  P('navy', pal('#0b2545', '#eef4ed', ['#13315c', '#8da9c4', '#e07a5f', '#f2cc8f', '#3d5a80', '#81b29a'], '#3d5a80', '#7a4f8f')),
  P('terracotta', pal('#5a3a2e', '#f7efe9', ['#c8553d', '#f28f3b', '#588b8b', '#e9b44c', '#2d3047', '#93b7be'], '#b0442e', '#6a4c93')),
  P('grayscale', pal('#000000', '#f8f8f8', ['#dddddd', '#b2b2b2', '#969696', '#808080', '#5f5f5f', '#4d4d4d'], '#5f5f5f', '#919191')),
]

export interface FontPair { id: string; fonts: ThemeFonts }
export const FONT_PAIRS: FontPair[] = [
  ['Calibri Light', 'Calibri'], ['Calibri', 'Calibri'], ['Arial', 'Arial'], ['Tahoma', 'Tahoma'],
  ['Arial', 'Calibri'], ['Tahoma', 'Calibri'], ['Calibri Light', 'Arial'], ['Tahoma', 'Arial'], ['Arial', 'Tahoma'], ['Calibri', 'Tahoma'],
].map(([major, minor]) => ({ id: `${major}|${minor}`, fonts: { major, minor } }))
export const fontPairName = (f: ThemeFonts) => (f.major === f.minor ? f.major : `${f.major} – ${f.minor}`)

const T = (id: string, major: string, minor: string): DocTheme & { builtin: true } => {
  const p = PALETTES.find((x) => x.id === id)!
  return { id, get name() { return p.name }, colors: p.colors, fonts: { major, minor }, builtin: true }
}
export const BUILTIN_THEMES: DocTheme[] = [
  T('grafi', 'Calibri Light', 'Calibri'),
  T('office', 'Calibri Light', 'Calibri'),
  T('ocean', 'Arial', 'Arial'),
  T('forest', 'Tahoma', 'Calibri'),
  T('sunset', 'Arial', 'Calibri'),
  T('berry', 'Calibri Light', 'Arial'),
  T('slate', 'Arial', 'Arial'),
  T('lavender', 'Calibri Light', 'Calibri'),
  T('citrus', 'Tahoma', 'Tahoma'),
  T('navy', 'Tahoma', 'Arial'),
  T('terracotta', 'Arial', 'Tahoma'),
  T('grayscale', 'Calibri', 'Calibri'),
]

/** Plain, serialisable copy (built-ins carry a getter for their localised name). */
export const cloneTheme = (th: DocTheme, patch: Partial<DocTheme> = {}): DocTheme =>
  ({ id: th.id, name: th.name, colors: { ...th.colors }, fonts: { ...th.fonts }, ...patch })

export const DEFAULT_THEME: DocTheme = cloneTheme(BUILTIN_THEMES[0])

/** Validates a theme read from a file; anything missing falls back to the default theme. */
export function sanitizeTheme(raw: unknown): DocTheme | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<DocTheme>
  if (!r.colors || typeof r.colors !== 'object') return null
  const colors = { ...DEFAULT_THEME.colors }
  for (const s of SLOTS) { const v = (r.colors as Record<string, unknown>)[s]; if (typeof v === 'string' && toHex(v)) colors[s] = toHex(v)! }
  const f = (r.fonts || {}) as Partial<ThemeFonts>
  return {
    id: typeof r.id === 'string' ? r.id : 'custom',
    name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 80) : t('thm.custom'),
    colors,
    fonts: { major: typeof f.major === 'string' && f.major ? f.major : DEFAULT_THEME.fonts.major, minor: typeof f.minor === 'string' && f.minor ? f.minor : DEFAULT_THEME.fonts.minor },
  }
}

/** Name to show for a document's theme (built-ins follow the UI language). */
export const themeName = (th: DocTheme) => BUILTIN_THEMES.find((b) => b.id === th.id && sameTheme(b, th))?.name ?? th.name
export const sameColors = (a: ThemeColors, b: ThemeColors) => SLOTS.every((s) => a[s].toLowerCase() === b[s].toLowerCase())
export const sameFonts = (a: ThemeFonts, b: ThemeFonts) => a.major === b.major && a.minor === b.minor
export const sameTheme = (a: DocTheme, b: DocTheme) => sameColors(a.colors, b.colors) && sameFonts(a.fonts, b.fonts)

// ───────────── the active theme ─────────────
export let currentTheme: DocTheme = DEFAULT_THEME
export function setCurrentTheme(th: DocTheme) { currentTheme = th }

// ───────────── theme-linked colour references ─────────────
/** A colour reference used by style sets: "accent1", "accent1:-35" (darker 35%), "dk1:+35" (lighter 35%). */
export type ColorRef = string
export function refColor(ref: ColorRef, th: DocTheme = currentTheme): string {
  const [slot, pct] = ref.split(':')
  const base = th.colors[slot as Slot] || '#000000'
  return tintShade(base, pct ? Number(pct) : 0)
}

const VAR_RE = /^var\(\s*--th-(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folhlink)(?:-([ld])(\d{1,2}))?\s*(?:,[^()]*)?\)$/i
export interface ThemeRef { slot: Slot; pct: number }
export function parseThemeRef(s: string | null | undefined): ThemeRef | null {
  const m = s ? VAR_RE.exec(s.trim()) : null
  if (!m) return null
  const slot = SLOTS.find((x) => x.toLowerCase() === m[1].toLowerCase())!
  return { slot, pct: m[2] ? (m[2] === 'l' ? 1 : -1) * Number(m[3]) : 0 }
}
const varName = (slot: Slot, pct: number) => `--th-${slot}${pct ? `-${pct > 0 ? 'l' : 'd'}${Math.abs(pct)}` : ''}`
/** Stored form of a theme colour: live in the editor, with the current value as fallback elsewhere. */
export const themeVar = (slot: Slot, pct = 0, th: DocTheme = currentTheme) => `var(${varName(slot, pct)}, ${tintShade(th.colors[slot], pct)})`
/** Hex for a stored colour value (theme reference or plain colour). */
export function resolveColor(c: string, th: DocTheme = currentTheme): string {
  const r = parseThemeRef(c)
  return r ? tintShade(th.colors[r.slot], r.pct) : c
}
/** The nearest variant Word can express (import: w:themeTint / w:themeShade). */
export function snapPct(pct: number): number | null {
  if (!pct) return 0
  const best = ALL_PCTS.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a))
  return Math.abs(best - pct) <= 1 ? best : null
}

/** CSS custom properties for every theme colour and variant (scoped to the document surface). */
export function themeVarsCss(th: DocTheme = currentTheme): string {
  const out: string[] = []
  for (const s of SLOTS) for (const p of [0, ...ALL_PCTS]) out.push(`${varName(s, p)}:${tintShade(th.colors[s], p)}`)
  out.push(`--th-font-major:${JSON.stringify(th.fonts.major)}`, `--th-font-minor:${JSON.stringify(th.fonts.minor)}`)
  return out.join(';')
}

// ───────────── names (Word's wording) ─────────────
export const slotName = (s: Slot) => t(`slot.${s}` as Key)
/** Tooltip for a cell of the theme grid: "Accent 1, Lighter 40%". */
export function variantName(slot: Slot, pct: number): string {
  const base = t(`slotShort.${slot}` as Key)
  if (!pct) return base
  return t(pct > 0 ? 'color.lighter' : 'color.darker', { name: base, pct: String(Math.abs(pct)) })
}

/** Rough perceptual distance between two colours (import: "is this the style's own colour?"). */
export function colorDistance(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)]
  return Math.sqrt(2 * (x[0] - y[0]) ** 2 + 4 * (x[1] - y[1]) ** 2 + 3 * (x[2] - y[2]) ** 2) / 3
}

// ───────────── the user's theme library (per device) ─────────────
const LIB_KEY = 'grafi:themes'
const DEFAULT_KEY = 'grafi:defaultDesign'
const listeners = new Set<() => void>()
export function onThemesChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } }

export function customThemes(): DocTheme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIB_KEY) || '[]')
    return Array.isArray(raw) ? raw.map(sanitizeTheme).filter((x): x is DocTheme => !!x) : []
  } catch { return [] }
}
function writeLib(list: DocTheme[]) {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(list)) } catch { /* private mode / quota */ }
  listeners.forEach((f) => f())
}
/** Adds or replaces (same id) a theme in the library and returns the stored copy. */
export function saveCustomTheme(th: DocTheme): DocTheme {
  const list = customThemes()
  const copy = cloneTheme(th, { id: th.id.startsWith('u-') ? th.id : `u-${Date.now().toString(36)}` })
  const i = list.findIndex((x) => x.id === copy.id)
  if (i >= 0) list[i] = copy; else list.unshift(copy)
  writeLib(list)
  return copy
}
export function deleteCustomTheme(id: string) { writeLib(customThemes().filter((x) => x.id !== id)) }
export function restoreCustomTheme(th: DocTheme, index: number) {
  const list = customThemes().filter((x) => x.id !== th.id)
  list.splice(Math.min(index, list.length), 0, th)
  writeLib(list)
}

/** Word's "Set as Default": the design new blank documents start with. */
export interface DefaultDesign { theme: DocTheme; styleSet: string }
export function userDefaultDesign(): DefaultDesign | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DEFAULT_KEY) || 'null')
    const theme = sanitizeTheme(raw?.theme)
    return theme && typeof raw.styleSet === 'string' ? { theme, styleSet: raw.styleSet } : null
  } catch { return null }
}
export function setUserDefaultDesign(d: DefaultDesign | null) {
  try { if (d) localStorage.setItem(DEFAULT_KEY, JSON.stringify({ theme: cloneTheme(d.theme), styleSet: d.styleSet })); else localStorage.removeItem(DEFAULT_KEY) } catch { /* ignore */ }
}

// ───────────── Office theme XML (theme1.xml, .thmx) ─────────────
/** Reads the colours and fonts of an Office theme part. */
export function parseThemeXml(xml: string): DocTheme | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const scheme = doc.getElementsByTagName('a:clrScheme')[0]
  if (!scheme) return null
  const colors = { ...DEFAULT_THEME.colors }
  for (const s of SLOTS) {
    const el = scheme.getElementsByTagName(`a:${s}`)[0]
    const c = el?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val') || el?.getElementsByTagName('a:sysClr')[0]?.getAttribute('lastClr')
    if (c && /^[0-9a-f]{6}$/i.test(c)) colors[s] = `#${c.toLowerCase()}`
  }
  const font = (tag: string) => doc.getElementsByTagName(tag)[0]?.getElementsByTagName('a:latin')[0]?.getAttribute('typeface') || ''
  const name = doc.documentElement.getAttribute('name') || scheme.getAttribute('name') || t('thm.custom')
  return {
    id: 'imported',
    name,
    colors,
    fonts: { major: font('a:majorFont') || DEFAULT_THEME.fonts.major, minor: font('a:minorFont') || DEFAULT_THEME.fonts.minor },
  }
}
