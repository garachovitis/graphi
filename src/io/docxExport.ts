// ProseMirror JSON → Office Open XML (.docx), via the `docx` library.
// Maps our styles to real Word styles (so the Styles pane / Navigation work in Word),
// lists to real numbering definitions, headers/footers to PAGE / NUMPAGES fields.
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun,
  LevelFormat, LineRuleType, Packer, PageBreak, ColumnBreak, SectionType, PageNumber, PageOrientation, Paragraph, ShadingType,
  HorizontalPositionAlign, LevelSuffix, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, TextWrappingSide,
  Tab, TabStopType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType, InternalHyperlink, Bookmark,
} from 'docx'
import type { JSONContent } from '@tiptap/core'
import type { DocSettings } from '../model/settings'
import { mmToTwip } from '../model/settings'
import { DEFAULT_FONT, PARA_STYLES, type ParaStyle } from '../model/styles'
import { fontSizeToPt, colorHex, normalizeColor } from '../editor/units'
import { currentTheme, parseThemeRef, type ColorRef, type Slot } from '../model/themes'
import { HEADER_TINT } from '../model/docCss'
import { isSectionBreak, type BreakKind } from '../editor/nodes'
import { anchoredAtStart, pictureAttrs, pictureKey, preparePictures, type PreparedPicture } from './pictures'
import { TEXT_DISTANCE } from '../editor/image'
import { captionNumbers, collectHeadingsJson } from './common'
import { t, fmtDate } from '../i18n'

type Any = any

const HIGHLIGHT_NAMES: Record<string, string> = {
  '#ffff00': 'yellow', '#00ff00': 'green', '#00ffff': 'cyan', '#ff00ff': 'magenta', '#0000ff': 'blue',
  '#ff0000': 'red', '#000080': 'darkBlue', '#008080': 'darkCyan', '#008000': 'darkGreen', '#800080': 'darkMagenta',
  '#800000': 'darkRed', '#808000': 'darkYellow', '#808080': 'darkGray', '#c0c0c0': 'lightGray', '#000000': 'black', '#ffffff': 'white',
}

const ALIGN: Record<string, Any> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
}

const hex = (c: string | null | undefined) => {
  const n = colorHex(c)
  return n && n.startsWith('#') ? n.slice(1).toUpperCase() : undefined
}

// Theme colours are written as Word theme colours (w:themeColor + tint/shade), so the
// document keeps following its theme when the theme is changed in Word.
const DOCX_SLOT: Record<Slot, string> = {
  dk1: 'dark1', lt1: 'light1', dk2: 'dark2', lt2: 'light2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3',
  accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hlink: 'hyperlink', folHlink: 'followedHyperlink',
}
const themeColorOf = (slot: Slot, pct: number): Any =>
  ({ theme: DOCX_SLOT[slot], ...(pct > 0 ? { lighter: pct } : pct < 0 ? { darker: -pct } : {}) })
