// OpenDocument Text (.odt) — LibreOffice Writer's native format (ODF 1.3).
// Export: ProseMirror JSON → content.xml/styles.xml with automatic styles.
// Import: content.xml/styles.xml → HTML with inline CSS, parsed by the editor schema.
import JSZip from 'jszip'
import type { JSONContent } from '@tiptap/core'
import { normalizeSettings, detectPaper, type DocSettings } from '../model/settings'
import { DEFAULT_FONT, PARA_STYLES, type ParaStyle } from '../model/styles'
import { fontSizeToPt, colorHex } from '../editor/units'
import { tableHeaderFill } from '../model/docCss'
import { captionNumbers, collectHeadingsJson, escapeXml, escapeHtml } from './common'
import { bytesToDataUrl } from './images'
import { anchoredAtStart, pictureAttrs, pictureKey, preparePictures } from './pictures'
import { MIN_Y, TEXT_DISTANCE } from '../editor/image'
import { t, fmtDate } from '../i18n'

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"',
].join(' ')

const firstFamily = (ff: string) => ff.split(',')[0].replace(/["']/g, '').trim()
const odfName = (id: string) => ({ Heading1: 'Heading_20_1', Heading2: 'Heading_20_2', Heading3: 'Heading_20_3', Heading4: 'Heading_20_4', Heading5: 'Heading_20_5', Heading6: 'Heading_20_6', Normal: 'Standard', Quote: 'Quotations', NoSpacing: 'No_20_Spacing' } as Record<string, string>)[id] || id
const displayName = (id: string) => ({ Heading_20_1: 'Heading 1', Heading_20_2: 'Heading 2', Heading_20_3: 'Heading 3', Heading_20_4: 'Heading 4', Heading_20_5: 'Heading 5', Heading_20_6: 'Heading 6', Standard: 'Standard', Quotations: 'Quotations', No_20_Spacing: 'No Spacing', Title: 'Title', Subtitle: 'Subtitle' } as Record<string, string>)[id] || id

function lineHeightAttr(v: string | number | null | undefined) {
  if (v == null || v === '') return ''
  const s = String(v)
  if (s.endsWith('pt')) return ` fo:line-height="${s}"`
  const n = parseFloat(s)
  return Number.isFinite(n) ? ` fo:line-height="${Math.round(n * 100)}%"` : ''
}

class AutoStyles {
  private map = new Map<string, string>()
  entries: string[] = []
  fonts = new Set<string>([DEFAULT_FONT, 'Calibri Light', 'Courier New'])
  private counters: Record<string, number> = {}

  get(family: string, prefix: string, body: string, parent?: string): string {
    const key = `${family}|${parent || ''}|${body}`
    const hit = this.map.get(key)
    if (hit) return hit
    this.counters[prefix] = (this.counters[prefix] || 0) + 1
    const name = `${prefix}${this.counters[prefix]}`
    this.map.set(key, name)
    this.entries.push(`<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}>${body}</style:style>`)
    return name
  }

  raw(xml: string) { this.entries.push(xml) }
}

function textProps(marks: JSONContent['marks'] = [], fonts: Set<string>): string {
  const a: string[] = []
  for (const m of marks) {
    const at = m.attrs || {}
    switch (m.type) {
      case 'bold': a.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"'); break
      case 'italic': a.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"'); break
      case 'underline': a.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"'); break
      case 'strike': a.push('style:text-line-through-style="solid" style:text-line-through-type="single"'); break
      case 'subscript': a.push('style:text-position="sub 58%"'); break
      case 'superscript': a.push('style:text-position="super 58%"'); break
      case 'code': fonts.add('Courier New'); a.push('style:font-name="Courier New" fo:background-color="#f1f3f3"'); break
      case 'highlight': a.push(`fo:background-color="${colorHex(at.color) || '#ffff00'}"`); break
      case 'textStyle': {
        if (at.fontFamily) { const f = firstFamily(at.fontFamily); fonts.add(f); a.push(`style:font-name="${escapeXml(f)}"`) }
        const pt = fontSizeToPt(at.fontSize); if (pt) a.push(`fo:font-size="${pt}pt" style:font-size-asian="${pt}pt" style:font-size-complex="${pt}pt"`)
        const c = colorHex(at.color); if (c) a.push(`fo:color="${c}"`)
        const bg = colorHex(at.backgroundColor); if (bg) a.push(`fo:background-color="${bg}"`)
        break
      }
    }
  }
  return a.length ? `<style:text-properties ${a.join(' ')}/>` : ''
}

function textXml(t: string) {
  // Preserve runs of spaces and tabs.
  return escapeXml(t)
    .replace(/\t/g, '<text:tab/>')
    .replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`)
    .replace(/^ /, '<text:s/>')
}

interface Ctx {
  auto: AutoStyles
  pics: Map<string, { path: string; bytes: Uint8Array; mime: string; w: number; h: number }>
  headingPages: Map<number, number>
  headings: { level: number; text: string; pos: number; num: string }[]
  captions: Map<JSONContent, string>
  numbered: boolean
  pendingBreak: boolean
  listStyles: Map<string, string>
  tableN: number
  textWidthMm: number
}

function inlineXml(n: JSONContent, ctx: Ctx): string {
  let out = ''
  const inline = n.content || []
  inline.forEach((c, index) => {
    let x = ''
    if (c.type === 'text') {
      const props = textProps(c.marks?.filter((m) => m.type !== 'link'), ctx.auto.fonts)
      x = props ? `<text:span text:style-name="${ctx.auto.get('text', 'T', props)}">${textXml(c.text || '')}</text:span>` : textXml(c.text || '')
    } else if (c.type === 'hardBreak') x = '<text:line-break/>'
    else if (c.type === 'image') {
      const a = pictureAttrs(c)
      const pic = ctx.pics.get(pictureKey(a))
      if (pic) {
        const mm = (px: number) => `${((px * 25.4) / 96).toFixed(2)}mm`
        let style = 'fr1'
        let anchor = 'as-char'
        if (a.wrap) {
          // At the paragraph's start our line-relative `y` is paragraph-relative; further in, the
          // frame is anchored to its character and measured from it (≈ the top of its line).
          const atStart = anchoredAtStart(inline, index)
          anchor = atStart ? 'paragraph' : 'char'
          const d = TEXT_DISTANCE[a.wrap]
          const pt = (px: number) => `${((px * 72) / 96).toFixed(2)}pt`
          const hpos = a.x != null ? 'from-left' : a.wrap === 'square' ? (a.align === 'right' ? 'right' : 'left') : a.align === 'left' ? 'left' : a.align === 'right' ? 'right' : 'center'
          // Square: text on one side, as in Grafi — left of a right-hand picture, right of a left-hand one.
          const wrap = a.wrap === 'topBottom' ? 'none' : a.align === 'right' ? 'left' : 'right'
          style = ctx.auto.get('graphic', 'fr', `<style:graphic-properties style:wrap="${wrap}" style:number-wrapped-paragraphs="no-limit" style:horizontal-pos="${hpos}" style:horizontal-rel="paragraph" style:vertical-pos="${a.y ? 'from-top' : 'top'}" style:vertical-rel="${atStart ? 'paragraph' : 'char'}" fo:margin-top="${pt(d.top)}" fo:margin-bottom="${pt(d.bottom)}" fo:margin-left="${pt(d.side)}" fo:margin-right="${pt(d.side)}" fo:border="none"/>`, 'Graphics')
        }
        x = `<draw:frame draw:style-name="${style}" text:anchor-type="${anchor}"${a.wrap && a.x != null ? ` svg:x="${mm(a.x)}"` : ''}${a.wrap && a.y ? ` svg:y="${mm(a.y)}"` : ''} svg:width="${mm(pic.w)}" svg:height="${mm(pic.h)}" draw:z-index="0"><draw:image xlink:href="${pic.path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${pic.mime}"/>${a.alt ? `<svg:desc>${escapeXml(a.alt)}</svg:desc>` : ''}</draw:frame>`
      }
    }
    const link = c.marks?.find((m) => m.type === 'link')
    if (link) x = `<text:a xlink:type="simple" xlink:href="${escapeXml(link.attrs?.href || '')}">${x}</text:a>`
    out += x
  })
  return out
}

function paraStyle(n: JSONContent, ctx: Ctx, parent: string, extra = ''): string {
  const a = n.attrs || {}
  const p: string[] = []
  if (a.textAlign) p.push(`fo:text-align="${a.textAlign === 'left' ? 'start' : a.textAlign === 'right' ? 'end' : a.textAlign}"`)
  if (a.spaceBefore != null) p.push(`fo:margin-top="${a.spaceBefore}pt"`)
  if (a.spaceAfter != null) p.push(`fo:margin-bottom="${a.spaceAfter}pt"`)
  if (a.indentLeft != null) p.push(`fo:margin-left="${a.indentLeft}pt"`)
  if (a.indentRight != null) p.push(`fo:margin-right="${a.indentRight}pt"`)
  if (a.firstLine != null) p.push(`fo:text-indent="${a.firstLine}pt"`)
  if (a.keepNext) p.push('fo:keep-with-next="always"')
  if (a.shading) p.push(`fo:background-color="${a.shading}"`)
  if (a.pageBreakBefore || ctx.pendingBreak) p.push('fo:break-before="page"')
  ctx.pendingBreak = false
  const lh = lineHeightAttr(a.lineHeight)
  const body = (p.length || lh || extra ? `<style:paragraph-properties ${p.join(' ')}${lh}${extra}/>` : '')
  return body ? ctx.auto.get('paragraph', 'P', body, parent) : parent
}

function listStyleXml(name: string, ordered: boolean, style: string | null) {
  const levels: string[] = []
  const bullets: Record<string, string> = { disc: '●', circle: '○', square: '■', dash: '–', arrow: '➢', check: '✓' }
  const numFmt: Record<string, [string, string]> = {
    decimal: ['1', '.'], 'decimal-paren': ['1', ')'], 'lower-alpha': ['a', '.'], 'upper-alpha': ['A', '.'],
    'lower-roman': ['i', '.'], 'upper-roman': ['I', '.'], 'lower-greek': ['α', '.'],
  }
  const cycle: [string, string][] = [['1', '.'], ['a', '.'], ['i', '.']]
  for (let l = 1; l <= 10; l++) {
    const pos = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(0.5 * l).toFixed(2)}in" fo:text-indent="-0.25in" fo:margin-left="${(0.5 * l).toFixed(2)}in"/></style:list-level-properties>`
    if (!ordered) {
      const ch = l === 1 ? bullets[style || 'disc'] || '●' : ['●', '○', '■'][(l - 1) % 3]
      levels.push(`<text:list-level-style-bullet text:level="${l}" text:bullet-char="${ch}">${pos}</text:list-level-style-bullet>`)
    } else {
      const [f, suf] = l === 1 ? numFmt[style || 'decimal'] || numFmt.decimal : cycle[(l - 1) % 3]
      levels.push(`<text:list-level-style-number text:level="${l}" style:num-suffix="${suf}" style:num-format="${f}">${pos}</text:list-level-style-number>`)
    }
  }
  return `<text:list-style style:name="${name}">${levels.join('')}</text:list-style>`
}

function blockXml(n: JSONContent, ctx: Ctx, opts: { parent?: string; quote?: boolean } = {}): string {
  const a = n.attrs || {}
  switch (n.type) {
    case 'paragraph': {
      const base = a.styleId ? odfName(a.styleId) : opts.quote ? 'Quotations' : opts.parent || 'Standard'
      const cap = ctx.captions.get(n)
      return `<text:p text:style-name="${paraStyle(n, ctx, base)}">${cap ? textXml(cap) : ''}${inlineXml(n, ctx)}</text:p>`
    }
    case 'heading': {
      const lvl = a.level || 1
      return `<text:h text:style-name="${paraStyle(n, ctx, `Heading_20_${lvl}`)}" text:outline-level="${lvl}">${inlineXml(n, ctx)}</text:h>`
    }
    case 'blockquote': return (n.content || []).map((c) => blockXml(c, ctx, { quote: true })).join('')
    case 'codeBlock': {
      const text = (n.content || []).map((c) => c.text || '').join('')
      return text.split('\n').map((line) => `<text:p text:style-name="${ctx.auto.get('paragraph', 'P', '<style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt" fo:background-color="#f4f6f6"/><style:text-properties style:font-name="Courier New" fo:font-size="10pt"/>', 'Standard')}">${textXml(line)}</text:p>`).join('')
    }
    case 'bulletList': case 'orderedList': case 'taskList': return listXml(n, ctx, true)
    case 'horizontalRule': return `<text:p text:style-name="${ctx.auto.get('paragraph', 'P', '<style:paragraph-properties fo:border-bottom="0.5pt solid #a6b5b5" fo:padding="0mm"/>', 'Standard')}"/>`
    case 'pageBreak': ctx.pendingBreak = true; return ''
    case 'table': return tableXml(n, ctx)
    case 'tableOfContents': {
      const rows = ctx.headings.filter((h) => h.level <= (a.maxLevel || 3))
      const title = `<text:p text:style-name="Contents_20_Heading">${escapeXml(t('toc.title'))}</text:p>`
      return title + rows.map((h) => `<text:p text:style-name="Contents_20_${h.level}">${ctx.numbered ? `${h.num}  ` : ''}${escapeXml(h.text)}<text:tab/>${ctx.headingPages.get(h.pos) ?? ''}</text:p>`).join('')
    }
    default: return (n.content || []).map((c) => blockXml(c, ctx, opts)).join('')
  }
}

function listXml(n: JSONContent, ctx: Ctx, top: boolean): string {
  const ordered = n.type === 'orderedList'
  const key = `${ordered}-${n.attrs?.listStyle || ''}`
  let style = ctx.listStyles.get(key)
  if (!style) {
    style = `L${ctx.listStyles.size + 1}`
    ctx.listStyles.set(key, style)
    ctx.auto.raw(listStyleXml(style, ordered, n.attrs?.listStyle || null))
  }
  const startVal = ordered ? n.attrs?.start ?? 1 : 1
  const items = (n.content || []).map((li, idx) => {
    const inner = (li.content || []).map((c, i) => {
      if ((c.type || '').endsWith('List')) return listXml(c, ctx, false)
      if (n.type === 'taskList' && i === 0 && c.type === 'paragraph') {
        const box = li.attrs?.checked ? '☒ ' : '☐ '
        return blockXml({ ...c, content: [{ type: 'text', text: box }, ...(c.content || [])] }, ctx)
      }
      return blockXml(c, ctx, { parent: 'List_20_Paragraph' })
    }).join('')
    return `<text:list-item${idx === 0 && startVal !== 1 ? ` text:start-value="${startVal}"` : ''}>${inner}</text:list-item>`
  }).join('')
  const start = ordered && (n.attrs?.start ?? 1) !== 1 ? ` text:continue-numbering="false"` : ''
  return `<text:list${top ? ` text:style-name="${style}"` : ''}${start}>${items}</text:list>`
}

function tableXml(n: JSONContent, ctx: Ctx): string {
  const name = `Table${++ctx.tableN}`
  const rows = n.content || []
  const first = rows[0]?.content || []
  const widths: number[] = []
  for (const c of first) for (let i = 0; i < (c.attrs?.colspan || 1); i++) widths.push(c.attrs?.colwidth?.[i] || 0)
  const cols = widths.length || 1
  const totalPx = (ctx.textWidthMm * 96) / 25.4
  const known = widths.reduce((s, w) => s + w, 0)
  const unknown = widths.filter((w) => !w).length
  const fill = unknown ? Math.max(20, (totalPx - known) / unknown) : 0
  const colMm = widths.map((w) => (((w || fill) * 25.4) / 96).toFixed(2))
  const tableW = colMm.reduce((s, w) => s + parseFloat(w), 0).toFixed(2)
  // A page break right before the table belongs to the table, not to its first cell.
  const breakBefore = ctx.pendingBreak ? ' fo:break-before="page"' : ''
  ctx.pendingBreak = false
  ctx.auto.raw(`<style:style style:name="${name}" style:family="table"><style:table-properties style:width="${tableW}mm" table:align="margins" fo:margin-bottom="8pt"${breakBefore}/></style:style>`)
  colMm.forEach((w, i) => ctx.auto.raw(`<style:style style:name="${name}.C${i + 1}" style:family="table-column"><style:table-column-properties style:column-width="${w}mm"/></style:style>`))
  const covered = new Set<string>() // "row:col" occupied by row spans
  const rowXml = rows.map((r, ri) => {
    let col = 0
    let cells = ''
    for (const cell of r.content || []) {
      while (covered.has(`${ri}:${col}`)) { cells += '<table:covered-table-cell/>'; col++ }
      const ca = cell.attrs || {}
      const cs = ca.colspan || 1
      const rs = ca.rowspan || 1
      for (let dr = 1; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) covered.add(`${ri + dr}:${col + dc}`)
      const bg = colorHex(ca.backgroundColor) || (cell.type === 'tableHeader' ? tableHeaderFill() : null)
      const va = ca.verticalAlign === 'middle' ? 'middle' : ca.verticalAlign === 'bottom' ? 'bottom' : 'top'
      const cellStyle = ctx.auto.get('table-cell', 'Cell', `<style:table-cell-properties fo:padding-left="0.1in" fo:padding-right="0.1in" fo:padding-top="0.02in" fo:padding-bottom="0.02in" fo:border="0.5pt solid #7f8c8c" style:vertical-align="${va}"${bg ? ` fo:background-color="${bg}"` : ''}/>`)
      const inner = (cell.content || []).map((b) => blockXml(b, ctx, { parent: 'Table_20_Contents' })).join('') || '<text:p/>'
      cells += `<table:table-cell table:style-name="${cellStyle}" office:value-type="string"${cs > 1 ? ` table:number-columns-spanned="${cs}"` : ''}${rs > 1 ? ` table:number-rows-spanned="${rs}"` : ''}>${inner}</table:table-cell>`
      for (let i = 1; i < cs; i++) cells += '<table:covered-table-cell/>'
      col += cs
    }
    while (col < cols) { cells += covered.has(`${ri}:${col}`) ? '<table:covered-table-cell/>' : '<table:table-cell office:value-type="string"><text:p/></table:table-cell>'; col++ }
    const header = (r.content || []).every((c) => c.type === 'tableHeader')
    return { header, xml: `<table:table-row>${cells}</table:table-row>` }
  })
  const headerRows = rowXml.filter((r, i) => r.header && rowXml.slice(0, i).every((x) => x.header)).length
  const body = (headerRows ? `<table:table-header-rows>${rowXml.slice(0, headerRows).map((r) => r.xml).join('')}</table:table-header-rows>` : '') +
    rowXml.slice(headerRows).map((r) => r.xml).join('')
  return `<table:table table:name="${name}" table:style-name="${name}">${colMm.map((_, i) => `<table:table-column table:style-name="${name}.C${i + 1}"/>`).join('')}${body}</table:table>`
}

function styleXml(s: ParaStyle, name: string, display: string, extra = ''): string {
  const font = s.font || DEFAULT_FONT
  const tp = [`style:font-name="${font}"`, `fo:font-size="${s.sizePt}pt"`, `style:font-size-asian="${s.sizePt}pt"`, `style:font-size-complex="${s.sizePt}pt"`]
  if (s.color) tp.push(`fo:color="${s.color}"`)
  if (s.bold) tp.push('fo:font-weight="bold"')
  if (s.italic) tp.push('fo:font-style="italic"')
  if (s.letterSpacingPt) tp.push(`fo:letter-spacing="${s.letterSpacingPt}pt"`)
  const pp = [`fo:margin-top="${s.spaceBeforePt}pt"`, `fo:margin-bottom="${s.spaceAfterPt}pt"`, `fo:line-height="${Math.round(s.lineHeight * 100)}%"`]
  if (s.align) pp.push(`fo:text-align="${s.align}"`)
  if (s.keepNext) pp.push('fo:keep-with-next="always"')
  const outline = s.node === 'heading' ? ` style:default-outline-level="${s.level}"` : ''
  const parent = name === 'Standard' ? '' : ' style:parent-style-name="Standard"'
  return `<style:style style:name="${name}" style:display-name="${display}" style:family="paragraph"${parent}${outline} style:next-style-name="Standard" style:class="text"><style:paragraph-properties ${pp.join(' ')}${extra}/><style:text-properties ${tp.join(' ')}/></style:style>`
}

function hfXml(text: string, align: string): string {
  const parts = text.split(/(\{page\}|\{pages\}|\{date\})/).map((p) => {
    if (p === '{page}') return '<text:page-number text:select-page="current">1</text:page-number>'
    if (p === '{pages}') return '<text:page-count>1</text:page-count>'
    if (p === '{date}') return escapeXml(fmtDate())
    return textXml(p)
  }).join('')
  const al = align === 'left' ? 'HFLeft' : align === 'right' ? 'HFRight' : 'HFCenter'
  return `<text:p text:style-name="${al}">${parts}</text:p>`
}

export async function exportOdt(doc: JSONContent, settings: DocSettings, headingPages: Map<number, number>): Promise<Uint8Array> {
  const ctx: Ctx = {
    auto: new AutoStyles(), pics: new Map(), headingPages, headings: collectHeadingsJson(doc),
    captions: captionNumbers(doc), numbered: settings.headingNumbers,
    pendingBreak: false, listStyles: new Map(), tableN: 0,
    textWidthMm: settings.width - settings.margins.left - settings.margins.right,
  }
  ctx.auto.raw('<style:style style:name="fr1" style:family="graphic" style:parent-style-name="Graphics"><style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" fo:border="none"/></style:style>')

  let i = 0
  for (const [key, p] of await preparePictures(doc, (ctx.textWidthMm * 96) / 25.4)) {
    ctx.pics.set(key, { path: `Pictures/image${++i}.${p.type}`, bytes: p.bytes, mime: p.mime, w: p.w, h: p.h })
  }

  let body = (doc.content || []).map((b) => blockXml(b, ctx)).join('')
  // A trailing page break needs a paragraph to carry it.
  if (ctx.pendingBreak || !body) body += `<text:p text:style-name="${paraStyle({ type: 'paragraph' }, ctx, 'Standard')}"/>`
  const fonts = [...ctx.auto.fonts].map((f) => `<style:font-face style:name="${escapeXml(f)}" svg:font-family="'${escapeXml(f)}'"/>`).join('')

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3"><office:font-face-decls>${fonts}</office:font-face-decls><office:automatic-styles>${ctx.auto.entries.join('')}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`

  const m = settings.margins
  const hf = settings.hf
  const headerH = Math.max(0, m.top - hf.headerDistance)
  const footerH = Math.max(0, m.bottom - hf.footerDistance)
  const tocTab = `<style:tab-stops><style:tab-stop style:position="${ctx.textWidthMm.toFixed(1)}mm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops>`
  const ps = (id: string) => PARA_STYLES.find((s) => s.id === id)!
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.3"><office:font-face-decls>${fonts}</office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties style:tab-stop-distance="12.7mm"/><style:text-properties style:font-name="${DEFAULT_FONT}" fo:font-size="11pt" fo:language="el" fo:country="GR" style:letter-kerning="true"/></style:default-style>
<style:default-style style:family="table"><style:table-properties table:border-model="collapsing"/></style:default-style>
${styleXml(ps('Normal'), 'Standard', 'Standard')}
${PARA_STYLES.filter((s) => s.id !== 'Normal').map((s) => styleXml(s, odfName(s.id), displayName(odfName(s.id)))).join('\n')}
<style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt"/></style:style>
<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt"/></style:style>
<style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Heading_20_1"/>
${[1, 2, 3, 4, 5, 6].map((l) => `<style:style style:name="Contents_20_${l}" style:display-name="Contents ${l}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="${(l - 1) * 11}pt" fo:margin-bottom="5pt">${tocTab}</style:paragraph-properties></style:style>`).join('')}
<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-bottom="0pt"/><style:text-properties fo:font-size="10pt" fo:color="#555555"/></style:style>
<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-bottom="0pt"/><style:text-properties fo:font-size="10pt" fo:color="#555555"/></style:style>
<style:style style:name="Graphics" style:family="graphic"/>
<text:outline-style style:name="Outline">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => `<text:outline-level-style text:level="${l}" style:num-format="${settings.headingNumbers && l <= 6 ? '1' : ''}"${settings.headingNumbers && l <= 6 ? ` text:display-levels="${l}" style:num-suffix=" "` : ''}><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="space"/></style:list-level-properties></text:outline-level-style>`).join('')}</text:outline-style>
</office:styles>
<office:automatic-styles>
<style:style style:name="HFLeft" style:family="paragraph" style:parent-style-name="Header"><style:paragraph-properties fo:text-align="start"/></style:style>
<style:style style:name="HFCenter" style:family="paragraph" style:parent-style-name="Header"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="HFRight" style:family="paragraph" style:parent-style-name="Header"><style:paragraph-properties fo:text-align="end"/></style:style>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${settings.width}mm" fo:page-height="${settings.height}mm" style:print-orientation="${settings.orientation}" fo:margin-top="${hf.headerText ? hf.headerDistance : m.top}mm" fo:margin-bottom="${hf.footerText ? hf.footerDistance : m.bottom}mm" fo:margin-left="${m.left}mm" fo:margin-right="${m.right}mm" style:writing-mode="lr-tb"/>
<style:header-style>${hf.headerText ? `<style:header-footer-properties fo:min-height="${headerH}mm" fo:margin-bottom="0mm" style:dynamic-spacing="false"/>` : ''}</style:header-style>
<style:footer-style>${hf.footerText ? `<style:header-footer-properties fo:min-height="${footerH}mm" fo:margin-top="0mm" style:dynamic-spacing="false"/>` : ''}</style:footer-style>
</style:page-layout>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${hf.headerText ? `<style:header>${hfXml(hf.headerText, hf.headerAlign)}</style:header>${hf.differentFirstPage ? '<style:header-first/>' : ''}` : ''}${hf.footerText ? `<style:footer>${hfXml(hf.footerText, hf.footerAlign)}</style:footer>${hf.differentFirstPage ? '<style:footer-first/>' : ''}` : ''}</style:master-page></office:master-styles>
</office:document-styles>`

  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.3"><office:meta><meta:generator>Graphi</meta:generator>${settings.title ? `<dc:title>${escapeXml(settings.title)}</dc:title>` : ''}${settings.author ? `<meta:initial-creator>${escapeXml(settings.author)}</meta:initial-creator><dc:creator>${escapeXml(settings.author)}</dc:creator>` : ''}<meta:creation-date>${new Date().toISOString().slice(0, 19)}</meta:creation-date><dc:date>${new Date().toISOString().slice(0, 19)}</dc:date></office:meta></office:document-meta>`

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
${[...ctx.pics.values()].map((p) => `<manifest:file-entry manifest:full-path="${p.path}" manifest:media-type="${p.mime}"/>`).join('\n')}
</manifest:manifest>`

  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file('content.xml', content)
  zip.file('styles.xml', styles)
  zip.file('meta.xml', meta)
  zip.file('META-INF/manifest.xml', manifest)
  for (const p of ctx.pics.values()) zip.file(p.path, p.bytes)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.oasis.opendocument.text' })
}

// ───────────────────────── import ─────────────────────────
interface OStyle { name: string; family: string; parent: string | null; display: string; p: Record<string, string>; t: Record<string, string>; cell: Record<string, string>; table: Record<string, string> }

function readStyles(root: Element | null, into: Map<string, OStyle>) {
  if (!root) return
  for (const s of Array.from(root.getElementsByTagName('style:style'))) {
    const props = (tag: string) => {
      const el = s.getElementsByTagName(tag)[0]
      const o: Record<string, string> = {}
      if (el) for (const a of Array.from(el.attributes)) o[a.name] = a.value
      return o
    }
    const name = s.getAttribute('style:name') || ''
    into.set(name, {
      name, family: s.getAttribute('style:family') || '', parent: s.getAttribute('style:parent-style-name'),
      display: (s.getAttribute('style:display-name') || name).toLowerCase(),
      p: props('style:paragraph-properties'), t: props('style:text-properties'), cell: props('style:table-cell-properties'), table: props('style:table-properties'),
    })
  }
}

function textCss(t: Record<string, string>, fonts: Map<string, string>): string {
  const c: string[] = []
  if (t['fo:font-weight'] === 'bold' || /^[6-9]00$/.test(t['fo:font-weight'] || '')) c.push('font-weight:bold')
  if (t['fo:font-style'] === 'italic') c.push('font-style:italic')
  const deco = [t['style:text-underline-style'] && t['style:text-underline-style'] !== 'none' ? 'underline' : '', t['style:text-line-through-style'] && t['style:text-line-through-style'] !== 'none' ? 'line-through' : ''].filter(Boolean)
  if (deco.length) c.push(`text-decoration:${deco.join(' ')}`)
  if (t['fo:font-size'] && !t['fo:font-size'].endsWith('%')) c.push(`font-size:${t['fo:font-size']}`)
  if (t['fo:color']) c.push(`color:${t['fo:color']}`)
  if (t['fo:background-color'] && t['fo:background-color'] !== 'transparent') c.push(`background-color:${t['fo:background-color']}`)
  const fn = t['style:font-name'] ? fonts.get(t['style:font-name']) || t['style:font-name'] : t['fo:font-family']
  if (fn) c.push(`font-family:${fn.replace(/'/g, '')}`)
  return c.join(';')
}

function paraCss(p: Record<string, string>): string {
  const c: string[] = []
  const al = p['fo:text-align']
  if (al) c.push(`text-align:${al === 'start' ? 'left' : al === 'end' ? 'right' : al}`)
  for (const [k, css] of [['fo:margin-top', 'margin-top'], ['fo:margin-bottom', 'margin-bottom'], ['fo:margin-left', 'margin-left'], ['fo:margin-right', 'margin-right'], ['fo:text-indent', 'text-indent']]) {
    if (p[k]) c.push(`${css}:${p[k]}`)
  }
  if (p['fo:line-height'] && p['fo:line-height'] !== 'normal') c.push(`line-height:${p['fo:line-height']}`)
  if (p['fo:break-before'] === 'page') c.push('break-before:page')
  if (p['fo:background-color'] && p['fo:background-color'] !== 'transparent') c.push(`background-color:${p['fo:background-color']}`)
  return c.join(';')
}

export async function importOdt(data: Uint8Array): Promise<{ html: string; settings: DocSettings; warnings: string[] }> {
  const zip = await JSZip.loadAsync(data)
  const contentXml = await zip.file('content.xml')?.async('string')
  if (!contentXml) throw new Error(t('io.badOdt'))
  const stylesXml = await zip.file('styles.xml')?.async('string')
  const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
  const content = parse(contentXml)
  const stylesDoc = stylesXml ? parse(stylesXml) : null
  const warnings = new Set<string>()

  const fonts = new Map<string, string>()
  for (const d of [stylesDoc, content]) {
    for (const f of Array.from(d?.getElementsByTagName('style:font-face') || [])) fonts.set(f.getAttribute('style:name') || '', (f.getAttribute('svg:font-family') || '').replace(/'/g, ''))
  }
  const styles = new Map<string, OStyle>()
  readStyles(stylesDoc?.getElementsByTagName('office:styles')[0] || null, styles)
  readStyles(content.getElementsByTagName('office:automatic-styles')[0] || null, styles)

  // Graphic (frame) styles → their graphic-properties element (wrap / position).
  const graphicProps = new Map<string, Element>()
  for (const d of [stylesDoc, content]) {
    for (const st of Array.from(d?.getElementsByTagName('style:style') || [])) {
      const gp = st.getElementsByTagName('style:graphic-properties')[0]
      if (gp) graphicProps.set(st.getAttribute('style:name') || '', gp)
    }
  }

  const images = new Map<string, string>()
  for (const name of Object.keys(zip.files)) {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' } as Record<string, string>)[ext]
    if (mime && !name.startsWith('Thumbnails/')) images.set(name, bytesToDataUrl(await zip.file(name)!.async('uint8array'), mime))
  }

  // Resolve the named (non-automatic) ancestor for semantic mapping; automatic styles give direct CSS.
  const semantic = (name: string | null): string | null => {
    for (let i = 0; name && i < 20; i++) {
      const s = styles.get(name)
      const d = s?.display || name.toLowerCase().replace(/_20_/g, ' ')
      if (/^heading \d$/.test(d)) return `h${d.slice(-1)}`
      if (d === 'title') return 'Title'
      if (d === 'subtitle') return 'Subtitle'
      if (d === 'quotations') return 'Quote'
      if (d === 'caption' || d === 'illustration' || d === 'figure' || d === 'table') return 'Caption'
      name = s?.parent || null
    }
    return null
  }
  const directCss = (name: string | null, kind: 'p' | 't') => {
    const s = name ? styles.get(name) : null
    if (!s) return ''
    // Only automatic styles (content.xml) carry direct formatting.
    const auto = content.getElementsByTagName('office:automatic-styles')[0]
    const isAuto = !!auto && Array.from(auto.getElementsByTagName('style:style')).some((x) => x.getAttribute('style:name') === name)
    if (!isAuto) return ''
    return kind === 'p' ? [paraCss(s.p), textCss(s.t, fonts)].filter(Boolean).join(';') : textCss(s.t, fonts)
  }

  // `hoisted` collects paragraph-anchored frames: their offset is from the paragraph's top, which is
  // what our line-relative `y` means only at the paragraph's start (see pictures.ts → anchoredAtStart).
  const inline = (el: Element, hoisted: string[]): string => {
    let out = ''
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { out += escapeHtml(n.textContent || ''); continue }
      if (n.nodeType !== 1) continue
      const e = n as Element
      switch (e.tagName) {
        case 'text:span': {
          const css = directCss(e.getAttribute('text:style-name'), 't')
          const s = styles.get(e.getAttribute('text:style-name') || '')
          const pos = s?.t['style:text-position'] || ''
          let inner = inline(e, hoisted)
          if (pos.startsWith('super')) inner = `<sup>${inner}</sup>`
          else if (pos.startsWith('sub')) inner = `<sub>${inner}</sub>`
          out += css ? `<span style="${escapeHtml(css)}">${inner}</span>` : inner
          break
        }
        case 'text:a': out += `<a href="${escapeHtml(e.getAttribute('xlink:href') || '')}">${inline(e, hoisted)}</a>`; break
        case 'text:s': out += ' '.repeat(Number(e.getAttribute('text:c') || 1)); break
        case 'text:tab': out += '\t'; break
        case 'text:line-break': out += '<br>'; break
        case 'text:soft-page-break': break
        case 'text:page-number': case 'text:page-count': out += escapeHtml(e.textContent || ''); break
        case 'draw:frame': {
          const img = e.getElementsByTagName('draw:image')[0]
          const src = img ? images.get(img.getAttribute('xlink:href') || '') : null
          const cm = (v: string | null) => {
            if (!v) return null
            const m = /^([\d.]+)(mm|cm|in|pt)$/.exec(v)
            if (!m) return null
            const f = { mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72 }[m[2] as 'mm']
            return Math.round(parseFloat(m[1]) * f)
          }
          const sn = e.getAttribute('draw:style-name')
          const gp = sn ? graphicProps.get(sn) || null : null
          const wrapAttr = gp?.getAttribute('style:wrap')
          const anchorType = e.getAttribute('text:anchor-type')
          const wrap = anchorType === 'as-char' || (anchorType === 'char' && !wrapAttr) ? '' : wrapAttr === 'none' ? 'topBottom' : wrapAttr ? 'square' : ''
          const hpos = gp?.getAttribute('style:horizontal-pos')
          // A one-sided wrap names the side the text is on; the picture is on the other.
          const align = wrap === 'square' && wrapAttr === 'left' ? 'right' : wrap === 'square' && wrapAttr === 'right' ? 'left'
            : hpos === 'left' || hpos === 'from-left' ? 'left' : hpos === 'right' ? 'right' : wrap === 'square' ? 'left' : 'center'
          const html = src && `<img src="${src}"${cm(e.getAttribute('svg:width')) ? ` width="${cm(e.getAttribute('svg:width'))}"` : ''}${cm(e.getAttribute('svg:height')) ? ` height="${cm(e.getAttribute('svg:height'))}"` : ''}${wrap ? ` data-wrap="${wrap}" data-align="${align}"` : ''}${wrap && hpos === 'from-left' && cm(e.getAttribute('svg:x')) != null ? ` data-x="${cm(e.getAttribute('svg:x'))}"` : ''}${wrap && gp?.getAttribute('style:vertical-pos') === 'from-top' && (cm(e.getAttribute('svg:y')) ?? 0) >= MIN_Y ? ` data-y="${cm(e.getAttribute('svg:y'))}"` : ''}>`
          if (html && wrap && anchorType === 'paragraph') hoisted.push(html)
          else if (html) out += html
          else if (img) warnings.add(t('io.odtImages'))
          break
        }
        case 'text:note': break
        case 'text:number': break // cached outline number; we regenerate numbering
        case 'text:bookmark': case 'text:bookmark-start': case 'text:bookmark-end': break
        default: out += inline(e, hoisted)
      }
    }
    return out
  }

  const isContents = (name: string | null) => {
    for (let i = 0; name && i < 20; i++) {
      const st = styles.get(name)
      const d = st?.display || name.toLowerCase().replace(/_20_/g, ' ')
      if (/^contents( heading| \d+)$/.test(d)) return true
      name = st?.parent || null
    }
    return false
  }
  const CAP_RE = /^(Εικόνα|Σχήμα|Figure|Illustration)\s*\d+\s*[:.–-]\s*|^(Πίνακας|Table)\s*\d+\s*[:.–-]\s*/
  const block = (el: Element): string => {
    let out = ''
    let inToc = false
    for (const n of Array.from(el.children)) {
      if ((n.tagName === 'text:p' || n.tagName === 'text:h') && isContents(n.getAttribute('text:style-name'))) {
        if (!inToc) { out += '<div data-toc="" data-max-level="3"></div>'; inToc = true }
        continue
      }
      inToc = false
      switch (n.tagName) {
        case 'text:p': case 'text:h': {
          const sn = n.getAttribute('text:style-name')
          const sem = n.tagName === 'text:h' ? `h${Math.min(6, Number(n.getAttribute('text:outline-level') || 1))}` : semantic(sn)
          const css = directCss(sn, 'p')
          const style = css ? ` style="${escapeHtml(css)}"` : ''
          const hoisted: string[] = []
          let body = inline(n, hoisted)
          let capAttr = ''
          if (sem === 'Caption') {
            const m = CAP_RE.exec(body)
            if (m) { body = body.slice(m[0].length); capAttr = ` data-caption="${m[2] ? 'table' : 'figure'}"` }
          }
          body = hoisted.join('') + body
          if (sem && sem.startsWith('h')) out += `<${sem}${style}>${body}</${sem}>`
          else if (capAttr) out += `<p${style} data-style="Caption"${capAttr}>${body}</p>`
          else out += `<p${style}${sem ? ` data-style="${sem}"` : ''}>${body}</p>`
          break
        }
        case 'text:list': {
          // Decide ordered vs bullet from the list style.
          const ls = n.getAttribute('text:style-name')
          const lsEl = ls ? Array.from((content.getElementsByTagName('text:list-style') as any as Element[])).concat(Array.from(stylesDoc?.getElementsByTagName('text:list-style') || [])).find((x) => x.getAttribute('style:name') === ls) : null
          const ordered = !!lsEl && Array.from(lsEl.getElementsByTagName('text:list-level-style-number')).some((x) => x.getAttribute('text:level') === '1')
          const tag = ordered ? 'ol' : 'ul'
          const firstItem = Array.from(n.children).find((c) => c.tagName === 'text:list-item')
          const sv = firstItem?.getAttribute('text:start-value')
          out += `<${tag}${ordered && sv ? ` start="${Number(sv)}"` : ''}>${Array.from(n.children).filter((c) => c.tagName === 'text:list-item' || c.tagName === 'text:list-header').map((li) => `<li>${block(li)}</li>`).join('')}</${tag}>`
          break
        }
        case 'table:table': {
          if (styles.get(n.getAttribute('table:style-name') || '')?.table['fo:break-before'] === 'page') out += '<div data-page-break=""></div>'
          let rows = ''
          const rowEls = Array.from(n.getElementsByTagName('table:table-row'))
          for (const r of rowEls) {
            if (r.parentElement !== n && r.parentElement?.parentElement !== n) continue
            const header = r.parentElement?.tagName === 'table:table-header-rows'
            let cells = ''
            for (const c of Array.from(r.children)) {
              if (c.tagName !== 'table:table-cell') continue
              const cs = c.getAttribute('table:number-columns-spanned')
              const rs = c.getAttribute('table:number-rows-spanned')
              const st = styles.get(c.getAttribute('table:style-name') || '')
              const bg = st?.cell['fo:background-color']
              const tag = header ? 'th' : 'td'
              cells += `<${tag}${cs ? ` colspan="${cs}"` : ''}${rs ? ` rowspan="${rs}"` : ''}${bg && bg !== 'transparent' ? ` style="background-color:${bg}"` : ''}>${block(c) || '<p></p>'}</${tag}>`
            }
            rows += `<tr>${cells}</tr>`
          }
          out += `<table><tbody>${rows}</tbody></table>`
          break
        }
        case 'text:table-of-content':
          out += '<div data-toc="" data-max-level="3"></div>'; break
        case 'text:section': case 'text:index-body': case 'text:list-item':
          out += block(n); break
        case 'text:index-title': out += block(n); break
      }
    }
    return out
  }

  const bodyText = content.getElementsByTagName('office:text')[0]
  const html = bodyText ? block(bodyText) : ''

  // Page layout.
  const s = normalizeSettings(undefined)
  const pl = stylesDoc?.getElementsByTagName('style:page-layout-properties')[0]
  const mm = (v: string | null | undefined) => {
    if (!v) return null
    const m = /^([\d.]+)(mm|cm|in|pt)$/.exec(v)
    if (!m) return null
    return parseFloat(m[1]) * { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 }[m[2] as 'mm']
  }
  if (pl) {
    const w = mm(pl.getAttribute('fo:page-width'))
    const h = mm(pl.getAttribute('fo:page-height'))
    if (w && h) {
      s.width = w; s.height = h
      s.orientation = pl.getAttribute('style:print-orientation') === 'landscape' || w > h ? 'landscape' : 'portrait'
      s.paper = detectPaper(w, h)
    }
    s.margins = {
      top: mm(pl.getAttribute('fo:margin-top')) ?? 20, right: mm(pl.getAttribute('fo:margin-right')) ?? 20,
      bottom: mm(pl.getAttribute('fo:margin-bottom')) ?? 20, left: mm(pl.getAttribute('fo:margin-left')) ?? 20,
    }
  }
  const hfText = (tag: string) => {
    const el = stylesDoc?.getElementsByTagName(tag)[0]
    if (!el) return ''
    let t = ''
    const walk = (e: Element) => {
      for (const n of Array.from(e.childNodes)) {
        if (n.nodeType === 3) t += n.textContent
        else if (n.nodeType === 1) {
          const x = n as Element
          if (x.tagName === 'text:page-number') t += '{page}'
          else if (x.tagName === 'text:page-count') t += '{pages}'
          else if (x.tagName === 'text:tab') t += '   '
          else walk(x)
        }
      }
    }
    walk(el)
    return t.trim()
  }
  const outline1 = stylesDoc?.getElementsByTagName('text:outline-level-style')[0]
  s.headingNumbers = !!outline1?.getAttribute('style:num-format')
  s.hf.headerText = hfText('style:header')
  s.hf.footerText = hfText('style:footer')
  // In ODF the page margin is measured to the header; restore Word-style body margins.
  if (s.hf.headerText) { s.hf.headerDistance = s.margins.top; s.margins.top += 10 }
  if (s.hf.footerText) { s.hf.footerDistance = s.margins.bottom; s.margins.bottom += 10 }

  const metaXml = await zip.file('meta.xml')?.async('string')
  if (metaXml) {
    const md = parse(metaXml)
    s.title = md.getElementsByTagName('dc:title')[0]?.textContent || ''
    s.author = md.getElementsByTagName('dc:creator')[0]?.textContent || md.getElementsByTagName('meta:initial-creator')[0]?.textContent || ''
  }
  return { html, settings: s, warnings: [...warnings] }
}
