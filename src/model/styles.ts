// Named paragraph styles (the Word "Styles" gallery). Single source of truth used by
// the editor CSS, HTML export, and DOCX import/export so all renderings agree.
import { t, type Key } from '../i18n'
import { BUILTIN_THEMES, cloneTheme, currentTheme, refColor, setCurrentTheme, type ColorRef, type DocTheme } from './themes'

export interface ParaStyle {
  id: string // DOCX styleId (the UI label comes from styleName())
  /** Which ProseMirror node carries this style. */
  node: 'paragraph' | 'heading'
  level?: number
  font?: string // family name (first in stack)
  sizePt: number
  color?: string
  /** Theme colour the style uses (set by applyDesign), e.g. "accent1:-35". */
  colorRef?: ColorRef
  bold?: boolean
  italic?: boolean
  spaceBeforePt: number
  spaceAfterPt: number
  lineHeight: number // multiple
  align?: 'left' | 'center' | 'right' | 'justify'
  letterSpacingPt?: number
  keepNext?: boolean
}

export const DEFAULT_FONT = 'Calibri'
export const HEADING_FONT = 'Calibri Light'
export const DEFAULT_SIZE_PT = 11

/** Fonts offered in the font picker. */
export const FONT_CHOICES = ['Calibri', 'Arial', 'Tahoma']

// The bundled font a name renders with when the original isn't installed. The UI names what the
// user actually sees (the original is a third-party trademark); the file keeps the original name.
const SUBSTITUTES: Record<string, string> = { Calibri: 'Carlito', 'Calibri Light': 'Carlito', Arial: 'Arimo' }
const installed = new Map<string, boolean>()
function isInstalled(name: string): boolean {
  let hit = installed.get(name)
  if (hit === undefined) {
    // Metric-compatible substitutes measure the same, so compare against a monospace fallback.
    const c = document.createElement('canvas').getContext('2d')
    const w = (f: string) => { c!.font = `72px ${f}`; return c!.measureText('mmmmmmlliWW@').width }
    hit = !c || w(`"${name}", monospace`) !== w('monospace')
    installed.set(name, hit)
  }
  return hit
}

/** Name shown in font pickers: the bundled substitute when the original font is missing. */
export function fontLabel(name: string): string {
  const sub = SUBSTITUTES[name]
  return sub && !isInstalled(name) ? sub : name
}

/** «compatible with Calibri» when fontLabel() shows a substitute, else ''. */
export function fontHint(name: string): string {
  return fontLabel(name) !== name ? t('font.compat', { name }) : ''
}

/**
 * Word expresses line spacing as a multiple of the font's natural line height
 * ("single" ≈ 1.2 × font size for Calibri/Carlito, Cambria, Arial…). CSS line-height
 * multiples are relative to the font size, so we scale. Values ending in "pt" are
 * exact line heights (Word's "Exactly").
 */
export const LINE_FACTOR = 1.2
export function lineHeightCss(v: string | number): string {
  const s = String(v)
  if (s.endsWith('pt')) return s
  const n = parseFloat(s)
  return Number.isFinite(n) ? String(Math.round(n * LINE_FACTOR * 1000) / 1000) : 'normal'
}

