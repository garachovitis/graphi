// Office Open XML (.docx) → ProseMirror JSON.
//
// A direct WordprocessingML reader (not HTML conversion) so that formatting survives:
// the full style cascade is resolved (docDefaults → paragraph style chain → character
// style → direct formatting, incl. theme fonts) and only the *differences* from our own
// named styles are emitted as attributes/marks. Handles numbering (nested, restarts,
// continuation), tables (gridSpan / vMerge / shading / widths), images (DrawingML and
// VML), hyperlinks, fields (PAGE/NUMPAGES in headers, cached results elsewhere),
// tracked changes (shown as accepted), page/section breaks, headers/footers and
// page geometry.
import JSZip from 'jszip'
import type { JSONContent } from '@tiptap/core'
import { DEFAULT_SETTINGS, detectPaper, mmToPx, normalizeSettings, twipToMm, type DocSettings, type HFAlign } from '../model/settings'
import { DEFAULT_FONT, PARA_STYLES, fontStack, type ParaStyle } from '../model/styles'
import { bytesToDataUrl } from './images'
import { hoistToStart } from './pictures'
import { MIN_Y, normRotate, squareSide } from '../editor/image'
import { colorDistance, isHex, parseThemeRef, parseThemeXml, resolveColor, snapPct, themeVar, type DocTheme, type Slot } from '../model/themes'
import { tableStyle, unbakeTableStyle } from '../model/tableStyles'
import { t } from '../i18n'

type El = Element

// ───────────── XML helpers ─────────────
const kids = (el: El | null | undefined, name?: string): El[] =>
  el ? (Array.from(el.children) as El[]).filter((c) => !name || c.tagName === name) : []
const child = (el: El | null | undefined, name: string): El | null => (el ? kids(el, name)[0] || null : null)
const attr = (el: El | null | undefined, name: string) => (el ? el.getAttribute(name) : null)
const val = (el: El | null | undefined) => attr(el, 'w:val')
const num = (s: string | null | undefined) => (s == null || s === '' ? null : Number(s))
/** OOXML on/off properties: <w:b/>, <w:b w:val="0"/>, <w:b w:val="false"/> */
const onOff = (el: El | null) => (el ? !['0', 'false', 'off', 'none'].includes((val(el) || 'true').toLowerCase()) : undefined)
const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')

// ───────────── property models ─────────────
interface RunProps {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean
  vert?: 'sub' | 'sup' | null; sizePt?: number; font?: string; color?: string | null
  highlight?: string | null; shading?: string | null; hidden?: boolean; caps?: boolean
}
interface ParaProps {
  align?: string; before?: number; after?: number; line?: string; indL?: number; indR?: number; first?: number
  keepNext?: boolean; pageBreakBefore?: boolean; numId?: string; ilvl?: number; shading?: string | null
}

const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
}

interface Theme { minor: string; major: string; doc?: DocTheme | null }

const THEME_SLOT: Record<string, Slot> = {
  text1: 'dk1', dark1: 'dk1', background1: 'lt1', light1: 'lt1', text2: 'dk2', dark2: 'dk2', background2: 'lt2', light2: 'lt2',
  accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6',
  hyperlink: 'hlink', followedHyperlink: 'folHlink',
}
/** w:themeColor (+ w:themeTint / w:themeShade) → a theme-linked colour, when it is one Graphi can express. */
function themeLinked(el: El, prefix: 'Color' | 'Fill', theme: Theme): string | null {
  const slot = THEME_SLOT[attr(el, `w:theme${prefix}`) || '']
  if (!slot || !theme.doc) return null
  const tint = attr(el, prefix === 'Color' ? 'w:themeTint' : 'w:themeFillTint')
  const shade = attr(el, prefix === 'Color' ? 'w:themeShade' : 'w:themeFillShade')
  const raw = tint ? (1 - parseInt(tint, 16) / 255) * 100 : shade ? -(1 - parseInt(shade, 16) / 255) * 100 : 0
  const pct = Number.isFinite(raw) ? snapPct(Math.round(raw)) : null
  return pct == null ? null : themeVar(slot, pct, theme.doc)
}

function parseRPr(rPr: El | null, theme: Theme): RunProps {
  const r: RunProps = {}
  if (!rPr) return r
  const b = onOff(child(rPr, 'w:b')); if (b !== undefined) r.bold = b
  const i = onOff(child(rPr, 'w:i')); if (i !== undefined) r.italic = i
  const u = child(rPr, 'w:u'); if (u) r.underline = (val(u) || 'single') !== 'none'
  const s = onOff(child(rPr, 'w:strike')); const ds = onOff(child(rPr, 'w:dstrike'))
  if (s !== undefined || ds !== undefined) r.strike = !!(s || ds)
  const va = val(child(rPr, 'w:vertAlign'))
  if (va) r.vert = va === 'subscript' ? 'sub' : va === 'superscript' ? 'sup' : null
  const sz = num(val(child(rPr, 'w:sz'))); if (sz) r.sizePt = sz / 2
  const f = child(rPr, 'w:rFonts')
  if (f) {
    const at = attr(f, 'w:asciiTheme') || attr(f, 'w:hAnsiTheme')
    const name = attr(f, 'w:ascii') || attr(f, 'w:hAnsi') || (at ? (at.startsWith('major') ? theme.major : theme.minor) : null)
    if (name) r.font = name
  }
  const c = child(rPr, 'w:color')
  if (c) {
    const v = val(c)
    r.color = themeLinked(c, 'Color', theme) ?? (v && v !== 'auto' ? `#${v.toLowerCase()}` : null)
  }
  const h = val(child(rPr, 'w:highlight')); if (h) r.highlight = h === 'none' ? null : HIGHLIGHT[h] || null
  const shd = child(rPr, 'w:shd')
  if (shd) { const fill = attr(shd, 'w:fill'); r.shading = themeLinked(shd, 'Fill', theme) ?? (fill && fill !== 'auto' ? `#${fill.toLowerCase()}` : null) }
  const v = onOff(child(rPr, 'w:vanish')); if (v !== undefined) r.hidden = v
  const caps = onOff(child(rPr, 'w:caps')); if (caps !== undefined) r.caps = caps
  return r
}

