// Table styles: Word's best-known built-in looks (Table Grid, Grid Table 1 Light / 4 / 5 Dark,
// List Table 2 / 4 / 6 Colorful, Plain Table 3). The first five sit in the ribbon, the rest in its menu. The table only stores the style id
// (`tableStyle`); the editor draws it with CSS, the exporters bake it into cell shading and runs,
// so Word / LibreOffice show the same table even without our style definition.
import type { JSONContent } from '@tiptap/core'
import { parseThemeRef, themeVar, type Slot } from './themes'

export type TableStyleId = 'grid' | 'light' | 'accent' | 'accentSide' | 'grey'
  | 'accent2' | 'accent6' | 'listLight' | 'colorful' | 'accent2Side' | 'plain'
/** How one region of the table is drawn: fill (theme colour), text colour (stored form: hex or theme var), bold. */
interface Look { fill?: [Slot, number]; ink?: string; bold?: boolean }
export interface TableStyle {
  id: TableStyleId
  /** Word's own name, for the tooltip. */
  word: string
  header?: Look
  firstCol?: Look
  /** Every other body row (Word's banded rows), starting with the first one under the header. */
  band?: Look
  /** All other cells. */
  body?: Look
}

const WHITE = '#ffffff'
/** List Table 6 Colorful: text in Accent 1, Darker 25%. */
const COLORFUL = themeVar('accent1', -25)
export const TABLE_STYLES: TableStyle[] = [
  { id: 'grid', word: 'Table Grid' },
  { id: 'light', word: 'Grid Table 1 Light', header: { bold: true }, firstCol: { bold: true } },
  { id: 'accent', word: 'Grid Table 4 – Accent 1', header: { fill: ['accent1', 0], ink: WHITE, bold: true }, band: { fill: ['accent1', 80] } },
  { id: 'accentSide', word: 'Grid Table 5 Dark – Accent 1', header: { fill: ['accent1', 0], ink: WHITE, bold: true }, firstCol: { fill: ['accent1', 0], ink: WHITE, bold: true }, body: { fill: ['accent1', 80] } },
  { id: 'grey', word: 'List Table 4', header: { fill: ['dk1', 25], ink: WHITE, bold: true }, band: { fill: ['dk1', 88] } },
  // ── in the menu ──
  { id: 'accent2', word: 'Grid Table 4 – Accent 2', header: { fill: ['accent2', 0], ink: WHITE, bold: true }, band: { fill: ['accent2', 80] } },
  { id: 'accent6', word: 'Grid Table 4 – Accent 6', header: { fill: ['accent6', 0], ink: WHITE, bold: true }, band: { fill: ['accent6', 80] } },
  { id: 'listLight', word: 'List Table 2 – Accent 1', header: { bold: true }, band: { fill: ['accent1', 80] } },
  { id: 'colorful', word: 'List Table 6 Colorful – Accent 1', header: { ink: COLORFUL, bold: true }, band: { fill: ['accent1', 80], ink: COLORFUL }, body: { ink: COLORFUL } },
  { id: 'accent2Side', word: 'Grid Table 5 Dark – Accent 2', header: { fill: ['accent2', 0], ink: WHITE, bold: true }, firstCol: { fill: ['accent2', 0], ink: WHITE, bold: true }, body: { fill: ['accent2', 80] } },
  { id: 'plain', word: 'Plain Table 3', header: { bold: true }, firstCol: { bold: true }, band: { fill: ['lt1', -5] } },
]
/** How many styles the ribbon shows; the others are in its menu. */
export const TABLE_STYLES_SHOWN = 5

