// «Εκπαίδευση» (File ▸ Εκπαίδευση): guided lessons inside the real editor, in five levels
// (1, 2, 3, 4, Pro). Each lesson opens a document whose first page(s) hold a finished
// sample; the learner rebuilds it on the following page from nothing. A floating coach
// shows one small step at a time, points at the exact button with a pulsing frame, checks
// the document after every keystroke and moves on by itself. Scoring is deliberately
// simple and encouraging: every correct step earns its full points, every finished level a
// bonus and three stars, and the last level crowns a «Graphi Master».
// The sample pages are locked so they cannot be damaged by accident.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Mark, Node as PMNode } from '@tiptap/pm/model'
import type { AppApi } from './App'
import type { DocSettings } from '../model/settings'
import { layoutStore } from '../editor/layoutStore'
import { toast } from './toast'
import { Ill } from './illustrations'
import { styleName } from '../model/styles'
import { t, onLangChange, fmtInt, numText, type Key } from '../i18n'
import { rich } from '../i18n/rich'

// ───────────── pictures ─────────────
/** Friendly drawing of a neighbourhood (houses, tree, sun) used as the lesson picture. */
export const TRAINING_IMAGE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="380" viewBox="0 0 640 380">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A5EBE7"/><stop offset="1" stop-color="#EFFCFB"/></linearGradient></defs>
  <rect width="640" height="380" fill="url(#s)"/>
  <circle cx="540" cy="80" r="44" fill="#FDE047"/>
  <ellipse cx="150" cy="70" rx="60" ry="18" fill="#fff" opacity=".9"/><ellipse cx="190" cy="60" rx="40" ry="16" fill="#fff" opacity=".9"/>
  <rect y="300" width="640" height="80" fill="#6FDAD4"/><rect y="330" width="640" height="50" fill="#13928C"/>
  <rect x="60" y="190" width="150" height="120" fill="#FFFFFF" stroke="#117470" stroke-width="4"/>
  <path d="M48 196 L135 120 L222 196 Z" fill="#EF4444" stroke="#117470" stroke-width="4" stroke-linejoin="round"/>
  <rect x="118" y="245" width="36" height="65" fill="#F59E0B"/><rect x="78" y="212" width="30" height="28" fill="#BFE3FF"/><rect x="164" y="212" width="30" height="28" fill="#BFE3FF"/>
  <rect x="250" y="160" width="130" height="150" fill="#FDE68A" stroke="#117470" stroke-width="4"/>
  <path d="M238 166 L315 100 L392 166 Z" fill="#3B82F6" stroke="#117470" stroke-width="4" stroke-linejoin="round"/>
  <rect x="297" y="250" width="36" height="60" fill="#117470"/><rect x="268" y="185" width="30" height="30" fill="#BFE3FF"/><rect x="332" y="185" width="30" height="30" fill="#BFE3FF"/>
  <rect x="470" y="220" width="18" height="90" fill="#92400E"/>
  <circle cx="479" cy="195" r="52" fill="#22C55E"/><circle cx="450" cy="215" r="30" fill="#16A34A"/><circle cx="508" cy="212" r="32" fill="#16A34A"/>
  <circle cx="560" cy="300" r="14" fill="#EC4899"/><circle cx="590" cy="306" r="11" fill="#F59E0B"/><circle cx="420" cy="304" r="12" fill="#8B5CF6"/>