/** A run/shading colour: theme colour when linked to the theme, else plain hex. */
function docxColor(c: string | null | undefined): Any {
  const n = normalizeColor(c)
  const ref = parseThemeRef(n)
  return ref ? themeColorOf(ref.slot, ref.pct) : hex(n)
}
/** A style's colour ("accent1:-35"), theme-linked. */
function styleColor(ref: ColorRef | undefined, fallback: string | undefined): Any {
  if (!ref) return fallback ? fallback.slice(1).toUpperCase() : undefined
  const [slot, pct] = ref.split(':')
  return themeColorOf(slot as Slot, Number(pct || 0))
}
const firstFamily = (ff: string) => ff.split(',')[0].replace(/["']/g, '').trim()
const pt2tw = (pt: number) => Math.round(pt * 20)

/** Line spacing: Word multiple ("1.15") or exact ("12pt"). */
function lineSpacing(v: string | number | null | undefined): Any {
  if (v == null || v === '') return {}
  const s = String(v)
  if (s.endsWith('pt')) return { line: pt2tw(parseFloat(s)), lineRule: LineRuleType.EXACT }
  const n = parseFloat(s)
  return Number.isFinite(n) ? { line: Math.round(n * 240), lineRule: LineRuleType.AUTO } : {}
}

function styleDef(s: ParaStyle): Any {
  return {
    run: {
      font: s.font || DEFAULT_FONT,
      size: Math.round(s.sizePt * 2),
      color: styleColor(s.colorRef, s.color),
      bold: s.bold || false,
      italics: s.italic || false,
      characterSpacing: s.letterSpacingPt ? pt2tw(s.letterSpacingPt) : undefined,
    },
    paragraph: {
      spacing: { before: pt2tw(s.spaceBeforePt), after: pt2tw(s.spaceAfterPt), ...lineSpacing(s.lineHeight) },
      keepNext: s.keepNext || undefined,
      keepLines: s.keepNext || undefined,
      alignment: s.align ? ALIGN[s.align] : undefined,
    },
  }
}

// ───────────── numbering ─────────────
const BULLET_CHARS: Record<string, string> = { disc: '●', circle: '○', square: '■', dash: '–', arrow: '➢', check: '✓' }
const NUM_FMT: Record<string, [Any, string]> = {
  decimal: [LevelFormat.DECIMAL, '%1.'],
  'decimal-paren': [LevelFormat.DECIMAL, '%1)'],
  'lower-alpha': [LevelFormat.LOWER_LETTER, '%1.'],
  'upper-alpha': [LevelFormat.UPPER_LETTER, '%1.'],
  'lower-roman': [LevelFormat.LOWER_ROMAN, '%1.'],
  'upper-roman': [LevelFormat.UPPER_ROMAN, '%1.'],
  'lower-greek': [LevelFormat.LOWER_LETTER, '%1.'],
}
const LEVEL_CYCLE: [Any, string][] = [
  [LevelFormat.DECIMAL, '%L.'], [LevelFormat.LOWER_LETTER, '%L.'], [LevelFormat.LOWER_ROMAN, '%L.'],
]

class Numbering {
  configs = new Map<string, Any>()
  private instances = 0

  ref(ordered: boolean, style: string | null, start: number): string {
    const st = style || (ordered ? 'decimal' : 'disc')
    const key = `${ordered ? 'num' : 'bul'}-${st}-${start}`
    if (!this.configs.has(key)) {
      const levels = Array.from({ length: 9 }, (_, lvl) => {
        const indent = { left: 720 * (lvl + 1), hanging: 360 }
        if (!ordered) {
          const ch = lvl === 0 ? BULLET_CHARS[st] || '●' : ['●', '○', '■'][lvl % 3]
          return {
            level: lvl, format: LevelFormat.BULLET, text: ch, alignment: AlignmentType.LEFT,
            style: { paragraph: { indent }, run: { font: ch === '●' || ch === '○' || ch === '■' ? 'Arial' : undefined } },
          }
        }
        const [fmt, text] = lvl === 0 ? NUM_FMT[st] || NUM_FMT.decimal : LEVEL_CYCLE[lvl % 3]
        return {
          level: lvl, format: fmt, text: text.replace('%1', `%${lvl + 1}`).replace('%L', `%${lvl + 1}`),
          alignment: AlignmentType.LEFT, start: lvl === 0 ? start : 1, style: { paragraph: { indent } },
        }
      })
      this.configs.set(key, { reference: key, levels })
    }
    return key
  }

  nextInstance() { return ++this.instances }
}

// ───────────── context & conversion ─────────────
interface Ctx {
  settings: DocSettings
  numbering: Numbering
  headingPages: Map<number, number>
  textWidthTw: number
  images: Map<string, PreparedPicture>
  headings: { text: string; level: number; pos: number; num: string; bookmark: string }[]
  captions: Map<JSONContent, string>
}

interface ParaCtx {
  list?: { reference: string; level: number; instance: number }
  listContinuation?: number // indent level for 2nd+ paragraphs of a list item
  quote?: boolean
  task?: boolean | null
}

function runOpts(marks: JSONContent['marks'] = []): Any {
  const o: Any = {}
  for (const m of marks) {
    const a = m.attrs || {}
    switch (m.type) {
      case 'bold': o.bold = true; break
      case 'italic': o.italics = true; break
      case 'underline': o.underline = {}; break
      case 'strike': o.strike = true; break
      case 'subscript': o.subScript = true; break
      case 'superscript': o.superScript = true; break
      case 'code': o.font = 'Courier New'; o.shading = { type: ShadingType.CLEAR, fill: 'F1F3F3', color: 'auto' }; break
      case 'highlight': {
        const c = colorHex(a.color) || '#ffff00'
        if (HIGHLIGHT_NAMES[c]) o.highlight = HIGHLIGHT_NAMES[c]
        else o.shading = { type: ShadingType.CLEAR, fill: c.slice(1).toUpperCase(), color: 'auto' }
        break
      }
      case 'textStyle': {
        if (a.fontFamily) o.font = firstFamily(a.fontFamily)
        const pt = fontSizeToPt(a.fontSize)
        if (pt) o.size = Math.round(pt * 2)
        const col = docxColor(a.color)
        if (col) o.color = col
        const bg = docxColor(a.backgroundColor)
        if (bg) o.shading = { type: ShadingType.CLEAR, fill: bg, color: 'auto' }
        break
      }
      case 'link': o.style = 'Hyperlink'; break
    }
  }
  return o
}

function textRuns(text: string, opts: Any): Any[] {
  // Tabs must be real <w:tab/> elements.
  const parts = text.split('\t')
  if (parts.length === 1) return [new TextRun({ ...opts, text })]
  const children: Any[] = []
  parts.forEach((p, i) => {
    if (i) children.push(new Tab())
    if (p) children.push(p)
  })
  return [new TextRun({ ...opts, children })]
}

function inlineRuns(node: JSONContent, ctx: Ctx, extra: Any = {}): Any[] {
  const out: Any[] = []
  let linkGroup: { href: string; runs: Any[] } | null = null
  const flush = () => {
    if (!linkGroup) return
    const href = linkGroup.href
    if (href.startsWith('#')) out.push(new InternalHyperlink({ anchor: href.slice(1), children: linkGroup.runs }))
    else out.push(new ExternalHyperlink({ link: href, children: linkGroup.runs }))
    linkGroup = null
  }
  const inline = node.content || []
  inline.forEach((c, index) => {
    const link = c.marks?.find((m) => m.type === 'link')
    const href = link?.attrs?.href as string | undefined
    let runs: Any[] = []
    if (c.type === 'text') runs = textRuns(c.text || '', { ...extra, ...runOpts(c.marks) })
    else if (c.type === 'hardBreak') runs = [new TextRun({ ...extra, break: 1 })]
    else if (c.type === 'image') {
      const a = pictureAttrs(c)
      const img = ctx.images.get(pictureKey(a))
      if (img) {
        const EMU = 9525 // per px
        const dist = a.wrap && TEXT_DISTANCE[a.wrap]
        const floating = a.wrap && dist
          ? {
              horizontalPosition: a.x != null ? { relative: HorizontalPositionRelativeFrom.COLUMN, offset: Math.round(a.x * EMU) } : {
                relative: HorizontalPositionRelativeFrom.COLUMN,
                align: a.wrap === 'square'
                  ? (a.align === 'right' ? HorizontalPositionAlign.RIGHT : HorizontalPositionAlign.LEFT)
                  : a.align === 'left' ? HorizontalPositionAlign.LEFT : a.align === 'right' ? HorizontalPositionAlign.RIGHT : HorizontalPositionAlign.CENTER,
              },
              verticalPosition: {
                relative: anchoredAtStart(inline, index) ? VerticalPositionRelativeFrom.PARAGRAPH : VerticalPositionRelativeFrom.LINE,
                offset: Math.round((a.y || 0) * EMU),
              },
              // Text wraps on one side, as in Grafi: left of a right-hand picture, right of a left-hand one.
              wrap: a.wrap === 'square'
                ? { type: TextWrappingType.SQUARE, side: a.align === 'right' ? TextWrappingSide.LEFT : TextWrappingSide.RIGHT }
                : { type: TextWrappingType.TOP_AND_BOTTOM, side: TextWrappingSide.BOTH_SIDES },
              margins: { top: Math.round(dist.top * EMU), bottom: Math.round(dist.bottom * EMU), left: Math.round(dist.side * EMU), right: Math.round(dist.side * EMU) },
              allowOverlap: false,
              lockAnchor: false,
            }
          : undefined
        runs = [new ImageRun({
          type: img.type, data: img.bytes, transformation: { width: img.w, height: img.h }, floating,
          altText: a.alt ? { name: a.alt, description: a.alt, title: a.alt } : undefined,
        } as Any)]
      }
    }
    if (href) {
      if (linkGroup && linkGroup.href !== href) flush()
      if (!linkGroup) linkGroup = { href, runs: [] }
      linkGroup.runs.push(...runs)
    } else {
      flush()
      out.push(...runs)
    }
  })
  flush()
  return out
}

function paragraphProps(node: JSONContent, pc: ParaCtx): Any {
  const a = node.attrs || {}
  const p: Any = {}
  if (a.textAlign && ALIGN[a.textAlign]) p.alignment = ALIGN[a.textAlign]
  const spacing: Any = { ...lineSpacing(a.lineHeight) }
  if (a.spaceBefore != null) spacing.before = pt2tw(a.spaceBefore)
  if (a.spaceAfter != null) spacing.after = pt2tw(a.spaceAfter)
  if (Object.keys(spacing).length) p.spacing = spacing
  const indent: Any = {}
  const listIndent = pc.listContinuation != null ? 720 * (pc.listContinuation + 1) : 0
  if (a.indentLeft != null || listIndent) indent.left = pt2tw(a.indentLeft || 0) + listIndent
  if (a.indentRight != null) indent.right = pt2tw(a.indentRight)
  if (a.firstLine != null) {
    if (a.firstLine >= 0) indent.firstLine = pt2tw(a.firstLine)
    else indent.hanging = pt2tw(-a.firstLine)
  }
  if (Object.keys(indent).length) p.indent = indent
  if (a.pageBreakBefore) p.pageBreakBefore = true
  if (a.keepNext) p.keepNext = true
  const sh = docxColor(a.shading)
  if (sh) p.shading = { type: ShadingType.CLEAR, fill: sh, color: 'auto' }
  if (pc.list) p.numbering = pc.list
  return p
}

function convertBlock(node: JSONContent, ctx: Ctx, pc: ParaCtx = {}): Any[] {
  const a = node.attrs || {}
  switch (node.type) {
    case 'paragraph': {
      const props = paragraphProps(node, pc)
      let style = a.styleId && a.styleId !== 'Normal' ? a.styleId : undefined
      if (pc.quote && !style) style = 'Quote'
      const prefix = pc.task != null ? [new TextRun({ text: pc.task ? '☒ ' : '☐ ', font: 'Segoe UI Symbol' })] : []
      const cap = ctx.captions.get(node)
      if (cap) prefix.push(new TextRun({ text: cap }))
      return [new Paragraph({ ...props, style, children: [...prefix, ...inlineRuns(node, ctx)] })]
    }
    case 'heading': {
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
      const h = ctx.headings.find((x) => x.pos === (node as Any).__pos)
      const runs = inlineRuns(node, ctx)
      const numbered = ctx.settings.headingNumbers
        ? { numbering: { reference: 'grafi-headings', level: Math.min(8, (a.level || 1) - 1), custom: true } }
        : {}
      return [new Paragraph({
        ...paragraphProps(node, pc),
        ...numbered,
        heading: levels[(a.level || 1) - 1],
        children: h ? [new Bookmark({ id: h.bookmark, children: runs })] : runs,
      })]
    }
    case 'blockquote':
      return (node.content || []).flatMap((c) => convertBlock(c, ctx, { ...pc, quote: true }))
    case 'codeBlock': {
      const text = (node.content || []).map((c) => c.text || '').join('')
      return text.split('\n').map((line, i, arr) => new Paragraph({
        spacing: { before: 0, after: i === arr.length - 1 ? 160 : 0, line: 240, lineRule: LineRuleType.AUTO },
        shading: { type: ShadingType.CLEAR, fill: 'F4F6F6', color: 'auto' },
        children: textRuns(line || ' ', { font: 'Courier New', size: 20 }),
      }))
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return convertList(node, ctx, pc, 0)
    case 'horizontalRule':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'A6B5B5', space: 1 } }, children: [] })]
    case 'pageBreak':
      // Section breaks become separate sections in exportDocx; nested ones fall back to a page break.
      if (node.attrs?.kind === 'continuous') return []
      return [new Paragraph({ children: [node.attrs?.kind === 'column' ? new ColumnBreak() : new PageBreak()] })]
    case 'table':
      return [convertTable(node, ctx)]
    case 'tableOfContents':
      return convertToc(node, ctx)
    default:
      return node.content ? node.content.flatMap((c) => convertBlock(c, ctx, pc)) : []
  }
}