function parsePPr(pPr: El | null): ParaProps {
  const p: ParaProps = {}
  if (!pPr) return p
  const jc = val(child(pPr, 'w:jc'))
  if (jc) p.align = ({ start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', both: 'justify', distribute: 'justify' } as Record<string, string>)[jc] || 'left'
  const sp = child(pPr, 'w:spacing')
  if (sp) {
    const b = num(attr(sp, 'w:before')); if (b != null && attr(sp, 'w:beforeAutospacing') !== '1') p.before = b / 20
    const a = num(attr(sp, 'w:after')); if (a != null && attr(sp, 'w:afterAutospacing') !== '1') p.after = a / 20
    const line = num(attr(sp, 'w:line'))
    if (line != null) {
      const rule = attr(sp, 'w:lineRule') || 'auto'
      p.line = rule === 'auto' ? String(Math.round((line / 240) * 100) / 100) : `${line / 20}pt`
    }
  }
  const ind = child(pPr, 'w:ind')
  if (ind) {
    const l = num(attr(ind, 'w:left') ?? attr(ind, 'w:start')); if (l != null) p.indL = l / 20
    const r = num(attr(ind, 'w:right') ?? attr(ind, 'w:end')); if (r != null) p.indR = r / 20
    const fl = num(attr(ind, 'w:firstLine')); const hg = num(attr(ind, 'w:hanging'))
    if (hg != null) p.first = -hg / 20
    else if (fl != null) p.first = fl / 20
  }
  const kn = onOff(child(pPr, 'w:keepNext')); if (kn !== undefined) p.keepNext = kn
  const pb = onOff(child(pPr, 'w:pageBreakBefore')); if (pb !== undefined) p.pageBreakBefore = pb
  const np = child(pPr, 'w:numPr')
  if (np) {
    const id = val(child(np, 'w:numId')); if (id != null) p.numId = id
    const lv = num(val(child(np, 'w:ilvl'))); if (lv != null) p.ilvl = lv
  }
  const shd = child(pPr, 'w:shd')
  if (shd) { const fill = attr(shd, 'w:fill'); p.shading = fill && fill !== 'auto' ? `#${fill.toLowerCase()}` : null }
  return p
}

// ───────────── styles ─────────────
interface StyleDef { id: string; name: string; type: string; basedOn: string | null; pPr: ParaProps; rPr: RunProps }

class Styles {
  defs = new Map<string, StyleDef>()
  defaultPara = 'Normal'
  docP: ParaProps = {}
  docR: RunProps = {}
  private memoP = new Map<string, ParaProps>()
  private memoR = new Map<string, RunProps>()

  constructor(xml: Document | null, theme: Theme) {
    if (!xml) return
    const root = xml.documentElement
    const dd = child(root, 'w:docDefaults')
    this.docR = parseRPr(child(child(dd, 'w:rPrDefault'), 'w:rPr'), theme)
    this.docP = parsePPr(child(child(dd, 'w:pPrDefault'), 'w:pPr'))
    for (const s of kids(root, 'w:style')) {
      const id = attr(s, 'w:styleId') || ''
      const def: StyleDef = {
        id,
        name: (val(child(s, 'w:name')) || id).toLowerCase(),
        type: attr(s, 'w:type') || 'paragraph',
        basedOn: val(child(s, 'w:basedOn')),
        pPr: parsePPr(child(s, 'w:pPr')),
        rPr: parseRPr(child(s, 'w:rPr'), theme),
      }
      this.defs.set(id, def)
      if (def.type === 'paragraph' && attr(s, 'w:default') === '1') this.defaultPara = id
    }
  }

  paraProps(id: string | null, depth = 0): ParaProps {
    if (!id || depth > 20) return {}
    const hit = this.memoP.get(id); if (hit) return hit
    const d = this.defs.get(id); if (!d) return {}
    const r = { ...this.paraProps(d.basedOn, depth + 1), ...d.pPr }
    this.memoP.set(id, r)
    return r
  }

  runProps(id: string | null, depth = 0): RunProps {
    if (!id || depth > 20) return {}
    const hit = this.memoR.get(id); if (hit) return hit
    const d = this.defs.get(id); if (!d) return {}
    const r = { ...this.runProps(d.basedOn, depth + 1), ...d.rPr }
    this.memoR.set(id, r)
    return r
  }

  /** Map a Word paragraph style to one of ours (following basedOn for custom styles). */
  target(id: string | null): ParaStyle {
    let cur = id || this.defaultPara
    for (let i = 0; i < 20 && cur; i++) {
      const d = this.defs.get(cur)
      const name = d?.name || cur.toLowerCase()
      const h = /^heading\s*(\d)$/.exec(name) || /^heading(\d)$/i.exec(cur)
      if (h) return PARA_STYLES.find((s) => s.node === 'heading' && s.level === Math.min(6, Number(h[1])))!
      if (name === 'title') return PARA_STYLES.find((s) => s.id === 'Title')!
      if (name === 'subtitle') return PARA_STYLES.find((s) => s.id === 'Subtitle')!
      if (name === 'quote' || name === 'intense quote') return PARA_STYLES.find((s) => s.id === 'Quote')!
      if (name === 'no spacing') return PARA_STYLES.find((s) => s.id === 'NoSpacing')!
      if (name === 'caption') return PARA_STYLES.find((s) => s.id === 'Caption')!
      if (!d) break
      cur = d.basedOn || ''
    }
    return PARA_STYLES[0]
  }
}

// ───────────── numbering ─────────────
interface Lvl { fmt: string; text: string; start: number; font?: string }
class Numbering {
  abstract = new Map<string, Map<number, Lvl>>()
  nums = new Map<string, { abs: string; overrides: Map<number, number> }>()
  counters = new Map<string, number>()

  constructor(xml: Document | null) {
    if (!xml) return
    const root = xml.documentElement
    for (const a of kids(root, 'w:abstractNum')) {
      const lv = new Map<number, Lvl>()
      for (const l of kids(a, 'w:lvl')) {
        lv.set(Number(attr(l, 'w:ilvl')), {
          fmt: val(child(l, 'w:numFmt')) || 'decimal',
          text: val(child(l, 'w:lvlText')) || '',
          start: num(val(child(l, 'w:start'))) ?? 1,
          font: attr(child(child(l, 'w:rPr'), 'w:rFonts'), 'w:ascii') || undefined,
        })
      }
      this.abstract.set(attr(a, 'w:abstractNumId') || '', lv)
    }
    for (const n of kids(root, 'w:num')) {
      const overrides = new Map<number, number>()
      for (const o of kids(n, 'w:lvlOverride')) {
        const s = num(val(child(o, 'w:startOverride')))
        if (s != null) overrides.set(Number(attr(o, 'w:ilvl')), s)
      }
      this.nums.set(attr(n, 'w:numId') || '', { abs: val(child(n, 'w:abstractNumId')) || '', overrides })
    }
  }

  level(numId: string, ilvl: number): Lvl | null {
    const n = this.nums.get(numId)
    if (!n) return null
    const l = this.abstract.get(n.abs)?.get(ilvl)
    if (!l) return null
    const o = n.overrides.get(ilvl)
    return o != null ? { ...l, start: o } : l
  }
}

function listStyleOf(l: Lvl): { ordered: boolean; style: string | null } {
  if (l.fmt === 'bullet') {
    const ch = l.text
    const code = ch.charCodeAt(0)
    if (ch === 'o' || ch === '○' || ch === '◦') return { ordered: false, style: 'circle' }
    if (ch === '§' || ch === '■' || ch === '▪' || code === 0xf0a7) return { ordered: false, style: 'square' }
    if (ch === '–' || ch === '-' || ch === '—') return { ordered: false, style: 'dash' }
    if (ch === 'Ø' || ch === '➢' || ch === '>' || code === 0xf0d8) return { ordered: false, style: 'arrow' }
    if (ch === 'ü' || ch === '✓' || ch === '✔' || code === 0xf0fc) return { ordered: false, style: 'check' }
    return { ordered: false, style: null }
  }
  const map: Record<string, string> = {
    decimal: 'decimal', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman',
  }
  let style = map[l.fmt] || 'decimal'
  if (style === 'decimal' && /\)$/.test(l.text)) style = 'decimal-paren'
  return { ordered: true, style: style === 'decimal' ? null : style }
}

// ───────────── reader ─────────────
export interface ImportResult { doc: JSONContent; settings: DocSettings; warnings: string[] }

interface Ctx {
  zip: JSZip
  styles: Styles
  numbering: Numbering
  theme: Theme
  rels: Map<string, { target: string; external: boolean }>
  media: Map<string, string>
  warnings: Set<string>
  headingNumbers?: boolean
  /** Floating pictures positioned from their paragraph's top (moved to its start, see pictures.ts). */
  paragraphAnchored: WeakSet<JSONContent>
  /** Square pictures Word wraps on both sides: the side is picked from the position once the column width is known. */
  sideByPosition: Set<JSONContent>
  /** Pictures positioned from the page's edge: made relative to its margins once they are known. */
  fromPageEdge: { node: JSONContent; h: boolean; v: boolean }[]
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp',
}

async function readRels(zip: JSZip, path: string) {
  const map = new Map<string, { target: string; external: boolean }>()
  const f = zip.file(path)
  if (!f) return map
  const x = parseXml(await f.async('string'))
  for (const r of Array.from(x.getElementsByTagName('Relationship'))) {
    map.set(r.getAttribute('Id') || '', { target: r.getAttribute('Target') || '', external: r.getAttribute('TargetMode') === 'External' })
  }
  return map
}

function resolvePath(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/** Pre-load every image referenced from a part into data URLs. */
async function loadMedia(ctx: Ctx, basePath: string, rels: Map<string, { target: string; external: boolean }>) {
  for (const [id, r] of rels) {
    if (r.external) continue
    const ext = r.target.split('.').pop()?.toLowerCase() || ''
    if (!MIME[ext]) {
      if (['emf', 'wmf', 'tif', 'tiff'].includes(ext)) ctx.warnings.add(t('io.unsupportedImages', { ext: ext.toUpperCase() }))
      continue
    }
    const f = ctx.zip.file(resolvePath(basePath, r.target))
    if (!f) continue
    ctx.media.set(id, bytesToDataUrl(await f.async('uint8array'), MIME[ext]))
  }
}

type Mark = { type: string; attrs?: Record<string, unknown> }

function marksFor(rp: RunProps, st: ParaStyle, docTheme?: DocTheme | null): Mark[] {
  const m: Mark[] = []
  if (rp.bold && !st.bold) m.push({ type: 'bold' })
  if (rp.italic && !st.italic) m.push({ type: 'italic' })
  if (rp.underline) m.push({ type: 'underline' })
  if (rp.strike) m.push({ type: 'strike' })
  if (rp.vert === 'sub') m.push({ type: 'subscript' })
  if (rp.vert === 'sup') m.push({ type: 'superscript' })
  const ts: Record<string, string> = {}
  const styleFont = st.font || DEFAULT_FONT
  if (rp.font && rp.font !== styleFont) ts.fontFamily = fontStack(rp.font)
  if (rp.sizePt && Math.abs(rp.sizePt - st.sizePt) > 0.01) ts.fontSize = `${rp.sizePt}pt`
  const styleColor = (st.color || '#000000').toLowerCase()
  const color = rp.color ?? '#000000'
  // "Text 1" and friends are usually just the style's own colour: no mark for those.
  const rc = resolveColor(color, docTheme ?? undefined).toLowerCase()
  const same = isHex(rc) && isHex(styleColor) ? colorDistance(rc, styleColor) <= 2 : rc === styleColor
  if (!same) ts.color = color
  if (rp.shading) ts.backgroundColor = rp.shading
  if (Object.keys(ts).length) m.push({ type: 'textStyle', attrs: { fontFamily: null, fontSize: null, color: null, backgroundColor: null, ...ts } })
  if (rp.highlight) m.push({ type: 'highlight', attrs: { color: rp.highlight } })
  return m
}

interface ParaOut { blocks: JSONContent[]; numbered: { numId: string; ilvl: number } | null; sectionBreak: boolean }

/** Convert one <w:p>. May yield several blocks (page breaks split paragraphs). */
function readParagraph(p: El, ctx: Ctx): ParaOut {
  const pPr = child(p, 'w:pPr')
  const styleId = val(child(pPr, 'w:pStyle')) || ctx.styles.defaultPara
  const st = ctx.styles.target(styleId)
  const direct = parsePPr(pPr)
  const eff: ParaProps = { ...ctx.styles.docP, ...ctx.styles.paraProps(styleId), ...direct }
  const paraRun: RunProps = { ...ctx.styles.docR, ...ctx.styles.runProps(styleId) }
  const pMarkR = parseRPr(child(pPr, 'w:rPr'), ctx.theme)

  const numId = eff.numId && eff.numId !== '0' ? eff.numId : null
  const numbered = numId && ctx.numbering.level(numId, eff.ilvl ?? 0) ? { numId, ilvl: eff.ilvl ?? 0 } : null

  // Paragraph attributes: only where they differ from our style.
  const attrs: Record<string, unknown> = {}
  if (st.node === 'heading') attrs.level = st.level
  else if (st.id !== 'Normal') attrs.styleId = st.id
  const align = eff.align && eff.align !== 'left' ? eff.align : null
  if (align && align !== st.align) attrs.textAlign = align
  else if (!align && st.align) attrs.textAlign = 'left'
  const near = (a: number | undefined, b: number) => a != null && Math.abs(a - b) > 0.05
  if (near(eff.before ?? 0, st.spaceBeforePt)) attrs.spaceBefore = eff.before ?? 0
  if (near(eff.after ?? 0, st.spaceAfterPt)) attrs.spaceAfter = eff.after ?? 0
  const line = eff.line ?? '1'
  if (line.endsWith('pt') || Math.abs(parseFloat(line) - st.lineHeight) > 0.005) attrs.lineHeight = line
  if (!numbered) {
    if (eff.indL) attrs.indentLeft = eff.indL
    if (eff.first) attrs.firstLine = eff.first
  }
  if (eff.indR) attrs.indentRight = eff.indR
  if (eff.keepNext && !st.keepNext) attrs.keepNext = true
  if (direct.pageBreakBefore) attrs.pageBreakBefore = true
  if (eff.shading) attrs.shading = eff.shading

  const type = st.node === 'heading' ? 'heading' : 'paragraph'
  const blocks: JSONContent[] = []
  let inline: JSONContent[] = []
  const flush = (force = false) => {
    if (!inline.length && !force) return
    if (inline.length && inline.every((n) => n.type === 'image' || (n.type === 'text' && !n.text!.trim()))) {
      for (const n of inline) if (n.type === 'image' && !n.attrs!.wrap) n.attrs = { ...n.attrs, wrap: 'topBottom', align: (attrs.textAlign as string) || st.align || 'left' }
    }
    inline = hoistToStart(inline, (n) => ctx.paragraphAnchored.has(n))
    blocks.push({ type, attrs: { ...attrs }, content: inline.length ? inline : undefined })
    inline = []
    delete attrs.pageBreakBefore
  }

  let fieldDepth = 0
  let fieldPhase: ('instr' | 'result')[] = []
  let fieldInstr = ''

  const pushText = (text: string, marks: Mark[]) => {
    if (!text) return
    const last = inline[inline.length - 1]
    if (last && last.type === 'text' && JSON.stringify(last.marks || []) === JSON.stringify(marks)) last.text += text
    else inline.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text })
  }

  const readRun = (r: El, linkMarks: Mark[]) => {
    const rPr = child(r, 'w:rPr')
    const rStyle = val(child(rPr, 'w:rStyle'))
    const direct = parseRPr(rPr, ctx.theme)
    const rp: RunProps = { ...paraRun, ...ctx.styles.runProps(rStyle), ...direct }
    if (rp.hidden) return
    // Inside a hyperlink the link mark already renders underline + link colour.
    if (linkMarks.length) {
      if (direct.underline === undefined) rp.underline = false
      if (direct.color === undefined) rp.color = paraRun.color
    }
    const marks = [...marksFor(rp, st, ctx.theme.doc), ...linkMarks]
    for (const c of kids(r)) {
      switch (c.tagName) {
        case 'w:fldChar': {
          const t = attr(c, 'w:fldCharType')
          if (t === 'begin') { fieldDepth++; fieldPhase.push('instr'); fieldInstr = '' }
          else if (t === 'separate') fieldPhase[fieldPhase.length - 1] = 'result'
          else if (t === 'end') { fieldDepth = Math.max(0, fieldDepth - 1); fieldPhase.pop() }
          break
        }
        case 'w:instrText': fieldInstr += c.textContent || ''; break
        case 'w:t':
        case 'w:delText': {
          if (c.tagName === 'w:delText') break
          if (fieldDepth && fieldPhase[fieldPhase.length - 1] === 'instr') break
          let t = c.textContent || ''
          if (rp.caps) t = t.toLocaleUpperCase()
          pushText(t, marks)
          break
        }
        case 'w:tab': pushText('\t', marks); break
        case 'w:noBreakHyphen': pushText('‑', marks); break
        case 'w:softHyphen': pushText('­', marks); break
        case 'w:sym': {
          const code = parseInt(attr(c, 'w:char') || '', 16)
          if (Number.isFinite(code)) pushText(String.fromCodePoint(code >= 0xf000 ? code - 0xf000 : code), marks)
          break
        }
        case 'w:cr': inline.push({ type: 'hardBreak' }); break
        case 'w:br': {
          const t = attr(c, 'w:type')
          if (t === 'page') { flush(); blocks.push({ type: 'pageBreak' }) }
          else inline.push({ type: 'hardBreak' })
          break
        }
        case 'w:drawing':
        case 'w:pict':
        case 'mc:AlternateContent': {
          const img = readImage(c, ctx)
          if (img) inline.push(img)
          break
        }
      }
    }
    void fieldInstr
  }

  const walk = (el: El, linkMarks: Mark[]) => {
    for (const c of kids(el)) {
      switch (c.tagName) {
        case 'w:r': readRun(c, linkMarks); break
        case 'w:hyperlink': {
          const rid = attr(c, 'r:id')
          const anchor = attr(c, 'w:anchor')
          const href = rid ? ctx.rels.get(rid)?.target : anchor ? `#${anchor}` : null
          walk(c, href ? [...linkMarks, { type: 'link', attrs: { href, target: null, rel: 'noopener noreferrer', class: null } }] : linkMarks)
          break
        }
        case 'w:ins': case 'w:moveTo': case 'w:smartTag': case 'w:customXml': case 'w:fldSimple': case 'w:bdo': case 'w:dir':
          walk(c, linkMarks); break
        case 'w:sdt': walk(child(c, 'w:sdtContent') || c, linkMarks); break
        case 'm:oMathPara': case 'm:oMath': {
          const math = Array.from(c.getElementsByTagName('m:t')).map((x) => x.textContent).join('')
          pushText(math, [{ type: 'italic' }])
          ctx.warnings.add(t('io.math'))
          break
        }
      }
    }
  }
  walk(p, [])
  void pMarkR

  // Section break inside a paragraph → page break (single-section model).
  const sect = child(pPr, 'w:sectPr')
  const sectType = val(child(sect, 'w:type'))
  // Emit the paragraph itself unless it only carried a page break.
  flush(!blocks.length)
  return { blocks, numbered, sectionBreak: !!sect && sectType !== 'continuous' }
}