</svg>`)

type ImgAttrs = Record<string, unknown>
const IMG: ImgAttrs = { src: TRAINING_IMAGE, alt: '', // alt text is set in the UI language when inserted
  width: 320, height: 190, wrap: 'topBottom', align: 'center' }

/** Picture the Insert ▸ Image ▸ «Εικόνα εκπαίδευσης» menu inserts for the running lesson. */
let activeImage: ImgAttrs = IMG
export function insertTrainingImage(editor: Editor) {
  editor.chain().focus().insertContent({ type: 'image', attrs: { ...activeImage, alt: t('ins.trainingPicture') } }).run()
}

// ───────────── document builders ─────────────
type M = JSONContent['marks']
const tx = (text: string, marks?: M): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const B: M = [{ type: 'bold' }]
const para = (content: JSONContent[] = [], attrs?: Record<string, unknown>): JSONContent =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) })
const p = (text: string, attrs?: Record<string, unknown>) => para([tx(text)], attrs)
const h = (level: number, text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type: 'heading', attrs: { level, ...attrs }, content: [tx(text)] })
const list = (type: 'bulletList' | 'orderedList', items: string[]): JSONContent => ({ type, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const table = (rows: string[][], shadeFirst?: string): JSONContent => ({
  type: 'table',
  content: rows.map((r, i) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', attrs: i === 0 && shadeFirst ? { backgroundColor: shadeFirst } : {}, content: [p(c)] })) })),
})
const img = (attrs: ImgAttrs): JSONContent => ({ type: 'image', attrs: { ...attrs, alt: t('ins.trainingPicture') } })
const PB: JSONContent = { type: 'pageBreak' }

// ───────────── reading the learner's page ─────────────
/** Lenient comparison: ignores accents, capitals, final sigma, punctuation and extra spaces. */
const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ').replace(/[.,!;·:«»"'’‘“”]/g, '').replace(/\s+/g, ' ').trim()
const same = (a: string, b: string) => norm(a) === norm(b)

interface At { node: PMNode; pos: number }
interface Ctx {
  e: Editor
  s: DocSettings
  start: number // first learner position, -1 if the dividing page break is gone
  top: At[] // learner top-level blocks
  all: At[] // every learner node
}

/** Position of the page break that ends the sample: the (k+1)-th top-level page break. */
function splitPos(doc: PMNode, k: number): number {
  let pos = 0, seen = 0
  for (let i = 0; i < doc.childCount; i++) {
    const n = doc.child(i)
    if (n.type.name === 'pageBreak' && seen++ === k) return pos
    pos += n.nodeSize
  }
  return -1
}

function makeCtx(e: Editor, s: DocSettings, k: number): Ctx {
  const doc = e.state.doc
  const split = splitPos(doc, k)
  const start = split < 0 ? -1 : split + 1
  const top: At[] = [], all: At[] = []
  if (start >= 0) {
    doc.forEach((node, pos) => { if (pos >= start) top.push({ node, pos }) })
    doc.nodesBetween(start, doc.content.size, (node, pos) => { if (pos >= start) all.push({ node, pos }) })
  }
  return { e, s, start, top, all }
}

const tbs = (c: Ctx) => c.all.filter((x) => x.node.isTextblock)
const findTb = (c: Ctx, text: string, pred?: (n: PMNode) => boolean) =>
  tbs(c).find((x) => same(x.node.textContent, text) && (!pred || pred(x.node)))
const isH = (level: number) => (n: PMNode) => n.type.name === 'heading' && n.attrs.level === level
const isP = (n: PMNode) => n.type.name === 'paragraph'
const heading = (c: Ctx, level: number, text: string) => findTb(c, text, isH(level))
const paragraph = (c: Ctx, text: string) => findTb(c, text, isP)
const alignOf = (n: PMNode) => (n.attrs.textAlign as string) || 'left'
const aligned = (c: Ctx, text: string, a: string, pred?: (n: PMNode) => boolean) => {
  const b = findTb(c, text, pred)
  return !!b && alignOf(b.node) === a
}

const bold = (m: Mark) => m.type.name === 'bold'
const underline = (m: Mark) => m.type.name === 'underline'
const colored = (m: Mark) => m.type.name === 'textStyle' && !!m.attrs.color
const highlighted = (m: Mark) => m.type.name === 'highlight'
/** 'ok' = exactly `word` carries the mark in the block that reads `text`; 'more' = other words too. */
function marked(c: Ctx, text: string, word: string, test: (m: Mark) => boolean): 'ok' | 'more' | null {
  const b = findTb(c, text)
  if (!b) return null
  let s = ''
  b.node.forEach((ch) => { if (ch.isText && ch.marks.some(test)) s += ch.text })
  if (!norm(s).includes(norm(word))) return null
  return norm(s) === norm(word) ? 'ok' : 'more'
}

function listItems(c: Ctx, type: 'bulletList' | 'orderedList'): string[] | null {
  const l = c.top.find((x) => x.node.type.name === type)
  if (!l) return null
  const items: string[] = []
  l.node.forEach((li) => { if (norm(li.textContent)) items.push(li.textContent) })
  return items
}
const listIs = (c: Ctx, type: 'bulletList' | 'orderedList', want: string[]) => {
  const got = listItems(c, type)
  return !!got && got.length === want.length && want.every((w, i) => same(got[i], w))
}

interface TableInfo { node: PMNode; pos: number; rows: number; cols: number; cells: string[][]; shade: boolean[][] }
function tableOf(c: Ctx): TableInfo | null {
  const t = c.top.find((x) => x.node.type.name === 'table')
  if (!t) return null
  const cells: string[][] = [], shade: boolean[][] = []
  let lastUsed = 0
  t.node.forEach((row, _o, r) => {
    cells.push([]); shade.push([])
    row.forEach((cell) => { cells[r].push(cell.textContent); shade[r].push(!!cell.attrs.backgroundColor) })
    if (norm(row.textContent)) lastUsed = r + 1
  })
  // Tab in the last cell adds an empty row; once the table has text, trailing empty rows don't count.
  const rows = lastUsed ? Math.min(t.node.childCount, Math.max(lastUsed, 3)) : t.node.childCount
  return { ...t, rows, cols: t.node.firstChild?.childCount || 0, cells, shade }
}
const tableHas = (c: Ctx, want: string[][]) => {
  const t = tableOf(c)
  return !!t && want.every((r, i) => r.every((w, k) => same(t.cells[i]?.[k] ?? '', w)))
}
const sizeHint = (c: Ctx, cols: number, rows: number) => {
  const tb = tableOf(c)
  return tb && !(tb.cols === cols && tb.rows >= rows)
    ? t('tr.sizeHint', { cols: tb.cols, rows: tb.rows, wantCols: cols, wantRows: rows }) : null
}
const imageOf = (c: Ctx) => c.all.find((x) => x.node.type.name === 'image')
const imgAttr = (c: Ctx, k: string) => imageOf(c)?.node.attrs[k]
const imageSelected = (c: Ctx) => {
  const sel = c.e.state.selection as unknown as { node?: PMNode; from: number }
  return sel.node?.type.name === 'image' && sel.from >= c.start
}

// ───────────── caret helpers ─────────────
function scrollToPos(editor: Editor, pos: number) {
  requestAnimationFrame(() => {
    try {
      const sc = document.querySelector('.canvas-scroll') as HTMLElement | null
      const co = editor.view.coordsAtPos(pos)
      if (!sc) return
      const r = sc.getBoundingClientRect()
      if (co.top < r.top + 60 || co.bottom > r.bottom - 60) sc.scrollBy({ top: co.top - r.top - r.height * 0.3, behavior: 'smooth' })
    } catch { /* view not ready */ }
  })
}

function caretAt(editor: Editor, pos: number) {
  // focus(pos) sets the selection as part of focusing, so the browser's own DOM caret
  // (e.g. on touch devices) can't pull it back to the top of the document.
  editor.commands.focus(pos, { scrollIntoView: false })
  scrollToPos(editor, pos)
}

/** End of the last textblock inside `b`. */
function endOf(b: At) {
  if (b.node.isTextblock) return b.pos + b.node.nodeSize - 1
  let end = b.pos + b.node.nodeSize - 1
  b.node.descendants((n, q) => { if (n.isTextblock) end = b.pos + 1 + q + n.nodeSize - 1 })
  return end
}
const caretEnd = (c: Ctx, b: At | undefined) => { if (b) caretAt(c.e, endOf(b)) }
/** Caret on an empty line at the end of the learner's page (adds one after a table, TOC or break). */
const caretEndLast = (c: Ctx) => {
  const last = c.top[c.top.length - 1]
  if (!last || !last.node.isTextblock && last.node.type.name !== 'bulletList' && last.node.type.name !== 'orderedList') {
    c.e.chain().insertContentAt(c.e.state.doc.content.size, { type: 'paragraph' }).run()
    caretAt(c.e, c.e.state.doc.content.size - 1)
  } else caretEnd(c, last)
}
function caretToStart(c: Ctx) {
  if (c.start < 0) return
  if (!c.top.length) c.e.chain().insertContentAt(c.start, { type: 'paragraph' }).run()
  else if (c.top.some((x) => norm(x.node.textContent) || x.node.type.name !== 'paragraph')) return
  caretAt(c.e, c.start + 1)
}
const caretFirstCell = (c: Ctx) => {
  const t = tableOf(c)
  if (t && !t.cells.some((r) => r.some((x) => norm(x)))) caretAt(c.e, t.pos + 3)
}

// ───────────── sample lock (+ restart numbering for the learner's pages) ─────────────
const lockKey = new PluginKey('training-lock')
function lockPlugin(k: number) {
  let last = 0
  return new Plugin({
    key: lockKey,
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true
      const split = splitPos(state.doc, k)
      if (split < 0) return true
      let boundary = split + 1
      let ok = true
      for (const step of tr.steps) {
        const map = step.getMap()
        map.forEach((oldStart) => { if (oldStart < boundary) ok = false })
        if (!ok) break
        boundary = map.map(boundary, 1)
      }
      if (!ok && Date.now() - last > 4000) {
        last = Date.now()
        toast(t('tr.locked'))
      }
      return ok
    },
    props: {
      // Captions, numbered headings and the table of contents start again from 1 on the learner's pages.
      decorations(state) {
        const split = splitPos(state.doc, k)
        return split < 0 ? null : DecorationSet.create(state.doc, [Decoration.node(split, split + 1, { class: 'lesson-split' })])
      },
    },
    view(view) {
      layoutStore.setLessonSplit(splitPos(view.state.doc, k))
      return {
        update: (v) => layoutStore.setLessonSplit(splitPos(v.state.doc, k)),
        destroy: () => layoutStore.setLessonSplit(null),
      }
    },
  })
}

// ───────────── steps & targets ─────────────
type Target = ({ sel: string; text?: string | string[] } | { caret: true } | { word: string } | { image: true } | { cell: [number, number] }) &
  { label?: string; when?: (e: Editor, c: Ctx) => boolean; side?: 'right' }

interface Step {
  title: string
  icon: string
  body: (mobile: boolean) => ReactNode
  /** Text to type, shown big; each line gets a ✓ as soon as it appears in the learner's page. */
  type?: string | string[]
  bullets?: boolean
  /** Cells to fill, shown as a grid with ✓ per cell. */
  grid?: string[][]
  targets?: Target[]
  done?: (c: Ctx) => boolean
  hint?: (c: Ctx) => string | null
  enter?: (c: Ctx) => void
}

/** A translated sentence with inline markup, as a paragraph of the coach. */
const P = (key: Key, params?: Record<string, string | number>) => <p>{rich(key, params)}</p>
/** Desktop / phone variant of the same instruction. */
const PM = (m: boolean, desk: Key, mob: Key, params?: Record<string, string | number>) => P(m ? mob : desk, params)
const HERE = (): Target => ({ caret: true, label: t('tr.here') })
const press = (name: string) => t('tr.press', { name })
const tab = (name: string): Target[] => [
  { sel: '.tabs .tab', text: name, label: press(name) },
  { sel: '.m-tabs .m-tab', text: name, label: press(name) },
]
const btn = (sel: string, label: string): Target => ({ sel, label })
const item = (text: string | string[], label = t('tr.pressHere')): Target => ({ sel: '.popover .menu-item', text, label, side: 'right' })
const word = (w: string): Target => ({ word: w, label: t('tr.pickWord'), when: (e) => e.state.selection.empty })
/** Current UI name of the heading style (e.g. «Επικεφαλίδα 1» / "Heading 1"). */
const hName = (level: 1 | 2) => styleName(`Heading${level}`)
const styleTargets = (level: 1 | 2): Target[] => {
  const name = hName(level)
  return [
  ...tab(t('tab.home')),
  // By position (Normal, Heading 1, Heading 2), so it keeps working whatever the UI language.
  btn(`.style-cards .style-card:nth-child(${level + 1})`, press(name)),
  btn('.m-tools > .m-drop:first-child .m-btn', t('tr.pressHere')),
  item(name, press(name)),
  ]
}
/** The Heading 1 style is pointed at once the caret sits in the typed title that isn't a heading yet. */
const h1Typed = (text: string): Target[] => [HERE(), ...styleTargets(1).map((x) => ({
  ...x,
  when: (e: Editor) => {
    const par = e.state.selection.$head.parent
    return same(par.textContent, text) && !(par.type.name === 'heading' && par.attrs.level === 1)
  },
}))]
const alignTargets = (desk: string, mobile: string): Target[] => [
  ...tab(t('tab.home')), btn(`button[title^="${desk}"]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.align')}"]`, press(t('m.align'))), item(mobile),
]
/** «Double-click / press and hold the word …» (already translated, with markup). */
const pickWord = (m: boolean, w: string) => t(m ? 'tr.pickWordMobile' : 'tr.pickWordDesktop', { word: w })
const onImage = (): Target => ({ image: true, label: t('tr.clickImage') })
const pictureTargets = (desk: Target, mobile: Target[]): Target[] => [onImage(), ...tab(t('tab.picture')), desk, ...mobile]
const tableGridTargets = (): Target[] => [
  ...tab(t('tab.insert')),
  btn(`button[title="${t('ins.tableTitle')}"]`, press(t('ins.table'))),
  btn(`.m-drop .m-btn[aria-label="${t('ins.table')}"]`, press(t('ins.table'))),
  { sel: '.tgrid-row:nth-child(3) .tgrid-cell:nth-child(2)', label: t('tr.clickHere'), side: 'right' },
  item(t('m.tableSize', { cols: 2, rows: 3 })),
]
const imageTargets = (): Target[] => [
  ...tab(t('tab.insert')),
  btn(`button[title="${t('ins.picturesTitle')}"]`, press(t('ins.pictures'))),
  btn(`.m-btn[aria-label="${t('m.picture')}"]`, press(t('m.picture'))),
  item(t('ins.trainingPicture')),
]
const imageBody = (m: boolean, where: Key) => m
  ? P('tr.imageMobile', { where: t(where), insert: t('tab.insert'), picture: t('m.picture') })
  : P('tr.imageDesktop', { where: t(where), insert: t('tab.insert'), pictures: t('ins.pictures'), training: t('ins.trainingPicture') })