/** A text colour some style puts on its cells (white, or a style's theme colour): replaced when the style changes. */
export function isStyleInk(c: unknown): boolean {
  if (typeof c !== 'string' || !c) return false
  if (/^#fff(fff)?$/i.test(c)) return true
  const r = parseThemeRef(c)
  return !!r && TABLE_STYLES.some((s) => [s.header, s.firstCol, s.band, s.body].some((l) => {
    const i = parseThemeRef(l?.ink)
    return i && i.slot === r.slot && i.pct === r.pct
  }))
}
export const tableStyle = (id: unknown) => TABLE_STYLES.find((s) => s.id === id) ?? null

/** The look of the cell at (row, first-in-row?) — header wins over first column, which wins over bands. */
export function cellLook(s: TableStyle, row: number, first: boolean): Look | null {
  if (row === 0 && s.header) return s.header
  if (first && s.firstCol) return s.firstCol
  if (s.band && row % 2 === 1) return s.band
  return s.body ?? null
}
export const lookFill = (l: Look | null) => (l?.fill ? themeVar(l.fill[0], l.fill[1]) : null)

/** CSS for every style (cells' own shading is inline, so it still wins). */
export function tableStylesCss(scope: string): string {
  const out: string[] = []
  const rule = (sel: string, l: Look) => {
    const d = [l.fill && `background:${themeVar(l.fill[0], l.fill[1])}`, l.ink && `color:${l.ink}`, l.bold && 'font-weight:700'].filter(Boolean).join(';')
    if (d) out.push(`${sel}{${d}}`)
    // Paragraph styles set their own weight: the cell's text follows the table style.
    const txt = [l.ink && `color:${l.ink}`, l.bold && 'font-weight:700'].filter(Boolean).join(';')
    if (txt) out.push(`${sel} p{${txt}}`)
  }
  for (const s of TABLE_STYLES) {
    const T = `${scope} table[data-table-style="${s.id}"] > tbody > tr`
    // A styled table draws its own header row: no default header tint.
    out.push(`${T} > th{background:transparent}`)
    if (s.body) rule(`${T} > *`, s.body)
    if (s.band) rule(`${T}:nth-child(even) > *`, s.band)
    if (s.firstCol) rule(`${T} > *:first-child`, s.firstCol)
    if (s.header) rule(`${T}:first-child > *`, s.header)
  }
  return out.join('\n')
}

/**
 * The table with its style written out as direct formatting (exporters): cell fills where the cell
 * has none of its own, bold / text colour on the runs of header and first-column cells.
 */
export function bakeTableStyle(table: JSONContent): JSONContent {
  const s = tableStyle(table.attrs?.tableStyle)
  if (!s) return table
  const runs = (n: JSONContent, l: Look): JSONContent => {
    if (n.type === 'text') {
      let marks = [...(n.marks || [])]
      if (l.bold && !marks.some((m) => m.type === 'bold')) marks.push({ type: 'bold' })
      if (l.ink) {
        const ts = marks.find((m) => m.type === 'textStyle')
        if (!ts) marks.push({ type: 'textStyle', attrs: { color: l.ink } })
        else if (!ts.attrs?.color) marks = marks.map((m) => (m === ts ? { ...m, attrs: { ...m.attrs, color: l.ink } } : m))
      }
      return { ...n, marks }
    }
    return n.content ? { ...n, content: n.content.map((c) => runs(c, l)) } : n
  }
  return {
    ...table,
    content: (table.content || []).map((row, r) => ({
      ...row,
      content: (row.content || []).map((cell, i) => {
        const l = cellLook(s, r, i === 0)
        // Header cells otherwise get the default header tint on export.
        const fill = cell.attrs?.backgroundColor || lookFill(l) || (cell.type === 'tableHeader' ? WHITE : null)
        const c = { ...cell, attrs: { ...cell.attrs, backgroundColor: fill } }
        return l && (l.bold || l.ink) ? runs(c, l) : c
      }),
    })),
  }
}

/** Import: drop cell fills that are just the style's own (so changing the style later recolours them). */
export function unbakeTableStyle(table: JSONContent): JSONContent {
  const s = tableStyle(table.attrs?.tableStyle)
  if (!s) return table
  return {
    ...table,
    content: (table.content || []).map((row, r) => ({
      ...row,
      content: (row.content || []).map((cell, i) => {
        const bg = cell.attrs?.backgroundColor
        const own = cellLook(s, r, i === 0)?.fill
        const ref = parseThemeRef(bg)
        const same = bg && (own ? ref?.slot === own[0] && ref.pct === own[1] : cell.type === 'tableHeader' && /^#fff(fff)?$/i.test(bg))
        return same ? { ...cell, attrs: { ...cell.attrs, backgroundColor: null } } : cell
      }),
    })),
  }
}