function readImage(el: El, ctx: Ctx): JSONContent | null {
  const blip = el.getElementsByTagName('a:blip')[0]
  const imgData = el.getElementsByTagName('v:imagedata')[0]
  const rid = blip ? blip.getAttribute('r:embed') : imgData ? imgData.getAttribute('r:id') : null
  if (!rid) return null
  const src = ctx.media.get(rid)
  if (!src) return null
  let width: number | null = null
  let height: number | null = null
  const ext = el.getElementsByTagName('wp:extent')[0]
  if (ext) {
    width = Math.round(Number(ext.getAttribute('cx')) / 9525)
    height = Math.round(Number(ext.getAttribute('cy')) / 9525)
  } else {
    const shape = el.getElementsByTagName('v:shape')[0]
    const style = shape?.getAttribute('style') || ''
    const w = /width:\s*([\d.]+)pt/.exec(style)
    const h = /height:\s*([\d.]+)pt/.exec(style)
    if (w) width = Math.round((parseFloat(w[1]) * 96) / 72)
    if (h) height = Math.round((parseFloat(h[1]) * 96) / 72)
  }
  // Floating pictures map onto our two layouts: text wraps around (square) or above/below.
  let wrap: string | null = null
  let align = 'center'
  let x: number | null = null
  let y: number | null = null
  let paragraphRelative = false
  let sideByPosition = false
  // Positioned on the page (from its margins or edges, as Graphi saves pinned pictures): pinned to the
  // page its paragraph lands on (page -1, see editor/floats.ts).
  let page: number | null = null
  let edgeH = false, edgeV = false
  const anchor = el.getElementsByTagName('wp:anchor')[0]
  if (anchor) {
    const has = (t: string) => anchor.getElementsByTagName(t).length > 0
    wrap = has('wp:wrapSquare') || has('wp:wrapTight') || has('wp:wrapThrough') ? 'square' : 'topBottom'
    const posH = anchor.getElementsByTagName('wp:positionH')[0]
    const al = posH?.getElementsByTagName('wp:align')[0]?.textContent
    if (al === 'left' || al === 'inside') align = 'left'
    else if (al === 'right' || al === 'outside') align = 'right'
    else if (al === 'center') align = 'center'
    else if (posH) {
      // Absolute offset: kept exactly when measured from the column / margin (as we export it),
      // i.e. from the left; otherwise the nearest side of the column.
      const off = Number(posH.getElementsByTagName('wp:posOffset')[0]?.textContent || 0) / 9525
      const rel = posH.getAttribute('relativeFrom')
      if ((rel === 'column' || rel === 'margin') && off >= 0) x = Math.round(off)
      else if (rel === 'page') { x = Math.round(off); edgeH = true }
      align = x != null || off < 40 ? 'left' : 'right'
    }
    if (wrap === 'square' && align === 'center') align = 'left'
    // A one-sided square wrap names the side the text is on; the picture is on the other.
    const wrapText = anchor.getElementsByTagName('wp:wrapSquare')[0]?.getAttribute('wrapText')
    if (wrap === 'square' && wrapText === 'left') align = 'right'
    else if (wrap === 'square' && wrapText === 'right') align = 'left'
    else if (wrap === 'square' && x != null) sideByPosition = true
    // Vertical offset below the anchor's line or paragraph → our free vertical spot (measured from
    // the anchor line; a paragraph-relative picture is moved to the paragraph's start by the caller).
    const posV = anchor.getElementsByTagName('wp:positionV')[0]
    const relV = posV?.getAttribute('relativeFrom')
    const offV = Number(posV?.getElementsByTagName('wp:posOffset')[0]?.textContent || 0) / 9525
    if (relV === 'paragraph' || relV === 'line') {
      if (offV >= MIN_Y) y = Math.round(offV)
    } else if (relV === 'margin' || relV === 'page' || relV === 'topMargin') {
      page = -1
      y = Math.round(offV)
      edgeV = relV !== 'margin'
    }
    paragraphRelative = relV !== 'line'
  }
  const docPr = el.getElementsByTagName('wp:docPr')[0]
  const alt = docPr?.getAttribute('descr') || docPr?.getAttribute('title') || null
  // <a:xfrm rot> is in 60000ths of a degree, clockwise.
  const rot = Number(el.getElementsByTagName('a:xfrm')[0]?.getAttribute('rot') || 0) / 60000
  const node: JSONContent = { type: 'image', attrs: { src, alt, title: null, width, height, wrap, align, x, y, page, rotate: normRotate(rot) } }
  if (edgeH || edgeV) ctx.fromPageEdge.push({ node, h: edgeH, v: edgeV })
  if (paragraphRelative) ctx.paragraphAnchored.add(node)
  if (sideByPosition) ctx.sideByPosition.add(node)
  return node
}