const tableBody = (m: boolean) => m
  ? P('tr.tableMobile', { insert: t('tab.insert'), table: t('ins.table'), size: t('m.tableSize', { cols: 2, rows: 3 }) })
  : P('tr.tableDesktop', { insert: t('tab.insert'), table: t('ins.table'), size: t('ins.tableSize', { cols: 2, rows: 3 }) })

// ───────────── the lessons ─────────────
export interface Lesson {
  id: string
  badge: string // «1», «2», … «PRO»
  name: string
  blurb: string
  /** Illustration names shown as «what you'll learn». */
  learn: string[]
  /** Page breaks inside the sample; the next one separates sample from learner. */
  sampleBreaks: number
  pro?: boolean
  image?: ImgAttrs
  sample: JSONContent[]
  steps: Step[]
}

/**
 * Sample texts in the UI language. The same values build the sample page and check the
 * learner's page, so they always agree.
 */
const texts = () => {
  const L1 = {
    title: t('trs.title'), para: [t('trs.para1'), t('trs.para2'), t('trs.para3')], h2a: t('trs.h2a'),
    bullets: [t('trs.b1'), t('trs.b2'), t('trs.b3')], h2b: t('trs.h2b'),
    table: [[t('trs.day'), t('trs.activity')], [t('trs.mon'), t('trs.walk')], [t('trs.thu'), t('trs.market')]],
  }
  const L2 = {
    title: t('trs2.title'), date: t('trs2.date'), pre: t('trs2.pre'), under: t('trs2.under'), post: t('trs2.post'),
    sentence: t('trs2.pre') + t('trs2.under') + t('trs2.post'),
    items: [t('trs2.i1'), t('trs2.i2'), t('trs2.i3')], red: t('trs2.red'), mid: t('trs2.mid'), yellow: t('trs2.yellow'),
    last: t('trs2.red') + t('trs2.mid') + t('trs2.yellow'),
  }
  const L3 = { title: t('trs3.title'), sentence: t('trs3.sentence') }
  const L4 = { h1: t('trs4.h1'), p1: t('trs4.p1'), caption: t('trs4.caption'), h2: t('trs4.h2'), p2: t('trs4.p2') }
  const PRO = {
    set: 'modern', setName: t('set.modern'), title: t('trsp.title'), sentence: t('trsp.sentence'),
    table: [[t('trsp.item'), t('trsp.price')], [t('trsp.coffee'), t('trsp.coffeePrice')], [t('trsp.tea'), t('trsp.teaPrice')], [t('trsp.juice'), t('trsp.juicePrice')]],
    header: t('trsp.header'),
  }
  return { L1, L2, L3, L4, PRO }
}
const L3_IMG: ImgAttrs = { ...IMG, width: 170, height: 101 }
const L4_IMG: ImgAttrs = { ...IMG, width: 260, height: 154 }