/** CSS fallback stacks: metric-compatible substitutes where they exist (Carlito ≅ Calibri). */
export function fontStack(name: string): string {
  const q = (f: string) => (/[\s\d]/.test(f) ? `"${f}"` : f)
  // Carlito and Arimo are bundled, metric-compatible with Calibri and Arial (identical line breaks).
  const fallbacks: Record<string, string[]> = {
    Calibri: ['Carlito', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
    'Calibri Light': ['Calibri', 'Carlito', 'Segoe UI Light', 'Helvetica Neue', 'Arial', 'sans-serif'],
    Arial: ['Arimo', 'Liberation Sans', 'Helvetica', 'sans-serif'],
    Tahoma: ['Verdana', 'DejaVu Sans', 'Segoe UI', 'sans-serif'],
    'Courier New': ['Courier', 'Menlo', 'Consolas', 'monospace'],
  }
  return [name, ...(fallbacks[name] || ['sans-serif'])].map(q).join(', ')
}

export const PARA_STYLES: ParaStyle[] = [
  { id: 'Normal', node: 'paragraph', sizePt: 11, spaceBeforePt: 0, spaceAfterPt: 8, lineHeight: 1.08 },
  { id: 'NoSpacing', node: 'paragraph', sizePt: 11, spaceBeforePt: 0, spaceAfterPt: 0, lineHeight: 1 },
  { id: 'Title', node: 'paragraph', font: HEADING_FONT, sizePt: 28, spaceBeforePt: 0, spaceAfterPt: 0, lineHeight: 1, letterSpacingPt: -0.5, color: '#0D4745' },
  { id: 'Subtitle', node: 'paragraph', sizePt: 11, color: '#5A5A5A', spaceBeforePt: 0, spaceAfterPt: 8, lineHeight: 1.08, letterSpacingPt: 0.75 },
  { id: 'Heading1', node: 'heading', level: 1, font: HEADING_FONT, sizePt: 16, color: '#117470', spaceBeforePt: 12, spaceAfterPt: 0, lineHeight: 1.08, keepNext: true },
  { id: 'Heading2', node: 'heading', level: 2, font: HEADING_FONT, sizePt: 13, color: '#117470', spaceBeforePt: 2, spaceAfterPt: 0, lineHeight: 1.08, keepNext: true },
  { id: 'Heading3', node: 'heading', level: 3, font: HEADING_FONT, sizePt: 12, color: '#0D4745', spaceBeforePt: 2, spaceAfterPt: 0, lineHeight: 1.08, keepNext: true },
  { id: 'Heading4', node: 'heading', level: 4, sizePt: 11, italic: true, color: '#117470', spaceBeforePt: 2, spaceAfterPt: 0, lineHeight: 1.08, keepNext: true },
  { id: 'Heading5', node: 'heading', level: 5, sizePt: 11, color: '#117470', spaceBeforePt: 2, spaceAfterPt: 0, lineHeight: 1.08, keepNext: true },
  { id: 'Heading6', node: 'heading', level: 6, sizePt: 11, color: '#0D4745', spaceBeforePt: 2, spaceAfterPt: 0, lineHeight: 1.08, keepNext: true },
  { id: 'Caption', node: 'paragraph', sizePt: 9, italic: true, color: '#44546A', spaceBeforePt: 0, spaceAfterPt: 10, lineHeight: 1 },
  { id: 'Quote', node: 'paragraph', sizePt: 11, italic: true, color: '#404040', spaceBeforePt: 10, spaceAfterPt: 8, lineHeight: 1.08, align: 'center' },
]

/** Display name in the UI language (Word's built-in style names). */
export const styleName = (s: ParaStyle | string) => t(`style.${typeof s === 'string' ? s : s.id}` as Key)

export const styleById = (id: string | null | undefined) => PARA_STYLES.find((s) => s.id === id)
export const headingStyle = (level: number) => PARA_STYLES.find((s) => s.node === 'heading' && s.level === level)!

/** CSS rules for the document surface, scoped under `scope`. */
export function stylesCss(scope: string): string {
  const rule = (sel: string, s: ParaStyle) => {
    const d: string[] = [
      `font-size:${s.sizePt}pt`,
      `margin:${s.spaceBeforePt}pt 0 ${s.spaceAfterPt}pt 0`,
      `line-height:${lineHeightCss(s.lineHeight)}`,
      `font-weight:${s.bold ? 700 : 400}`,
      `font-style:${s.italic ? 'italic' : 'normal'}`,
    ]
    if (s.font) d.push(`font-family:${fontStack(s.font)}`)
    if (s.color) d.push(`color:${s.color}`)
    if (s.letterSpacingPt) d.push(`letter-spacing:${s.letterSpacingPt}pt`)
    if (s.align) d.push(`text-align:${s.align}`)
    return `${scope} ${sel}{${d.join(';')}}`
  }
  const out: string[] = []
  for (const s of PARA_STYLES) {
    if (s.node === 'heading') out.push(rule(`h${s.level}`, s))
    else if (s.id === 'Normal') out.push(rule('p', s))
    else out.push(rule(`p[data-style="${s.id}"]`, s))
  }
  return out.join('\n')
}

// ───────────── Style sets (Word's Design ▸ Document Formatting) ─────────────
// A style set is structure only (weights, sizes, alignment and *which* theme colour each
// element uses); the colours and fonts themselves come from the document theme.
export interface StyleSet {
  id: string
  readonly name: string
  /** Title / Heading 1–3 use the theme's heading font, or its body font. */
  headingFont: 'major' | 'minor'
  titleColor: ColorRef
  h1: ColorRef
  h2: ColorRef
  h3: ColorRef
  headingBold: boolean
  titleSize: number
  h1Size: number
  titleAlign?: 'left' | 'center'
  subtitleColor: ColorRef
}

const set = (id: string, v: Omit<StyleSet, 'id' | 'name'>): StyleSet => ({ id, get name() { return t(`set.${id}` as Key) }, ...v })
export const STYLE_SETS: StyleSet[] = [
  set('teal', { headingFont: 'major', titleColor: 'dk2', h1: 'accent1:-35', h2: 'accent1:-18', h3: 'dk2', headingBold: false, titleSize: 28, h1Size: 16, subtitleColor: 'dk1:+35' }),
  set('office', { headingFont: 'major', titleColor: 'dk1', h1: 'accent1:-25', h2: 'accent1:-25', h3: 'accent1:-50', headingBold: false, titleSize: 28, h1Size: 16, subtitleColor: 'dk1:+35' }),
  set('mono', { headingFont: 'minor', titleColor: 'dk1', h1: 'dk1', h2: 'dk1:+15', h3: 'dk1:+25', headingBold: true, titleSize: 26, h1Size: 16, subtitleColor: 'dk1:+35' }),
  set('modern', { headingFont: 'major', titleColor: 'accent1:-35', h1: 'accent1:-35', h2: 'accent1:-50', h3: 'dk2', headingBold: true, titleSize: 26, h1Size: 15, subtitleColor: 'accent1:-18' }),
  set('formal', { headingFont: 'major', titleColor: 'dk1:+12', h1: 'dk1:+12', h2: 'dk1:+22', h3: 'dk1:+30', headingBold: true, titleSize: 24, h1Size: 14, titleAlign: 'center', subtitleColor: 'dk1:+42' }),
  set('fresh', { headingFont: 'minor', titleColor: 'accent1', h1: 'accent1:-18', h2: 'accent1', h3: 'accent1:-35', headingBold: true, titleSize: 30, h1Size: 18, subtitleColor: 'accent1:-10' }),
]

/**
 * Documents saved before themes existed carry only a style-set id. This is the theme that
 * reproduces how that style set used to look (its colours and fonts were built in).
 */
export function legacyTheme(styleSet: string): DocTheme {
  const base = cloneTheme(BUILTIN_THEMES.find((x) => x.id === (styleSet === 'office' ? 'office' : 'grafi'))!)
  if (styleSet === 'modern') base.fonts = { major: 'Arial', minor: 'Arial' }
  if (styleSet === 'formal') base.fonts = { major: 'Tahoma', minor: 'Tahoma' }
  return base
}

/** The concrete look of a style set under a theme (gallery previews and the styles below). */
export function resolveSet(s: StyleSet, th: DocTheme = currentTheme) {
  const headingFont = s.headingFont === 'major' ? th.fonts.major : th.fonts.minor
  return {
    headingFont, bodyFont: th.fonts.minor,
    title: refColor(s.titleColor, th), h1: refColor(s.h1, th), h2: refColor(s.h2, th), h3: refColor(s.h3, th), subtitle: refColor(s.subtitleColor, th),
    // Light faces are drawn light: bold "Calibri Light" is not what Word shows.
    titleBold: s.headingBold && headingFont !== 'Calibri Light',
    headingBold: s.headingBold,
  }
}

const BASE_STYLES: ParaStyle[] = PARA_STYLES.map((s) => ({ ...s }))
export let currentStyleSet = 'teal'

/** Mutates PARA_STYLES in place so every renderer/exporter picks the design up. */
export function applyDesign(id: string, theme: DocTheme = currentTheme) {
  const set = STYLE_SETS.find((s) => s.id === id) || STYLE_SETS[0]
  currentStyleSet = set.id
  setCurrentTheme(theme)
  const r = resolveSet(set, theme)
  const body = r.bodyFont === DEFAULT_FONT ? undefined : r.bodyFont
  const color = (s: ParaStyle, ref: ColorRef) => { s.color = refColor(ref, theme); s.colorRef = ref }
  PARA_STYLES.forEach((s, i) => { Object.assign(s, BASE_STYLES[i]); delete s.colorRef })
  for (const s of PARA_STYLES) {
    if (s.id === 'Normal' || s.id === 'NoSpacing' || s.id === 'Quote' || s.id === 'Subtitle' || s.id === 'Caption') s.font = body
    if (s.id === 'Subtitle') color(s, set.subtitleColor)
    if (s.id === 'Caption') color(s, set.h3)
    if (s.id === 'Quote') color(s, 'dk1:+25')
    if (s.id === 'Title') {
      s.font = r.headingFont; color(s, set.titleColor); s.sizePt = set.titleSize; s.bold = r.titleBold
      s.align = set.titleAlign
    }
    if (s.node === 'heading') {
      const lvl = s.level!
      color(s, lvl === 1 ? set.h1 : lvl === 2 || lvl === 4 || lvl === 5 ? set.h2 : set.h3)
      s.font = lvl <= 3 ? r.headingFont : body
      s.bold = set.headingBold
      if (lvl === 1) s.sizePt = set.h1Size
    }
  }
}
/** Switches the style set, keeping the current theme. */
export const applyStyleSet = (id: string) => applyDesign(id, currentTheme)

export const bodyFont = () => PARA_STYLES[0].font || DEFAULT_FONT

/** Multilevel number for each heading in document order ("1", "1.2", "2.1.3"). */
export function headingNumberer() {
  const c = [0, 0, 0, 0, 0, 0]
  return (level: number) => {
    const l = Math.min(6, Math.max(1, level)) - 1
    c[l]++
    for (let i = l + 1; i < 6; i++) c[i] = 0
    return c.slice(0, l + 1).map((x) => x || 1).join('.')
  }
}
