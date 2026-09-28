// Document-level settings (page geometry, header/footer) and unit conversions.
// All geometry is stored in millimetres; CSS pixels are 96/in, DOCX uses twips (1/1440 in).
import { t, fmtNum, fmtDate, type Key } from '../i18n'
import { DEFAULT_THEME, sanitizeTheme, type DocTheme } from './themes'
import { legacyTheme } from './styles'

export const MM_PER_IN = 25.4
export const PX_PER_IN = 96
export const mmToPx = (mm: number) => (mm * PX_PER_IN) / MM_PER_IN
export const pxToMm = (px: number) => (px * MM_PER_IN) / PX_PER_IN
export const mmToTwip = (mm: number) => Math.round((mm / MM_PER_IN) * 1440)
export const twipToMm = (tw: number) => (tw / 1440) * MM_PER_IN
export const ptToPx = (pt: number) => (pt * 96) / 72
export const pxToPt = (px: number) => (px * 72) / 96
export const cmLabel = (mm: number) => `${fmtNum(mm / 10)} ${t('unit.cm')}`

export interface PaperSize { id: string; label: string; w: number; h: number }
export const PAPER_SIZES: PaperSize[] = [
  { id: 'A4', label: 'A4', w: 210, h: 297 },
  { id: 'Letter', label: 'Letter', w: 215.9, h: 279.4 },
  { id: 'Legal', label: 'Legal', w: 215.9, h: 355.6 },
  { id: 'A3', label: 'A3', w: 297, h: 420 },
  { id: 'A5', label: 'A5', w: 148, h: 210 },
  { id: 'B5', label: 'B5 (JIS)', w: 182, h: 257 },
  { id: 'Executive', label: 'Executive', w: 184.15, h: 266.7 },
  { id: 'Tabloid', label: 'Tabloid', w: 279.4, h: 431.8 },
]

export interface Margins { top: number; right: number; bottom: number; left: number }
const preset = (id: string, m: Margins) => ({ id, m, get label() { return t(`margin.${id}` as Key) } })
export const MARGIN_PRESETS: { id: string; readonly label: string; m: Margins }[] = [
  preset('normal', { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 }),
  preset('narrow', { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 }),
  preset('moderate', { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 }),
  preset('wide', { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 }),
  preset('office2003', { top: 25.4, right: 31.75, bottom: 25.4, left: 31.75 }),
  preset('greek', { top: 25, right: 25, bottom: 25, left: 25 }),
]

export type HFAlign = 'left' | 'center' | 'right'
export interface HeaderFooter {
  /** Plain text. Tokens: {page} {pages} {date} {title} */
  headerText: string
  headerAlign: HFAlign
  footerText: string
  footerAlign: HFAlign
  differentFirstPage: boolean
  /** Distance from page edge to header/footer text, mm. */
  headerDistance: number
  footerDistance: number
}

export interface DocSettings {
  paper: string // PaperSize id or 'custom'
  width: number // mm (already oriented)
  height: number // mm (already oriented)
  orientation: 'portrait' | 'landscape'
  margins: Margins
  hf: HeaderFooter
  columns: 1 | 2 | 3
  columnGap: number // mm
  title: string
  author: string
  styleSet: string
  /** Theme colours and fonts (Design ▸ Themes). Travels with the document. */
  theme: DocTheme
  /** Multilevel heading numbering 1 / 1.1 / 1.1.1 (Word: Multilevel list linked to Heading styles). */
  headingNumbers: boolean
}

export const DEFAULT_SETTINGS: DocSettings = {
  paper: 'A4',
  width: 210,
  height: 297,
  orientation: 'portrait',
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  hf: {
    headerText: '',
    headerAlign: 'center',
    footerText: '',
    footerAlign: 'center',
    differentFirstPage: false,
    headerDistance: 12.5,
    footerDistance: 12.5,
  },
  columns: 1,
  columnGap: 12.5,
  title: '',
  author: '',
  styleSet: 'teal',
  theme: DEFAULT_THEME,
  headingNumbers: false,
}

export function withPaper(s: DocSettings, paperId: string): DocSettings {
  const p = PAPER_SIZES.find((x) => x.id === paperId)
  if (!p) return s
  const [w, h] = s.orientation === 'landscape' ? [p.h, p.w] : [p.w, p.h]
  return { ...s, paper: p.id, width: w, height: h }
}

export function withOrientation(s: DocSettings, o: 'portrait' | 'landscape'): DocSettings {
  if (o === s.orientation) return s
  return { ...s, orientation: o, width: s.height, height: s.width }
}

/** Detect a named paper size from raw dimensions (either orientation). */
export function detectPaper(w: number, h: number): string {
  const near = (a: number, b: number) => Math.abs(a - b) < 1.5
  const p = PAPER_SIZES.find((x) => (near(x.w, w) && near(x.h, h)) || (near(x.w, h) && near(x.h, w)))
  return p ? p.id : 'custom'
}

export function normalizeSettings(raw: Partial<DocSettings> | undefined): DocSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) }
  s.margins = { ...DEFAULT_SETTINGS.margins, ...(raw?.margins || {}) }
  s.hf = { ...DEFAULT_SETTINGS.hf, ...(raw?.hf || {}) }
  // Older documents have no theme: rebuild the look their style set used to have.
  s.theme = sanitizeTheme(raw?.theme) ?? legacyTheme(s.styleSet)
  return s
}

/** Expand header/footer tokens for on-screen rendering. */
export function expandHF(text: string, page: number, pages: number, title: string): string {
  return text
    .replaceAll('{page}', String(page))
    .replaceAll('{pages}', String(pages))
    .replaceAll('{date}', fmtDate())
    .replaceAll('{title}', title)
}