const buildLessons = (): Lesson[] => {
  const { L1, L2, L3, L4, PRO } = texts()
  const l1para = L1.para.join('')
  return [
  {
    id: 'l1', badge: '1', name: t('tr1.name'), blurb: t('tr1.blurb'),
    learn: ['styles', 'bold', 'bullets', 'table', 'image'], sampleBreaks: 0,
    sample: [
      h(1, L1.title), para([tx(L1.para[0]), tx(L1.para[1], B), tx(L1.para[2])]), h(2, L1.h2a), list('bulletList', L1.bullets),
      h(2, L1.h2b), table(L1.table), para([img(IMG)]),
    ],
    steps: [
      {
        title: t('tr1.s1.title'), icon: 'alignLeft', body: () => P('tr1.s1.body'),
        type: L1.title, targets: [HERE()], done: (c) => !!findTb(c, L1.title), enter: caretToStart,
      },
      {
        title: t('tr1.s2.title'), icon: 'styles',
        body: (m) => PM(m, 'tr1.s2.desktop', 'tr1.s2.mobile', { home: t('tab.home'), style: hName(1) }),
        targets: styleTargets(1), done: (c) => !!heading(c, 1, L1.title),
        hint: (c) => (findTb(c, L1.title, (n) => n.type.name === 'heading' && n.attrs.level > 1) ? t('tr1.s2.hint', { style: hName(1) }) : null),
        enter: (c) => caretEnd(c, findTb(c, L1.title)),
      },
      {
        title: t('tr1.s3.title'), icon: 'alignLeft', body: () => P('tr1.s3.body'),
        type: l1para, targets: [HERE()], done: (c) => !!paragraph(c, l1para), enter: (c) => caretEnd(c, findTb(c, L1.title)),
      },
      {
        title: t('tr1.s4.title'), icon: 'bold',
        body: (m) => <>{P('tr1.s4.p1', { pick: pickWord(m, L1.para[1]) })}{P('tr1.s4.p2', { bold: t('font.bold') })}</>,
        targets: [...tab(t('tab.home')), btn(`button[title^="${t('font.bold')}"]`, press('B')), btn(`.m-btn[aria-label="${t('m.bold')}"]`, press(t('m.bold'))), word(L1.para[1])],
        done: (c) => marked(c, l1para, L1.para[1], bold) === 'ok',
        hint: (c) => (marked(c, l1para, L1.para[1], bold) === 'more' ? t('tr1.s4.hint', { word: L1.para[1] }) : null),
      },
      {
        title: t('tr1.s5.title'), icon: 'styles', body: (m) => PM(m, 'tr1.s5.desktop', 'tr1.s5.mobile', { style: hName(2) }),
        type: L1.h2a, targets: styleTargets(2), done: (c) => !!heading(c, 2, L1.h2a), enter: (c) => caretEnd(c, paragraph(c, l1para)),
      },
      {
        title: t('tr1.s6.title'), icon: 'bullets', body: () => P('tr1.s6.body', { bullets: t('para.bullets') }),
        targets: [...tab(t('tab.home')), btn(`.rb-split-main[title="${t('para.bullets')}"]`, press(t('para.bullets'))), btn(`.m-btn[aria-label="${t('para.bullets')}"]`, press(t('para.bullets')))],
        done: (c) => !!listItems(c, 'bulletList'), enter: (c) => caretEnd(c, heading(c, 2, L1.h2a)),
      },
      {
        title: t('tr1.s7.title'), icon: 'bullets', body: () => P('tr1.s7.body'),
        type: L1.bullets, bullets: true, targets: [HERE()], done: (c) => listIs(c, 'bulletList', L1.bullets),
      },
      {
        title: t('tr1.s8.title'), icon: 'styles', body: (m) => PM(m, 'tr1.s8.desktop', 'tr1.s8.mobile', { style: hName(2) }),
        type: L1.h2b, targets: styleTargets(2), done: (c) => !!heading(c, 2, L1.h2b),
        enter: (c) => caretEnd(c, c.top.find((x) => x.node.type.name === 'bulletList')),
      },
      {
        title: t('tr1.s9.title'), icon: 'table', body: tableBody, targets: tableGridTargets(),
        done: (c) => { const tb = tableOf(c); return !!tb && tb.rows === 3 && tb.cols === 2 },
        hint: (c) => sizeHint(c, 2, 3), enter: (c) => caretEnd(c, heading(c, 2, L1.h2b)),
      },
      {
        title: t('tr1.s10.title'), icon: 'table', body: () => P('tr1.s10.body'),
        grid: L1.table, targets: [HERE()], done: (c) => tableHas(c, L1.table) && tableOf(c)!.rows === 3, enter: caretFirstCell,
      },
      {
        title: t('tr1.s11.title'), icon: 'image', body: (m) => imageBody(m, 'tr1.s11.where'),
        targets: imageTargets(), done: (c) => !!imageOf(c), enter: caretEndLast,
      },
    ],
  },

  {
    id: 'l2', badge: '2', name: t('tr2.name'), blurb: t('tr2.blurb'),
    learn: ['alignCenter', 'justify', 'underline', 'color', 'highlight', 'numbering'], sampleBreaks: 0,
    sample: [
      h(1, L2.title, { textAlign: 'center' }),
      p(L2.date, { textAlign: 'right' }),
      para([tx(L2.pre), tx(L2.under, [{ type: 'underline' }]), tx(L2.post)], { textAlign: 'justify' }),
      list('orderedList', L2.items),
      para([tx(L2.red, [{ type: 'textStyle', attrs: { color: '#C00000' } }]), tx(L2.mid), tx(L2.yellow, [{ type: 'highlight', attrs: { color: '#ffff00' } }])], { textAlign: 'center' }),
    ],
    steps: [
      {
        title: t('tr2.s1.title'), icon: 'styles', body: () => P('tr2.s1.body', { style: hName(1) }),
        type: L2.title, targets: h1Typed(L2.title), done: (c) => !!heading(c, 1, L2.title), enter: caretToStart,
      },
      {
        title: t('tr2.s2.title'), icon: 'alignCenter',
        body: (m) => PM(m, 'tr2.s2.desktop', 'tr2.s2.mobile', { center: m ? t('m.center') : t('para.center'), align: t('m.align') }),
        targets: alignTargets(t('para.center'), t('m.center')), done: (c) => aligned(c, L2.title, 'center', isH(1)), enter: (c) => caretEnd(c, heading(c, 1, L2.title)),
      },
      {
        title: t('tr2.s3.title'), icon: 'alignRight',
        body: (m) => P('tr2.s3.body', { btn: m ? `${t('m.align')} ▸ ${t('common.right')}` : t('para.alignRight') }),
        type: L2.date, targets: alignTargets(t('para.alignRight'), t('common.right')), done: (c) => aligned(c, L2.date, 'right', isP),
        enter: (c) => caretEnd(c, heading(c, 1, L2.title)),
      },
      {
        title: t('tr2.s4.title'), icon: 'justify',
        body: (m) => P('tr2.s4.body', { btn: m ? `${t('m.align')} ▸ ${t('common.justify')}` : t('para.justify') }),
        type: L2.sentence, targets: alignTargets(t('para.justify'), t('common.justify')), done: (c) => aligned(c, L2.sentence, 'justify', isP),
        enter: (c) => caretEnd(c, paragraph(c, L2.date)),
      },
      {
        title: t('tr2.s5.title'), icon: 'underline', body: (m) => P('tr2.s5.body', { pick: pickWord(m, L2.under), underline: t('font.underline') }),
        targets: [...tab(t('tab.home')), btn(`button[title^="${t('font.underline')}"]`, press('U')), btn(`.m-btn[aria-label="${t('m.underline')}"]`, press(t('m.underline'))), word(L2.under)],
        done: (c) => marked(c, L2.sentence, L2.under, underline) === 'ok',
        hint: (c) => (marked(c, L2.sentence, L2.under, underline) === 'more' ? t('tr2.s5.hint') : null),
      },
      {
        title: t('tr2.s6.title'), icon: 'numbering', body: () => P('tr2.s6.body', { numbering: t('para.numbering') }),
        type: L2.items, bullets: true,
        targets: [...tab(t('tab.home')), btn(`.rb-split-main[title="${t('para.numbering')}"]`, press(t('para.numbering'))), btn(`.m-btn[aria-label="${t('para.numbering')}"]`, press(t('para.numbering')))],
        done: (c) => listIs(c, 'orderedList', L2.items), enter: (c) => caretEnd(c, paragraph(c, L2.sentence)),
      },
      {
        title: t('tr2.s7.title'), icon: 'alignCenter',
        body: (m) => PM(m, 'tr2.s7.desktop', 'tr2.s7.mobile', { how: `${t('m.align')} ▸ ${t('m.center')}` }),
        type: L2.last, targets: alignTargets(t('para.center'), t('m.center')), done: (c) => aligned(c, L2.last, 'center', isP),
        enter: (c) => caretEnd(c, c.top.find((x) => x.node.type.name === 'orderedList')),
      },
      {
        title: t('tr2.s8.title'), icon: 'color',
        body: (m) => PM(m, 'tr2.s8.desktop', 'tr2.s8.mobile', { pick: pickWord(m, L2.red), color: t('m.color') }),
        targets: [...tab(t('tab.home')), btn(`.rb-split-main[title="${t('font.color')}"]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.color')}"]`, press(t('m.color'))),
          { sel: '.m-pop .swatch[title="#C00000"]', label: t('tr2.s8.red'), side: 'right' }, word(L2.red)],
        done: (c) => marked(c, L2.last, L2.red, colored) === 'ok',
        hint: (c) => (marked(c, L2.last, L2.red, colored) === 'more' ? t('tr2.s8.hint') : null),
      },
      {
        title: t('tr2.s9.title'), icon: 'highlight',
        body: (m) => PM(m, 'tr2.s9.desktop', 'tr2.s9.mobile', { pick: pickWord(m, L2.yellow), highlight: t('m.highlight') }),
        targets: [...tab(t('tab.home')), btn(`.rb-split-main[title="${t('font.highlight')}"]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.highlight')}"]`, press(t('m.highlight'))),
          { sel: `.m-pop .swatch[title="${t('hl.yellow')}"]`, label: t('tr2.s9.yellow'), side: 'right' }, word(L2.yellow)],
        done: (c) => marked(c, L2.last, L2.yellow, highlighted) === 'ok',
        hint: (c) => (marked(c, L2.last, L2.yellow, highlighted) === 'more' ? t('tr2.s9.hint') : null),
      },
    ],
  },

  {
    id: 'l3', badge: '3', name: t('tr3.name'), blurb: t('tr3.blurb'),
    learn: ['image', 'wrapSquare', 'shape', 'shadow'], sampleBreaks: 0, image: L3_IMG,
    sample: [
      h(1, L3.title),
      para([img({ ...L3_IMG, wrap: 'square', align: 'right', shape: 'circle', shadow: 'medium' }), tx(L3.sentence)]),
    ],
    steps: [
      {
        title: t('tr3.s1.title'), icon: 'styles', body: () => P('tr3.s1.body', { style: hName(1) }),
        type: [L3.title, L3.sentence], targets: h1Typed(L3.title), done: (c) => !!heading(c, 1, L3.title) && !!paragraph(c, L3.sentence), enter: caretToStart,
      },
      {
        title: t('tr3.s2.title'), icon: 'image', body: (m) => imageBody(m, 'tr3.s2.where'),
        targets: imageTargets(), done: (c) => !!imageOf(c),
        enter: (c) => { const b = paragraph(c, L3.sentence); if (b) caretAt(c.e, b.pos + 1) },
      },
      {
        title: t('tr3.s3.title'), icon: 'image', body: () => P('tr3.s3.body', { tab: t('tab.picture') }),
        targets: [onImage()], done: (c) => imageSelected(c) || imgAttr(c, 'wrap') === 'square',
      },
      {
        title: t('tr3.s4.title'), icon: 'wrapSquare', body: () => P('tr3.s4.body', { tab: t('tab.picture'), square: t('wrap.square') }),
        targets: pictureTargets(btn(`.wrap-card[title="${t('wrap.squareTitle')}"]`, press(t('wrap.square'))), [btn(`.m-btn[aria-label="${t('wrap.square')}"]`, press(t('wrap.square')))]),
        done: (c) => imgAttr(c, 'wrap') === 'square',
      },
      {
        title: t('tr3.s5.title'), icon: 'shape',
        body: (m) => PM(m, 'tr3.s5.desktop', 'tr3.s5.mobile', { group: t('g.cropShape'), shape: t('m.shape'), circle: t('shape.circle') }),
        targets: pictureTargets(btn(`.pic-cell[title="${t('shape.circle')}"]`, t('tr3.s5.label')), [btn(`.m-btn[aria-label="${t('m.shape')}"]`, press(t('m.shape'))), item(t('shape.circle'))]),
        done: (c) => imgAttr(c, 'shape') === 'circle',
      },
      {
        title: t('tr3.s6.title'), icon: 'shadow',
        body: (m) => PM(m, 'tr3.s6.desktop', 'tr3.s6.mobile', { group: t('g.shadow'), medium: t('shadow.medium') }),
        targets: pictureTargets(btn(`.pic-cell[title="${t('pic.shadowTitle', { name: t('shadow.medium') })}"]`, t('tr.pressHere')), [btn(`.m-btn[aria-label="${t('g.shadow')}"]`, press(t('g.shadow'))), item(t('shadow.medium'))]),
        done: (c) => !!imgAttr(c, 'shadow') && imgAttr(c, 'shadow') !== 'none',
      },
      {
        title: t('tr3.s7.title'), icon: 'alignRight',
        body: (m) => PM(m, 'tr3.s7.desktop', 'tr3.s7.mobile', { group: t('g.position'), right: t('common.right') }),
        targets: pictureTargets(btn(`.rb-btn[title="${t('common.right')}"]`, press(t('common.right'))), [btn(`.m-btn[aria-label="${t('g.position')}"]`, press(t('g.position'))), item(t('common.right'))]),
        done: (c) => imgAttr(c, 'align') === 'right' && imgAttr(c, 'wrap') === 'square',
      },
    ],
  },

  {
    id: 'l4', badge: '4', name: t('tr4.name'), blurb: t('tr4.blurb'),
    learn: ['toc', 'captionImage', 'pageBreak', 'headingNumbers', 'pageNumber'], sampleBreaks: 1, image: L4_IMG,
    sample: [
      { type: 'tableOfContents', attrs: { maxLevel: 2 } },
      h(1, L4.h1), p(L4.p1), para([img(L4_IMG)]), p(L4.caption, { styleId: 'Caption', captionKind: 'figure' }),
      PB,
      h(1, L4.h2), p(L4.p2),
    ],
    steps: [
      {
        title: t('tr4.s1.title'), icon: 'toc',
        body: (m) => PM(m, 'tr4.s1.desktop', 'tr4.s1.mobile', { refs: t('tab.references'), toc: m ? t('m.toc') : t('refs.toc'), auto: t('refs.tocAuto', { n: 2 }) }),
        targets: [...tab(t('tab.references')), btn(`button[title="${t('refs.tocTitle')}"]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.toc')}"]`, press(t('m.toc'))), item(t('refs.tocAuto', { n: 2 }))],
        done: (c) => c.top.some((x) => x.node.type.name === 'tableOfContents'), enter: caretToStart,
      },
      {
        title: t('tr4.s2.title'), icon: 'styles', body: () => P('tr4.s2.body', { style: hName(1) }),
        type: [L4.h1, L4.p1], targets: h1Typed(L4.h1), done: (c) => !!heading(c, 1, L4.h1) && !!paragraph(c, L4.p1), enter: caretEndLast,
      },
      {
        title: t('tr4.s3.title'), icon: 'image', body: (m) => imageBody(m, 'tr4.s3.where'),
        targets: imageTargets(), done: (c) => !!imageOf(c), enter: (c) => caretEnd(c, paragraph(c, L4.p1)),
      },
      {
        title: t('tr4.s4.title'), icon: 'captionImage',
        body: (m) => P('tr4.s4.body', { refs: t('tab.references'), cap: m ? t('m.capFig') : t('refs.capFig'), fig: t('caption.figure') }),
        type: L4.caption, targets: [...tab(t('tab.references')), btn(`button[title="${t('refs.capFigTitle')}"]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.capFig')}"]`, t('tr.pressHere'))],
        done: (c) => !!findTb(c, L4.caption, (n) => n.attrs.captionKind === 'figure'),
        hint: (c) => (paragraph(c, L4.caption) && !findTb(c, L4.caption, (n) => n.attrs.captionKind === 'figure') ? t('tr4.s4.hint', { cap: t('refs.capFig') }) : null),
        enter: (c) => { const i = imageOf(c); if (i) caretAt(c.e, i.pos + 1) },
      },
      {
        title: t('tr4.s5.title'), icon: 'pageBreak',
        body: (m) => P('tr4.s5.body', { insert: t('tab.insert'), pb: m ? t('m.pageBreak') : t('ins.pageBreak') }),
        targets: [...tab(t('tab.insert')), btn(`.ribbon button[title^="${t('ins.pageBreak')} ("]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.pageBreak')}"]`, t('tr.pressHere'))],
        done: (c) => c.top.some((x) => x.node.type.name === 'pageBreak'),
        enter: (c) => caretEnd(c, findTb(c, L4.caption) || c.top[c.top.length - 1]),
      },
      {
        title: t('tr4.s6.title'), icon: 'styles', body: () => P('tr4.s6.body', { style: hName(1) }),
        type: [L4.h2, L4.p2], targets: h1Typed(L4.h2),
        done: (c) => {
          const br = c.top.find((x) => x.node.type.name === 'pageBreak')
          const hh = heading(c, 1, L4.h2)
          return !!br && !!hh && hh.pos > br.pos && !!paragraph(c, L4.p2)
        },
        enter: caretEndLast,
      },
      {
        title: t('tr4.s7.title'), icon: 'headingNumbers',
        body: (m) => P('tr4.s7.body', { refs: t('tab.references'), btn: m ? t('m.headingNumbers') : t('refs.headingNumbers') }),
        targets: [...tab(t('tab.references')), btn(`button[title="${t('refs.headingNumbersTitle')}"]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.headingNumbers')}"]`, t('tr.pressHere'))],
        done: (c) => c.s.headingNumbers,
      },
      {
        title: t('tr4.s8.title'), icon: 'pageNumber',
        body: (m) => P('tr4.s8.body', { insert: t('tab.insert'), pn: m ? t('m.pageNumber') : t('ins.pageNumber'), xofy: t('pn.xOfY') }),
        targets: [...tab(t('tab.insert')), btn(`button[title="${t('ins.pageNumber')}"]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.pageNumber')}"]`, t('tr.pressHere')), item(t('pn.xOfY'))],
        done: (c) => c.s.hf.footerText.includes('{page}'),
      },
    ],
  },

  {
    id: 'pro', badge: 'PRO', name: t('trp.name'), blurb: t('trp.blurb'),
    learn: ['styleSets', 'lineSpacing', 'shading', 'rowBelow', 'header'], sampleBreaks: 0, pro: true,
    sample: [h(1, PRO.title), p(PRO.sentence, { lineHeight: '1.5' }), table(PRO.table, '#D3F6F4')],
    steps: [
      {
        title: t('trp.s1.title'), icon: 'styleSets',
        body: (m) => PM(m, 'trp.s1.desktop', 'trp.s1.mobile', { tab: m ? t('tab.layout') : t('tab.design'), sets: t('m.styleSets'), set: PRO.setName }),
        targets: [...tab(t('tab.design')), { sel: '.m-tabs .m-tab', text: t('tab.layout'), label: press(t('tab.layout')) }, btn(`.set-card[title="${t('set.modern')}"]`, press(t('set.modern'))),
          btn(`.m-btn[aria-label="${t('m.styleSets')}"]`, press(t('m.styleSets'))), item(t('set.modern'))],
        done: (c) => c.s.styleSet === PRO.set,
      },
      {
        title: t('trp.s2.title'), icon: 'styles', body: () => P('trp.s2.body', { style: hName(1) }),
        type: [PRO.title, PRO.sentence], targets: h1Typed(PRO.title),
        done: (c) => !!heading(c, 1, PRO.title) && !!paragraph(c, PRO.sentence), enter: caretToStart,
      },
      {
        title: t('trp.s3.title'), icon: 'lineSpacing',
        body: (m) => P('trp.s3.body', { spacing: m ? t('dlg.lineSpacing') : t('para.spacing'), home: t('tab.home'), v: numText(1.5) }),
        targets: [...tab(t('tab.home')), btn(`button[title="${t('para.spacing')}"]`, press(t('para.spacing'))), btn(`.m-btn[aria-label="${t('dlg.lineSpacing')}"]`, press(t('dlg.lineSpacing'))), item(['1,5', '1.5'])],
        done: (c) => String(paragraph(c, PRO.sentence)?.node.attrs.lineHeight) === '1.5', enter: (c) => caretEnd(c, paragraph(c, PRO.sentence)),
      },
      {
        title: t('trp.s4.title'), icon: 'table', body: tableBody, targets: tableGridTargets(),
        done: (c) => { const tb = tableOf(c); return !!tb && tb.cols === 2 && tb.rows >= 3 }, hint: (c) => sizeHint(c, 2, 3),
        enter: (c) => caretEnd(c, paragraph(c, PRO.sentence)),
      },
      {
        title: t('trp.s5.title'), icon: 'table', body: () => P('trp.s5.body'),
        grid: PRO.table.slice(0, 3), targets: [HERE()], done: (c) => tableHas(c, PRO.table.slice(0, 3)), enter: caretFirstCell,
      },
      {
        title: t('trp.s6.title'), icon: 'rowBelow',
        body: (m) => P('trp.s6.body', { tab: t('tab.table'), btn: m ? t('m.addRow') : t('tbl.below') }),
        grid: PRO.table, targets: [HERE(), ...[...tab(t('tab.table')), btn(`button[title="${t('tbl.belowTitle')}"]`, t('tr.pressHere')), btn(`.m-btn[aria-label="${t('m.addRow')}"]`, t('tr.pressHere'))]
          .map((x) => ({ ...x, when: (_e: Editor, c: Ctx) => (tableOf(c)?.node.childCount ?? 0) < 4 })),
          { cell: [3, 0], label: t('trp.s6.label') }],
        done: (c) => tableHas(c, PRO.table),
        enter: (c) => { const tb = tableOf(c); if (tb && tb.node.childCount === 3) caretEnd(c, { node: tb.node, pos: tb.pos }) },
      },
      {
        title: t('trp.s7.title'), icon: 'shading',
        body: () => P('trp.s7.body', { a: PRO.table[0][0], b: PRO.table[0][1], tab: t('tab.table'), shading: t('tbl.shading') }),
        targets: [...tab(t('tab.table')), btn(`button[title="${t('tbl.shadingTitle')}"]`, press(t('tbl.shading'))), btn(`.m-btn[aria-label="${t('tbl.shading')}"]`, press(t('tbl.shading'))),
          { sel: '.popover .swatch[title="#cfe4e2"]', label: t('trp.s7.label'), side: 'right' }],
        done: (c) => { const tb = tableOf(c); return !!tb && tb.shade[0]?.length === 2 && tb.shade[0].every(Boolean) },
        hint: (c) => { const tb = tableOf(c); return tb && tb.shade[0]?.some(Boolean) && !tb.shade[0].every(Boolean) ? t('trp.s7.hint', { shading: t('tbl.shading') }) : null },
        enter: (c) => { const tb = tableOf(c); if (tb && !tb.shade[0]?.some(Boolean)) caretAt(c.e, tb.pos + 3) },
      },
      {
        title: t('trp.s8.title'), icon: 'header',
        body: (m) => P('trp.s8.body', { insert: t('tab.insert'), btn: m ? `${t('m.pageNumber')} ▸ ${t('m.headerFooter')}` : t('ins.header'), header: t('dlg.header') }),
        type: PRO.header,
        targets: [...tab(t('tab.insert')), btn(`button[title="${t('ins.headerFooter')}"]`, press(t('ins.header'))), btn(`.m-btn[aria-label="${t('m.pageNumber')}"]`, t('tr.pressHere')), item(t('m.headerFooter')),
          { sel: '.modal input', label: t('tr.here'), side: 'right' },
          { sel: '.modal .btn.primary', label: press(t('common.ok')), when: () => same((document.querySelector('.modal input') as HTMLInputElement | null)?.value || '', PRO.header) }],
        done: (c) => same(c.s.hf.headerText, PRO.header),
      },
    ],
  },
  ]
}

