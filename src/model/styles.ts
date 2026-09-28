// Named paragraph styles (the Word "Styles" gallery). Single source of truth used by
// the editor CSS, HTML export, and DOCX import/export so all renderings agree.
import { t, type Key } from '../i18n'

export interface ParaStyle {
  id: string // DOCX styleId (the UI label comes from styleName())
  /** Which ProseMirror node carries this style. */
  node: 'paragraph' | 'heading'
  level?: number
  font?: string // family name (first in stack)
  sizePt: number
  color?: string
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
export interface StyleSet {
  id: string
  readonly name: string
  bodyFont: string
  headingFont: string
  titleColor: string
  h1: string
  h2: string
  h3: string
  headingBold: boolean
  titleSize: number
  h1Size: number
  titleAlign?: 'left' | 'center'
  subtitleColor: string
}

export const STYLE_SETS: StyleSet[] = [
  { id: 'teal', get name() { return t('set.teal') }, bodyFont: 'Calibri', headingFont: 'Calibri Light', titleColor: '#0D4745', h1: '#117470', h2: '#13928C', h3: '#0D4745', headingBold: false, titleSize: 28, h1Size: 16, subtitleColor: '#5A5A5A' },
  { id: 'office', get name() { return t('set.office') }, bodyFont: 'Calibri', headingFont: 'Calibri Light', titleColor: '#000000', h1: '#2F5496', h2: '#2F5496', h3: '#1F3763', headingBold: false, titleSize: 28, h1Size: 16, subtitleColor: '#5A5A5A' },
  { id: 'mono', get name() { return t('set.mono') }, bodyFont: 'Calibri', headingFont: 'Calibri', titleColor: '#000000', h1: '#000000', h2: '#262626', h3: '#404040', headingBold: true, titleSize: 26, h1Size: 16, subtitleColor: '#595959' },
  { id: 'modern', get name() { return t('set.modern') }, bodyFont: 'Arial', headingFont: 'Arial', titleColor: '#117470', h1: '#117470', h2: '#115A57', h3: '#0D4745', headingBold: true, titleSize: 26, h1Size: 15, subtitleColor: '#13928C' },
  { id: 'formal', get name() { return t('set.formal') }, bodyFont: 'Tahoma', headingFont: 'Tahoma', titleColor: '#1F2937', h1: '#1F2937', h2: '#374151', h3: '#4B5563', headingBold: true, titleSize: 24, h1Size: 14, titleAlign: 'center', subtitleColor: '#6B7280' },
  { id: 'fresh', get name() { return t('set.fresh') }, bodyFont: 'Calibri', headingFont: 'Calibri', titleColor: '#1AB3AC', h1: '#13928C', h2: '#1AB3AC', h3: '#117470', headingBold: true, titleSize: 30, h1Size: 18, subtitleColor: '#14B8A6' },
]

const BASE_STYLES: ParaStyle[] = PARA_STYLES.map((s) => ({ ...s }))
export let currentStyleSet = 'teal'

/** Mutates PARA_STYLES in place so every renderer/exporter picks the set up. */
export function applyStyleSet(id: string) {
  const set = STYLE_SETS.find((s) => s.id === id) || STYLE_SETS[0]
  currentStyleSet = set.id
  PARA_STYLES.forEach((s, i) => Object.assign(s, BASE_STYLES[i]))
  for (const s of PARA_STYLES) {
    if (s.id === 'Normal' || s.id === 'NoSpacing' || s.id === 'Quote' || s.id === 'Subtitle') s.font = set.bodyFont === 'Calibri' ? undefined : set.bodyFont
    if (s.id === 'Subtitle') s.color = set.subtitleColor
    if (s.id === 'Caption') s.color = set.h3
    if (s.id === 'Title') {
      s.font = set.headingFont; s.color = set.titleColor; s.sizePt = set.titleSize; s.bold = set.headingBold && set.headingFont !== 'Calibri Light'
      s.align = set.titleAlign
    }
    if (s.node === 'heading') {
      const lvl = s.level!
      s.color = lvl === 1 ? set.h1 : lvl === 2 || lvl === 4 || lvl === 5 ? set.h2 : set.h3
      s.font = lvl <= 3 ? set.headingFont : set.bodyFont === 'Calibri' ? undefined : set.bodyFont
      s.bold = set.headingBold
      if (lvl === 1) s.sizePt = set.h1Size
    }
  }
}

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