function readTable(tbl: El, ctx: Ctx): JSONContent {
  const grid = kids(child(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => Math.round((num(attr(g, 'w:w')) || 0) / 15))
  const rows: JSONContent[] = []
  const vmergeOrigin = new Map<number, JSONContent>() // grid column → cell being row-spanned
  for (const tr of kids(tbl, 'w:tr')) {
    const trPr = child(tr, 'w:trPr')
    const isHeader = !!child(trPr, 'w:tblHeader')
    const cells: JSONContent[] = []
    let col = num(val(child(trPr, 'w:gridBefore'))) || 0
    for (const tc of kids(tr).flatMap((c) => (c.tagName === 'w:sdt' ? kids(child(c, 'w:sdtContent'), 'w:tc') : c.tagName === 'w:tc' ? [c] : []))) {
      const tcPr = child(tc, 'w:tcPr')
      const span = num(val(child(tcPr, 'w:gridSpan'))) || 1
      const vm = child(tcPr, 'w:vMerge')
      const vmVal = vm ? val(vm) || 'continue' : null
      if (vmVal === 'continue') {
        const origin = vmergeOrigin.get(col)
        if (origin) origin.attrs!.rowspan = (origin.attrs!.rowspan as number) + 1
        col += span
        continue
      }
      const content = readBlocks(kids(tc), ctx)
      const shdEl = child(tcPr, 'w:shd')
      const fill = attr(shdEl, 'w:fill')
      let bg = (shdEl && themeLinked(shdEl, 'Fill', ctx.theme)) ?? (fill && fill !== 'auto' ? `#${fill.toLowerCase()}` : null)
      // Header rows written by Graphi carry the default header fill (Accent 1, Lighter 88%): leave it to the theme.
      if (isHeader && parseThemeRef(bg)?.slot === 'accent1' && parseThemeRef(bg)?.pct === 88) bg = null
      const va = val(child(tcPr, 'w:vAlign'))
      const widths = grid.slice(col, col + span)
      const cell: JSONContent = {
        type: isHeader ? 'tableHeader' : 'tableCell',
        attrs: {
          colspan: span,
          rowspan: 1,
          colwidth: widths.length === span && widths.every((w) => w > 0) ? widths : null,
          backgroundColor: bg,
          verticalAlign: va === 'center' ? 'middle' : va === 'bottom' ? 'bottom' : null,
        },
        content: content.length ? content : [{ type: 'paragraph' }],
      }
      if (vmVal === 'restart') vmergeOrigin.set(col, cell)
      else for (let i = 0; i < span; i++) vmergeOrigin.delete(col + i)
      cells.push(cell)
      col += span
    }
    if (cells.length) rows.push({ type: 'tableRow', content: cells })
  }
  const style = /^Grafi-(.+)$/.exec(val(child(child(tbl, 'w:tblPr'), 'w:tblStyle')) || '')?.[1]
  const table: JSONContent = { type: 'table', attrs: { tableStyle: tableStyle(style)?.id ?? null }, content: rows.length ? rows : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] }
  return unbakeTableStyle(table)
}