/** Rebuilt when the UI language changes, so every pointer follows the translated labels. */
export let LESSONS: Lesson[] = buildLessons()
onLangChange(() => { LESSONS = buildLessons() })

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id) || LESSONS[0]
/** Number of sample pages before the learner's page. */
export const samplePages = (id: string) => lessonById(id).sampleBreaks + 1
export function lessonDoc(id: string): JSONContent {
  return { type: 'doc', content: [...lessonById(id).sample, PB, para()] }
}
/** «Level 2» / «PRO» */
export const levelLabel = (l: Lesson) => (l.pro ? 'PRO' : t('tr.level', { badge: l.badge }))

// ───────────── points & ranks (simple and encouraging) ─────────────
const STORE = 'grafi:training:v1'
export type Progress = Record<string, { points: number }>
export function loadProgress(): Progress {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {} } catch { return {} }
}
function saveResult(id: string, points: number) {
  const p = loadProgress()
  p[id] = { points: Math.max(p[id]?.points || 0, points) }
  try { localStorage.setItem(STORE, JSON.stringify(p)) } catch { /* private mode */ }
  return p
}
/** Every correct step earns its full points; finishing a level adds a bonus. */
export const stepPoints = (l: Lesson) => (l.pro ? 20 : 10)
export const LEVEL_BONUS = 50
export const levelPoints = (l: Lesson) => l.steps.length * stepPoints(l) + LEVEL_BONUS
export const totalPoints = (p: Progress) => LESSONS.reduce((a, l) => a + (p[l.id]?.points || 0), 0)
export const isUnlocked = (p: Progress, i: number) => i === 0 || !!p[LESSONS[i - 1].id]
/** Rank name after `n` finished levels (0 = beginner … 5 = Graphi Master). */
export const rankName = (n: number) => t(`tr.rank${Math.min(5, Math.max(0, n))}` as Key)
export const rankOf = (p: Progress) => rankName(LESSONS.filter((l) => p[l.id]).length)