function convertList(list: JSONContent, ctx: Ctx, pc: ParaCtx, level: number, instance?: number): Any[] {
  const out: Any[] = []
  const isTask = list.type === 'taskList'
  const ordered = list.type === 'orderedList'
  const reference = isTask ? '' : ctx.numbering.ref(ordered, list.attrs?.listStyle ?? null, list.attrs?.start ?? 1)
  const inst = instance ?? ctx.numbering.nextInstance()
  for (const item of list.content || []) {
    let first = true
    for (const child of item.content || []) {
      if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
        // Nested list of the same kind continues the instance; a different kind starts its own.
        const sameKind = child.type === list.type
        out.push(...convertList(child, ctx, pc, Math.min(level + 1, 8), sameKind ? inst : undefined))
        continue
      }
      if (child.type === 'paragraph' || child.type === 'heading') {
        const sub: ParaCtx = { ...pc }
        if (isTask) {
          sub.task = first ? !!item.attrs?.checked : null
          sub.listContinuation = level
        } else if (first) sub.list = { reference, level, instance: inst }
        else sub.listContinuation = level
        out.push(...convertBlock(child, ctx, sub))
        first = false
      } else {
        out.push(...convertBlock(child, ctx, { ...pc, listContinuation: level }))
      }
    }
  }
  return out
}