const CAPTION_RE = /^(Εικόνα|Σχήμα|Figure|Fig\.)\s*\d+\s*[:.–-]\s*|^(Πίνακας|Table)\s*\d+\s*[:.–-]\s*/

/** Table-of-contents paragraph level (0 = TOC heading), or null. */
function tocLevel(p: El, ctx: Ctx): number | null {
  const id = val(child(child(p, 'w:pPr'), 'w:pStyle'))
  if (!id) return null
  const name = ctx.styles.defs.get(id)?.name || id.toLowerCase()
  if (name === 'toc heading' || /^tocheading$/i.test(id)) return 0
  const m = /^toc\s*(\d)$/.exec(name) || /^TOC(\d)$/i.exec(id)
  return m ? Number(m[1]) : null
}

/** Caption paragraph: drop the static "Εικόνα 3:" prefix and let auto-numbering take over. */
function asCaption(b: JSONContent): JSONContent {
  if (b.type !== 'paragraph' || b.attrs?.styleId !== 'Caption' || !b.content?.length) return b
  const first = b.content[0]
  if (first.type !== 'text') return b
  const m = CAPTION_RE.exec(first.text || '')
  if (!m) return b
  const kind = m[2] ? 'table' : 'figure'
  const rest = (first.text || '').slice(m[0].length)
  const content = rest ? [{ ...first, text: rest }, ...b.content.slice(1)] : b.content.slice(1)
  return { ...b, attrs: { ...b.attrs, captionKind: kind }, content: content.length ? content : undefined }
}