export const Stars = ({ n, size = 18 }: { n: number; size?: number }) => (
  <span className="tr-stars" style={{ fontSize: size }} aria-label={t('tr.stars', { n })}>
    {[1, 2, 3].map((i) => <span key={i} className={i <= n ? 'on' : ''}>★</span>)}
  </span>
)

// ───────────── spotlight ─────────────
type Hit = { rect: DOMRect; label: string; side?: 'right' }

function findTarget(c: Ctx, targets: Target[]): Hit | null {
  const editor = c.e
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i]
    if (t.when && !t.when(editor, c)) continue
    try {
      if ('word' in t) {
        const b = tbs(c).find((x) => x.node.textContent.includes(t.word))
        if (!b) continue
        const from = b.pos + 1 + b.node.textContent.indexOf(t.word)
        const a = editor.view.coordsAtPos(from), z = editor.view.coordsAtPos(from + t.word.length)
        return { rect: new DOMRect(a.left, a.top, Math.max(8, z.left - a.left), a.bottom - a.top), label: t.label || '' }
      }
      if ('image' in t) {
        const im = imageOf(c)
        const dom = im && (editor.view.nodeDOM(im.pos) as HTMLElement | null)
        if (!dom || imageSelected(c)) continue
        return { rect: dom.getBoundingClientRect(), label: t.label || '' }
      }
      if ('cell' in t) {
        // An empty cell of the learner's table the caret isn't in yet.
        const tb = tableOf(c)
        if (!tb || norm(tb.cells[t.cell[0]]?.[t.cell[1]] ?? 'x')) continue
        let cellPos = -1
        tb.node.forEach((row, ro, r) => row.forEach((_cell, co, k) => { if (r === t.cell[0] && k === t.cell[1]) cellPos = tb.pos + 1 + ro + 1 + co }))
        if (cellPos < 0) continue
        const $h = editor.state.selection.$head
        if ($h.pos > cellPos && $h.pos < cellPos + tb.node.child(t.cell[0]).child(t.cell[1]).nodeSize) continue
        const dom = editor.view.nodeDOM(cellPos) as HTMLElement | null
        if (!dom) continue
        return { rect: dom.getBoundingClientRect(), label: t.label || '' }
      }
      if ('caret' in t) {
        if (!editor.view.hasFocus()) continue
        const co = editor.view.coordsAtPos(editor.state.selection.head)
        return { rect: new DOMRect(co.left - 6, co.top - 4, 12, co.bottom - co.top + 8), label: t.label || '' }
      }
    } catch { continue }
    if (!('sel' in t)) continue
    const els = [...document.querySelectorAll<HTMLElement>(t.sel)]
    const texts = t.text == null ? null : Array.isArray(t.text) ? t.text : [t.text]
    const el = els.find((x) => (!texts || texts.some((tx) => x.textContent?.trim().startsWith(tx))) && x.getClientRects().length)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.bottom < 0 || r.top > window.innerHeight) continue
    return { rect: r, label: t.label || '', side: t.side }
  }
  return null
}