function convertTable(table: JSONContent, ctx: Ctx): Any {
  const rows = table.content || []
  // Column count from the first row (respecting colspan).
  const firstRow = rows[0]?.content || []
  const widthsPx: number[] = []
  for (const c of firstRow) {
    const span = c.attrs?.colspan || 1
    const cw = c.attrs?.colwidth as number[] | null
    for (let i = 0; i < span; i++) widthsPx.push(cw?.[i] || 0)
  }
  const known = widthsPx.filter(Boolean).reduce((a, b) => a + b, 0)
  const unknown = widthsPx.filter((w) => !w).length
  const textPx = ctx.textWidthTw / 15
  const fill = unknown ? Math.max(24, (textPx - known) / unknown) : 0
  const colTw = widthsPx.map((w) => Math.round((w || fill) * 15))

  return new Table({
    columnWidths: colTw,
    width: { size: colTw.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    rows: rows.map((r) => {
      let col = 0
      const cells = (r.content || []).map((cell) => {
        const ca = cell.attrs || {}
        const span = ca.colspan || 1
        const w = colTw.slice(col, col + span).reduce((a, b) => a + b, 0)
        col += span
        const kids = (cell.content || []).flatMap((b) => convertBlock(b, ctx))
        if (kids.length && kids[kids.length - 1] instanceof Table) kids.push(new Paragraph({ children: [] }))
        const isHeader = cell.type === 'tableHeader'
        const bg = docxColor(ca.backgroundColor) || (isHeader ? themeColorOf('accent1', HEADER_TINT) : undefined)
        return new TableCell({
          children: kids.length ? kids : [new Paragraph({ children: [] })],
          columnSpan: span > 1 ? span : undefined,
          rowSpan: (ca.rowspan || 1) > 1 ? ca.rowspan : undefined,
          width: { size: w, type: WidthType.DXA },
          shading: bg ? { type: ShadingType.CLEAR, fill: bg, color: 'auto' } : undefined,
          verticalAlign: ca.verticalAlign === 'middle' ? VerticalAlign.CENTER : ca.verticalAlign === 'bottom' ? VerticalAlign.BOTTOM : undefined,
          margins: { top: 40, bottom: 40, left: 100, right: 100 },
        })
      })
      const header = (r.content || []).every((c) => c.type === 'tableHeader')
      return new TableRow({ children: cells, tableHeader: header || undefined })
    }),
  })
}

function convertToc(node: JSONContent, ctx: Ctx): Any[] {
  const max = node.attrs?.maxLevel || 3
  const out: Any[] = [new Paragraph({ style: 'TOCHeading', children: [new TextRun(t('toc.title'))] })]
  for (const h of ctx.headings.filter((x) => x.level <= max)) {
    out.push(new Paragraph({
      style: `TOC${h.level}`,
      tabStops: [{ type: TabStopType.RIGHT, position: ctx.textWidthTw, leader: 'dot' } as Any],
      children: [
        new InternalHyperlink({
          anchor: h.bookmark,
          children: [
            new TextRun(ctx.settings.headingNumbers ? `${h.num}  ${h.text}` : h.text),
            new TextRun({ children: [new Tab(), String(ctx.headingPages.get(h.pos) ?? '')] }),
          ],
        }),
      ],
    }))
  }
  return out
}

function hfParagraph(text: string, align: string, title: string): Any {
  const children: Any[] = []
  const re = /\{(page|pages|date|title)\}/g
  let last = 0
  let m: RegExpExecArray | null
  const runs: Any[] = []
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(text.slice(last, m.index))
    if (m[1] === 'page') runs.push(PageNumber.CURRENT)
    else if (m[1] === 'pages') runs.push(PageNumber.TOTAL_PAGES)
    else if (m[1] === 'date') runs.push(fmtDate())
    else runs.push(title)
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push(text.slice(last))
  if (runs.length) children.push(new TextRun({ children: runs, size: 20, color: '555555' }))
  return new Paragraph({ alignment: ALIGN[align] || AlignmentType.CENTER, children })
}

const SECTION_TYPE: Partial<Record<BreakKind, (typeof SectionType)[keyof typeof SectionType]>> = {
  nextPage: SectionType.NEXT_PAGE, continuous: SectionType.CONTINUOUS, evenPage: SectionType.EVEN_PAGE, oddPage: SectionType.ODD_PAGE,
}

export async function exportDocx(doc: JSONContent, settings: DocSettings, headingPages: Map<number, number>): Promise<Uint8Array> {
  const { margins: m } = settings
  const ctx: Ctx = {
    settings,
    numbering: new Numbering(),
    headingPages,
    textWidthTw: mmToTwip(settings.width - m.left - m.right),
    images: new Map(),
    headings: collectHeadingsJson(doc).map((h, i) => ({ ...h, bookmark: `_Toc${String(100000 + i)}` })),
    captions: captionNumbers(doc),
  }

  // Pre-render pictures (async: decoding, shape/crop/shadow baking), then convert synchronously.
  ctx.images = await preparePictures(doc, ctx.textWidthTw / 15)

  // Top-level section breaks split the body into sections; each one's `type` says how it starts.
  const parts: { type?: BreakKind; blocks: JSONContent[] }[] = [{ blocks: [] }]
  for (const b of doc.content || []) {
    if (b.type === 'pageBreak' && isSectionBreak(b.attrs?.kind)) parts.push({ type: b.attrs!.kind, blocks: [] })
    else parts[parts.length - 1].blocks.push(b)
  }
  const bodies = parts.map((part) => {
    const children = part.blocks.flatMap((b) => convertBlock(b, ctx))
    // Word requires a paragraph after a table that ends a section.
    if (!children.length || children[children.length - 1] instanceof Table) children.push(new Paragraph({ spacing: { after: 0 }, children: [] }))
    return children
  })
  const hf = settings.hf
  const title = settings.title || ''
  const mkHeader = (t: string) => new Header({ children: [hfParagraph(t, hf.headerAlign, title)] })
  const mkFooter = (t: string) => new Footer({ children: [hfParagraph(t, hf.footerAlign, title)] })

  const byId = (id: string) => styleDef(PARA_STYLES.find((s) => s.id === id)!)
  const normal = PARA_STYLES[0]
  const th = currentTheme
  const up = (c: string) => c.slice(1).toUpperCase()
  const d = new Document({
    theme: {
      name: th.name,
      colors: {
        dark1: up(th.colors.dk1), light1: up(th.colors.lt1), dark2: up(th.colors.dk2), light2: up(th.colors.lt2),
        accent1: up(th.colors.accent1), accent2: up(th.colors.accent2), accent3: up(th.colors.accent3),
        accent4: up(th.colors.accent4), accent5: up(th.colors.accent5), accent6: up(th.colors.accent6),
        hyperlink: up(th.colors.hlink), followedHyperlink: up(th.colors.folHlink),
      },
      fonts: { headings: th.fonts.major, body: th.fonts.minor },
    },
    creator: settings.author || 'Graphi',
    title: settings.title || undefined,
    description: t('io.createdWith'),
    features: { updateFields: false },
    styles: {
      default: {
        document: {
          run: { font: normal.font || DEFAULT_FONT, size: normal.sizePt * 2 },
          paragraph: { spacing: { before: 0, after: pt2tw(normal.spaceAfterPt), ...lineSpacing(normal.lineHeight) } },
        },
        title: byId('Title'),
        heading1: byId('Heading1'), heading2: byId('Heading2'), heading3: byId('Heading3'),
        heading4: byId('Heading4'), heading5: byId('Heading5'), heading6: byId('Heading6'),
        hyperlink: { run: { color: { theme: 'hyperlink' }, underline: {} } },
      } as Any,
      paragraphStyles: [
        { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...byId('Subtitle') },
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...byId('Quote') },
        { id: 'NoSpacing', name: 'No Spacing', basedOn: 'Normal', quickFormat: true, ...byId('NoSpacing') },
        { id: 'Caption', name: 'caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...byId('Caption') },
        { id: 'TOCHeading', name: 'TOC Heading', basedOn: 'Heading1', next: 'Normal', ...byId('Heading1') },
        ...[1, 2, 3, 4, 5, 6].map((l) => ({
          id: `TOC${l}`, name: `toc ${l}`, basedOn: 'Normal', next: 'Normal',
          paragraph: { spacing: { after: 100 }, indent: { left: 220 * (l - 1) } },
        })),
      ],
    },
    numbering: {
      config: [
        ...ctx.numbering.configs.values(),
        {
          // Multilevel list linked to the Heading styles: 1 / 1.1 / 1.1.1 …
          reference: 'grafi-headings',
          levels: Array.from({ length: 9 }, (_, l) => ({
            level: l, format: LevelFormat.DECIMAL, alignment: AlignmentType.LEFT, suffix: LevelSuffix.SPACE,
            text: Array.from({ length: l + 1 }, (_, i) => `%${i + 1}`).join('.'),
            style: { paragraph: { indent: { left: 0, hanging: 0 } } },
          })),
        },
      ],
    },
    sections: parts.map((part, i) => ({
        properties: {
          type: part.type ? SECTION_TYPE[part.type] : undefined,
          titlePage: (i === 0 && hf.differentFirstPage) || undefined,
          page: {
            size: {
              // docx swaps width/height itself for landscape; give it portrait dimensions.
              width: mmToTwip(Math.min(settings.width, settings.height)),
              height: mmToTwip(Math.max(settings.width, settings.height)),
              orientation: settings.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: mmToTwip(m.top), right: mmToTwip(m.right), bottom: mmToTwip(m.bottom), left: mmToTwip(m.left),
              header: mmToTwip(hf.headerDistance), footer: mmToTwip(hf.footerDistance), gutter: 0,
            },
          },
          column: settings.columns > 1 ? { count: settings.columns, space: mmToTwip(settings.columnGap), equalWidth: true } : undefined,
        },
        // Later sections inherit (link to previous) the first section's headers and footers.
        headers: i === 0 && hf.headerText
          ? { default: mkHeader(hf.headerText), ...(hf.differentFirstPage ? { first: new Header({ children: [new Paragraph({ children: [] })] }) } : {}) }
          : undefined,
        footers: i === 0 && hf.footerText
          ? { default: mkFooter(hf.footerText), ...(hf.differentFirstPage ? { first: new Footer({ children: [new Paragraph({ children: [] })] }) } : {}) }
          : undefined,
        children: bodies[i],
      })),
  })
  const buf = await Packer.toArrayBuffer(d)
  return new Uint8Array(buf)
}