/** Body-level reader with list reconstruction. */
function readBlocks(elements: El[], ctx: Ctx): JSONContent[] {
  const out: JSONContent[] = []
  // A run of TOC paragraphs becomes one live table of contents.
  let toc: JSONContent | null = null
  type Open = { level: number; numId: string; ordered: boolean; node: JSONContent; lastItem: JSONContent | null }
  const stack: Open[] = []
  const closeAll = () => { stack.length = 0 }

  const addNumbered = (block: JSONContent, numId: string, ilvl: number) => {
    const lvl = ctx.numbering.level(numId, ilvl)!
    const { ordered, style } = listStyleOf(lvl)
    while (stack.length && stack[stack.length - 1].level > ilvl) stack.pop()
    let top = stack[stack.length - 1]
    if (top && top.level === ilvl && (top.numId !== numId || top.ordered !== ordered)) {
      stack.pop()
      top = stack[stack.length - 1]
    }
    const key = `${numId}:${ilvl}`
    if (!top || top.level < ilvl) {
      // Reset deeper counters when a new sub-list begins.
      const count = ctx.numbering.counters.get(key)
      const start = count != null ? count + 1 : lvl.start
      const node: JSONContent = {
        type: ordered ? 'orderedList' : 'bulletList',
        attrs: ordered ? { start, listStyle: style, type: null } : { listStyle: style },
        content: [],
      }
      if (top?.lastItem) top.lastItem.content!.push(node)
      else out.push(node)
      top = { level: ilvl, numId, ordered, node, lastItem: null }
      stack.push(top)
    }
    const item: JSONContent = { type: 'listItem', content: [block] }
    top.node.content!.push(item)
    top.lastItem = item
    ctx.numbering.counters.set(key, (ctx.numbering.counters.get(key) ?? lvl.start - 1) + 1)
    for (const k of [...ctx.numbering.counters.keys()]) {
      const [n, l] = k.split(':')
      if (n === numId && Number(l) > ilvl) ctx.numbering.counters.delete(k)
    }
  }

  for (const el of elements) {
    if (el.tagName === 'w:p') {
      const tl = tocLevel(el, ctx)
      if (tl != null) {
        closeAll()
        if (!toc) { toc = { type: 'tableOfContents', attrs: { maxLevel: 3, seen: 0 } }; out.push(toc) }
        if (tl > 0) {
          toc.attrs!.seen = Math.max(toc.attrs!.seen as number, tl)
          toc.attrs!.maxLevel = Math.max(2, toc.attrs!.seen as number)
        }
        continue
      }
      toc = null
    }
    switch (el.tagName) {
      case 'w:p': {
        const r = readParagraph(el, ctx)
        r.blocks = r.blocks.map(asCaption)
        // Numbered headings (multilevel list linked to Heading styles) stay headings: the
        // document gets heading numbering instead of being turned into list items.
        if (r.numbered && r.blocks.length === 1 && r.blocks[0].type === 'heading') {
          ctx.headingNumbers = true
          closeAll()
          out.push(r.blocks[0])
        } else if (r.numbered && r.blocks.length === 1) addNumbered(r.blocks[0], r.numbered.numId, r.numbered.ilvl)
        else {
          closeAll()
          out.push(...r.blocks)
        }
        if (r.sectionBreak) { closeAll(); out.push({ type: 'pageBreak' }) }
        break
      }
      case 'w:tbl':
        closeAll()
        out.push(readTable(el, ctx))
        break
      case 'w:sdt': {
        const gallery = el.getElementsByTagName('w:docPartGallery')[0]
        if (gallery && /table of contents/i.test(val(gallery) || '')) {
          closeAll()
          // Max TOC level from the field instruction (\o "1-3").
          const instr = Array.from(el.getElementsByTagName('w:instrText')).map((x) => x.textContent).join(' ')
          const m = /\\o\s*"(\d)-(\d)"/.exec(instr)
          out.push({ type: 'tableOfContents', attrs: { maxLevel: m ? Number(m[2]) : 3 } })
          toc = null
          break
        }
        out.push(...readBlocks(kids(child(el, 'w:sdtContent')), ctx))
        break
      }
      case 'w:customXml':
      case 'w:ins':
      case 'w:moveTo':
        out.push(...readBlocks(kids(el), ctx))
        break
    }
  }
  // A trailing page break needs something after it.
  if (out.length && out[out.length - 1].type === 'pageBreak') out.push({ type: 'paragraph' })
  return out
}