function Spotlight({ ctx, targets }: { ctx: () => Ctx; targets: Target[] }) {
  const [hit, setHit] = useState<Hit | null>(null)
  useEffect(() => {
    let t = 0
    const tick = () => {
      setHit((prev) => {
        const h = findTarget(ctx(), targets)
        if (prev && h && prev.label === h.label && prev.side === h.side && Math.abs(prev.rect.left - h.rect.left) < 0.5 && Math.abs(prev.rect.top - h.rect.top) < 0.5 && prev.rect.width === h.rect.width) return prev
        return h
      })
      t = window.setTimeout(tick, 150)
    }
    tick()
    return () => clearTimeout(t)
  }, [ctx, targets])
  if (!hit) return null
  const pad = 5
  const { rect: r } = hit
  const below = r.top < window.innerHeight * 0.6
  return (
    <div className="tr-spot-layer" aria-hidden>
      <div className="tr-spot" style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }} />
      {hit.label && hit.side === 'right' && (
        <div className="tr-bubble right" style={{ left: r.right + pad + 12, top: r.top + r.height / 2 }}>◀ {hit.label}</div>
      )}
      {hit.label && !hit.side && (
        <div className={`tr-bubble ${below ? 'below' : 'above'}`}
          style={{ left: Math.min(window.innerWidth - 120, Math.max(120, r.left + r.width / 2)), top: below ? r.bottom + pad + 12 : r.top - pad - 12 }}>
          {below ? '▲ ' : ''}{hit.label}{below ? '' : ' ▼'}
        </div>
      )}
    </div>
  )
}

// ───────────── coach panel ─────────────
export function TrainingCoach({ api, lessonId, hidden, onClose }: { api: AppApi; lessonId: string; hidden: boolean; onClose: () => void }) {
  const { editor } = api
  const lesson = lessonById(lessonId)
  const next = LESSONS[LESSONS.indexOf(lesson) + 1]
  const k = lesson.sampleBreaks
  const steps = lesson.steps
  const pts = stepPoints(lesson)
  // step -1 = the level's welcome card
  const [step, setStep] = useState(-1)
  const [cheer, setCheer] = useState(false)
  const [small, setSmall] = useState(false)
  const [finished, setFinished] = useState(false)
  const [earned, setEarned] = useState<Set<number>>(() => new Set())
  const [result, setResult] = useState<{ points: number; total: number; master: boolean } | null>(null)
  const mobile = window.matchMedia('(max-width: 820px)').matches

  const settingsRef = useRef(api.settings)
  settingsRef.current = api.settings
  const getCtx = useMemo(() => () => makeCtx(editor, settingsRef.current, k), [editor, k])
  const c = useMemo(() => makeCtx(editor, api.settings, k), [editor, editor.state.doc, editor.state.selection, api.settings, k])
  const s = step >= 0 ? steps[step] : null
  const done = !!s?.done?.(c)
  const missing = steps.map((st, i) => (st.done && !st.done(c) ? i : -1)).filter((i) => i >= 0)
  const hint = step < 0 ? null : c.start < 0 ? t('tr.breakGone') : s?.hint?.(c) ?? null
  const score = earned.size * pts

  useEffect(() => { activeImage = lesson.image || IMG; return () => { activeImage = IMG } }, [lesson])

  // Lock the sample page(s) while the lesson runs.
  useEffect(() => {
    editor.registerPlugin(lockPlugin(k))
    return () => { editor.unregisterPlugin(lockKey) }
  }, [editor, k])

  // Each step places the caret where the learner should continue.
  useEffect(() => {
    if (step < 0) return
    const t = setTimeout(() => { const cx = getCtx(); if (!steps[step].done?.(cx)) steps[step].enter?.(cx) }, step === 0 ? 350 : 60)
    return () => clearTimeout(t)
  }, [step, getCtx, steps])

  const award = (...is: number[]) => setEarned((e) => new Set([...e, ...is]))

  // Done → praise (+points) → next unfinished step, or the final check.
  useEffect(() => {
    if (done && !cheer && !finished) { award(step); setCheer(true) }
  }, [done, cheer, finished, step])
  useEffect(() => {
    if (!cheer) return
    const t = setTimeout(() => {
      setCheer(false)
      const cx = getCtx()
      // Steps done ahead of time earn their points too.
      award(...steps.map((st, i) => (i > step && st.done?.(cx) ? i : -1)).filter((i) => i >= 0))
      const n = steps.findIndex((st, i) => i > step && !st.done?.(cx))
      if (n < 0) setFinished(true)
      else setStep(n)
    }, 1500)
    return () => clearTimeout(t)
  }, [cheer, step])

  // All steps still correct at the end → level complete: full points, three stars.
  useEffect(() => {
    if (!finished || missing.length || result) return
    const points = levelPoints(lesson)
    const p = saveResult(lesson.id, points)
    setResult({ points, total: totalPoints(p), master: !next })
  }, [finished, missing.length, result])

  const goStep = (i: number) => { setFinished(false); setCheer(false); setStep(i) }
  const showSample = () => (document.querySelector('.canvas-scroll') as HTMLElement | null)?.scrollTo({ top: 0, behavior: 'smooth' })
  const backToMine = () => {
    const cx = getCtx()
    const head = editor.state.selection.head
    if (editor.view.hasFocus() && head > cx.start) caretAt(editor, head)
    else caretEndLast(cx)
  }
  const restart = (id: string) => { onClose(); setTimeout(() => api.startTraining(id), 0) }

  if (hidden) return null

  if (result) {
    return (
      <div className="tr-success-backdrop" role="dialog" aria-label={t('tr.success')}>
        <div className="tr-confetti" aria-hidden>{Array.from({ length: result.master ? 60 : 36 }, (_, i) => <i key={i} style={{ left: `${(i * 97) % 100}%`, animationDelay: `${(i % 9) * 0.18}s`, background: ['#1AB3AC', '#FDE047', '#EC4899', '#3B82F6', '#22C55E', '#F59E0B'][i % 6] }} />)}</div>
        {result.master ? (
          <div className="tr-success master">
            <div className="tr-medal">👑</div>
            <div className="tr-kicker">{t('tr.masterKicker')}</div>
            <h2>{t('tr.masterTitle')}</h2>
            <p>{rich('tr.masterP1')}</p>
            <p className="tr-learned">{t('tr.masterP2')}</p>
            <div className="tr-score-row">
              <Stars n={3} size={30} />
              <span className="tr-score-big">{fmtInt(result.total)}<small>{t('tr.pointsTotal')}</small></span>
            </div>
            <div className="tr-actions">
              <button className="tr-btn primary" onClick={onClose}>{t('tr.closeGreat')}</button>
              <button className="tr-btn" onClick={() => { onClose(); setTimeout(() => api.openBackstage('training'), 0) }}>{t('tr.allLevels')}</button>
            </div>
          </div>
        ) : (
          <div className="tr-success">
            <div className="tr-medal">🏆</div>
            <div className="tr-kicker">{t('tr.levelKicker', { badge: lesson.badge, name: lesson.name })}</div>
            <h2>{t('tr.congrats')}</h2>
            <p>{rich('tr.didIt')}</p>
            <div className="tr-score-row">
              <Stars n={3} size={34} />
              <span className="tr-score-big">+{fmtInt(result.points)}<small>{t('tr.points')}</small></span>
            </div>
            <p className="tr-learned">{rich('tr.bonusLine', { bonus: LEVEL_BONUS, total: result.total })}</p>
            <div className="tr-actions">
              {next && <button className="tr-btn primary" onClick={() => restart(next.id)}>{next.pro ? t('tr.goPro') : t('tr.nextLevel', { badge: next.badge })}</button>}
              <button className="tr-btn" onClick={() => restart(lesson.id)}>{t('tr.again')}</button>
              <button className="tr-btn" onClick={onClose}>{t('common.close')}</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (small) {
    return (
      <button className="tr-pill" onClick={() => setSmall(false)}>
        <Ill name={s?.icon || lesson.learn[0]} size={22} /> {t('tr.pill', { where: step >= 0 ? t('tr.step', { step: step + 1, total: steps.length }) : levelLabel(lesson), score })}
      </button>
    )
  }

  const typeLines = s?.type ? (Array.isArray(s.type) ? s.type : [s.type]) : []
  const grid = s?.grid ? tableOf(c) : null
  return (
    <>
      {s && !cheer && !finished && s.targets && <Spotlight ctx={getCtx} targets={s.targets} />}
      <aside className="tr-coach" role="complementary" aria-label={t('tr.coach')}>
        <div className="tr-head">
          <span className={`tr-level${lesson.pro ? ' pro' : ''}`}>{levelLabel(lesson)}</span>
          <span className="tr-count">{step >= 0 ? t('tr.step', { step: step + 1, total: steps.length }) : ''}</span>
          <button className="tr-mini" onClick={() => setSmall(true)} title={t('tr.minimize')}>—</button>
          <button className="tr-mini" onClick={onClose} title={t('tr.end')}>✕</button>
        </div>
        <div className="tr-progress"><i style={{ width: `${(earned.size / steps.length) * 100}%` }} /></div>

        {step < 0 ? (
          <div className="tr-body">
            <h3><Ill name={lesson.learn[0]} size={28} /> {lesson.pro ? t('tr.proWelcome') : lesson.name}</h3>
            <p>{lesson.sampleBreaks ? rich('tr.welcomeMany', { last: lesson.sampleBreaks + 1, n: steps.length }) : rich('tr.welcomeOne', { n: steps.length })}</p>
            <div className="tr-learn">{lesson.learn.map((ic) => <Ill key={ic} name={ic} size={32} />)}</div>
            <p className="tr-rules">{rich('tr.rules', { pts, bonus: LEVEL_BONUS })}</p>
          </div>
        ) : finished ? (
          <div className="tr-body">
            <h3>{t('tr.almost')}</h3>
            <p>{t('tr.missing')}</p>
            <div className="tr-missing">
              {missing.map((i) => <button key={i} className="tr-btn" onClick={() => goStep(i)}>{steps[i].title}</button>)}
            </div>
          </div>
        ) : cheer ? (
          <div className="tr-body tr-cheer">
            <div className="tr-check">✓</div>
            <h3>{t('tr.bravo')}</h3>
            <div className="tr-plus">{t('tr.plusPoints', { n: pts })}</div>
            <p>{step === steps.length - 1 ? t('tr.checking') : t('tr.nextOne')}</p>
          </div>
        ) : s && (
          <div className="tr-body">
            <h3><Ill name={s.icon} size={28} /> {s.title}</h3>
            {s.body(mobile)}
            {typeLines.length > 0 && (
              <div className="tr-type">
                {typeLines.map((line) => {
                  const ok = !!findTb(c, line)
                  return <div key={line} className={ok ? 'ok' : ''}>{s.bullets ? '• ' : ''}{line}{ok && <span className="tr-tick">✓</span>}</div>
                })}
              </div>
            )}
            {s.grid && (
              <table className="tr-table">
                <tbody>
                  {s.grid.map((r, i) => (
                    <tr key={i}>{r.map((cell, j) => {
                      const ok = !!grid && same(grid.cells[i]?.[j] ?? '', cell)
                      return <td key={j} className={ok ? 'ok' : ''}>{cell}{ok && <span className="tr-tick">✓</span>}</td>
                    })}</tr>
                  ))}
                </tbody>
              </table>
            )}
            {hint && <p className="tr-hint">💡 {hint}</p>}
          </div>
        )}

        <div className="tr-foot">
          {step > 0 && !cheer && <button className="tr-btn" onClick={() => goStep(step - 1)}>{t('tr.back')}</button>}
          {step < 0 && <button className="tr-btn primary big" onClick={() => setStep(0)}>{t('tr.go')}</button>}
          {step >= 0 && !cheer && !finished && (
            <span className="tr-nav">
              <button className="tr-link" onClick={showSample}>{t('tr.seeSample')}</button>
              <button className="tr-link" onClick={backToMine}>{t('tr.backToMine')}</button>
            </span>
          )}
        </div>
      </aside>
    </>
  )
}