async function readHeaderFooter(zip: JSZip, docRels: Map<string, { target: string; external: boolean }>, rid: string | null) {
  if (!rid) return null
  const r = docRels.get(rid)
  if (!r) return null
  const f = zip.file(resolvePath('word/document.xml', r.target))
  if (!f) return null
  const x = parseXml(await f.async('string'))
  let best: { text: string; align: HFAlign } | null = null
  for (const p of Array.from(x.getElementsByTagName('w:p'))) {
    let text = ''
    let instr = ''
    let phase: string[] = []
    const visit = (el: El) => {
      for (const c of kids(el)) {
        if (c.tagName === 'w:fldSimple') {
          const ins = (attr(c, 'w:instr') || '').trim().split(/\s+/)[0].toUpperCase()
          if (ins === 'PAGE') text += '{page}'
          else if (ins === 'NUMPAGES' || ins === 'SECTIONPAGES') text += '{pages}'
          else visit(c)
        } else if (c.tagName === 'w:fldChar') {
          const t = attr(c, 'w:fldCharType')
          if (t === 'begin') { phase.push('instr'); instr = '' }
          else if (t === 'separate') {
            const ins = instr.trim().split(/\s+/)[0].toUpperCase()
            if (ins === 'PAGE') text += '{page}'
            else if (ins === 'NUMPAGES' || ins === 'SECTIONPAGES') text += '{pages}'
            phase[phase.length - 1] = ins === 'PAGE' || ins === 'NUMPAGES' || ins === 'SECTIONPAGES' ? 'skip' : 'result'
          } else if (t === 'end') phase.pop()
        } else if (c.tagName === 'w:instrText') instr += c.textContent || ''
        else if (c.tagName === 'w:t') {
          const ph = phase[phase.length - 1]
          if (ph !== 'instr' && ph !== 'skip') text += c.textContent || ''
        } else if (c.tagName === 'w:tab') text += '   '
        else visit(c)
      }
    }
    visit(p)
    text = text.trim()
    if (!text) continue
    const jc = val(child(child(p, 'w:pPr'), 'w:jc'))
    const align: HFAlign = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' ? 'left' : 'left'
    best = { text, align }
    break
  }
  return best
}

export async function importDocx(data: Uint8Array): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(data)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error(t('io.badDocx'))

  const str = async (p: string) => { const f = zip.file(p); return f ? f.async('string') : null }
  const themeXml = await str('word/theme/theme1.xml')
  const theme: Theme = { minor: 'Calibri', major: 'Calibri Light' }
  if (themeXml) {
    const t = parseXml(themeXml)
    const minor = t.getElementsByTagName('a:minorFont')[0]?.getElementsByTagName('a:latin')[0]?.getAttribute('typeface')
    const major = t.getElementsByTagName('a:majorFont')[0]?.getElementsByTagName('a:latin')[0]?.getAttribute('typeface')
    if (minor) theme.minor = minor
    if (major) theme.major = major
    theme.doc = parseThemeXml(themeXml)
  }
  const stylesXml = await str('word/styles.xml')
  const numberingXml = await str('word/numbering.xml')
  const rels = await readRels(zip, 'word/_rels/document.xml.rels')
  const ctx: Ctx = {
    zip,
    theme,
    styles: new Styles(stylesXml ? parseXml(stylesXml) : null, theme),
    numbering: new Numbering(numberingXml ? parseXml(numberingXml) : null),
    rels,
    media: new Map(),
    warnings: new Set(),
    paragraphAnchored: new WeakSet(),
    sideByPosition: new Set(),
    fromPageEdge: [],
  }
  await loadMedia(ctx, 'word/document.xml', rels)

  const xml = parseXml(await docFile.async('string'))
  if (xml.getElementsByTagName('parsererror').length) throw new Error(t('io.corruptXml'))
  const body = xml.getElementsByTagName('w:body')[0]
  const content = readBlocks(kids(body), ctx)

  // Page geometry from the final section.
  const s = normalizeSettings(DEFAULT_SETTINGS)
  const sect = child(body, 'w:sectPr')
  if (sect) {
    const pgSz = child(sect, 'w:pgSz')
    const w = num(attr(pgSz, 'w:w'))
    const h = num(attr(pgSz, 'w:h'))
    if (w && h) {
      s.width = twipToMm(w)
      s.height = twipToMm(h)
      s.orientation = attr(pgSz, 'w:orient') === 'landscape' || w > h ? 'landscape' : 'portrait'
      s.paper = detectPaper(s.width, s.height)
    }
    const mar = child(sect, 'w:pgMar')
    if (mar) {
      const g = (k: string, d: number) => { const v = num(attr(mar, `w:${k}`)); return v == null ? d : twipToMm(Math.abs(v)) }
      s.margins = { top: g('top', 25.4), right: g('right', 25.4), bottom: g('bottom', 25.4), left: g('left', 25.4) }
      s.hf.headerDistance = g('header', 12.5)
      s.hf.footerDistance = g('footer', 12.5)
    }
    const cols = num(attr(child(sect, 'w:cols'), 'w:num'))
    if (cols && cols > 1) {
      s.columns = Math.min(3, cols) as 2 | 3
      const sp = num(attr(child(sect, 'w:cols'), 'w:space'))
      if (sp) s.columnGap = twipToMm(sp)
    }
    s.hf.differentFirstPage = onOff(child(sect, 'w:titlePg')) || false
    const ref = (tag: string, type: string) =>
      kids(sect, tag).find((e) => (attr(e, 'w:type') || 'default') === type)?.getAttribute('r:id') || null
    const header = await readHeaderFooter(zip, rels, ref('w:headerReference', 'default'))
    const footer = await readHeaderFooter(zip, rels, ref('w:footerReference', 'default'))
    if (header) { s.hf.headerText = header.text; s.hf.headerAlign = header.align }
    if (footer) { s.hf.footerText = footer.text; s.hf.footerAlign = footer.align }
  }

  const core = await str('docProps/core.xml')
  if (core) {
    const c = parseXml(core)
    s.title = c.getElementsByTagName('dc:title')[0]?.textContent || ''
    s.author = c.getElementsByTagName('dc:creator')[0]?.textContent || ''
  }

  if (ctx.headingNumbers) s.headingNumbers = true
  const textWidth = mmToPx(s.width - s.margins.left - s.margins.right)
  for (const { node, h, v } of ctx.fromPageEdge) {
    const a = node.attrs!
    if (v) a.y = Math.max(0, Math.round(a.y - mmToPx(s.margins.top)))
    if (h && a.x != null) a.x = Math.max(0, Math.round(a.x - mmToPx(s.margins.left)))
  }
  for (const n of ctx.sideByPosition) n.attrs!.align = squareSide(n.attrs!.x, n.attrs!.width ?? 0, textWidth)
  // The document keeps its Word theme (colours + fonts); styles and theme-coloured text follow it.
  if (theme.doc) s.theme = theme.doc
  return {
    doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    settings: s,
    warnings: [...ctx.warnings],
  }
}
