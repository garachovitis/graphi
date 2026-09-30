// ───────────────────────────────────────────────────────────────────────────
// Pagination engine (Print Layout).
//
// The document is edited as one continuous column whose width equals the page's
// text width. Page "sheets" are drawn behind it. After every layout-affecting change
// we measure the natural (un-paginated) geometry of every line and block, then run
// a page-breaking pass that inserts invisible spacer widgets so that no line
// straddles a page's bottom margin:
//
//   • textblocks are split between lines (Word-style), honouring widow/orphan
//     control (never leave a single first or last line of a paragraph alone);
//   • headings / "keep with next" paragraphs move to the next page when the block
//     that follows would not start on the same page;
//   • atomic blocks (tables, rules, TOC) move as a whole when they fit on a page;
//   • a square-wrapped picture stays on the page of the line it is anchored on (it may hang
//     over the following paragraphs, which wrap around it — so it is measured on its own);
//   • hard page breaks and "page break before" force the next block to a new page.
//
// Spacers are decorations, never document content, so the model stays clean and
// DOCX/ODT export is unaffected. In print, each spacer becomes a forced page break,
// so the printed/PDF pagination is identical to what is shown on screen.
// ───────────────────────────────────────────────────────────────────────────
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { layoutStore } from './layoutStore'

export interface PaginationConfig {
  enabled: boolean
  /** page pitch = page height + visual gap between sheets (px) */
  pitch: number
  /** usable text height per page (px) */
  contentHeight: number
  /** CSS transform scale of the page stack (zoom). Supplied by the app: deriving it from
   *  integer-rounded offsetHeight drifts by up to 1px at the end of very long documents. */
  scale?: number
}

export const paginationConfig: PaginationConfig = { enabled: true, pitch: 1123 + 24, contentHeight: 931 }

export const paginationKey = new PluginKey<DecorationSet>('pagination')

/** Each editor's "lay out now" (see relayoutNow). */
const runners = new WeakMap<EditorView, () => void>()

/**
 * `top` marks a block that was moved whole to a new page: in print the forced break
 * propagates to the block's start (CSS Fragmentation), so its space-before must be
 * suppressed there — exactly what Word does for a paragraph at the top of a page.
 */
interface Spacer {
  pos: number
  height: number
  block: boolean
  /** Column y (px) where the content it pushes must start: the top of a page's text area. */
  target: number
  top?: { from: number; to: number }
  pad?: boolean
  padBase?: number
  side?: 'odd' | 'even'
}

const CONTAINERS = new Set(['bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote'])
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])
const TOL = 0.75 // px tolerance against sub-pixel rounding
/** Chromium lays out in 1/64 px units; quantizing spacer heights keeps predictions exact over hundreds of pages. */
const q = (h: number) => Math.round(h * 64) / 64

function makeSpacerDom(s: Spacer) {
  const el = document.createElement(s.block ? 'div' : 'span')
  el.className = (s.block ? 'pg-spacer pg-spacer-block' : 'pg-spacer') + (s.side ? ` pg-${s.side}` : '')
  el.style.height = `${s.height}px`
  el.dataset.pgPos = String(s.pos)
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-hidden', 'true')
  return el
}

function buildDecorations(doc: PMNode, spacers: Spacer[]) {
  const decos: Decoration[] = []
  for (const s of spacers) {
    // A textblock moved whole to the next page is pushed down with padding instead of an
    // inline spacer: the caret then can't sit in the gap between the sheets (it would be
    // placed before a spacer widget), and a heading's section number (::before) moves with it.
    if (s.pad && s.top) {
      decos.push(Decoration.node(s.top.from, s.top.to, { class: `pg-top pg-pad${s.side ? ` pg-${s.side}` : ''}`, style: `padding-top:${s.height + (s.padBase || 0)}px;--pg-base:${s.padBase || 0}px` }))
      continue
    }
    decos.push(Decoration.widget(s.pos, () => makeSpacerDom(s), {
      side: -1,
      key: `pg-${s.pos}-${Math.round(s.height)}-${s.block ? 'b' : 'i'}${s.side || ''}`,
      ignoreSelection: true,
      marks: [],
    }))
    if (s.top) decos.push(Decoration.node(s.top.from, s.top.to, { class: 'pg-top' }))
  }
  return DecorationSet.create(doc, decos)
}

// ───────────── measurement helpers ─────────────
interface Frame { originTop: number; scale: number }

interface Line {
  t: number
  b: number
  /** A top-and-bottom picture's band, not a line of text (widow / orphan control ignores it). */
  pic?: boolean
}

interface Unit {
  kind: 'text' | 'atom' | 'break'
  node: PMNode
  pos: number
  el: HTMLElement
  top: number // natural border-box top (column coords)
  bottom: number
  contentTop: number
  contentBottom: number
  heading: boolean
  keepNext: boolean
  breakBefore: boolean
  lines?: Line[]
  textTops?: number[]
  /** the block's own padding-top (the page-push padding is added to it) */
  padTop?: number
  /** Square-wrapped (floating) pictures anchored in this block: extent and the line they are anchored on. */
  floats?: { t: number; b: number; line: number }[]
  /** The block anchors a floating picture (only then do its lines need measuring). */
  hasFloat: boolean
}

const isFloat = (n: PMNode) => n.type.name === 'image' && n.attrs.wrap === 'square'

function toCol(f: Frame, clientY: number) {
  return (clientY - f.originTop) / f.scale
}

function collectUnits(view: EditorView, f: Frame): Unit[] {
  const units: Unit[] = []
  const walk = (node: PMNode, pos: number) => {
    node.forEach((child, offset) => {
      const p = pos + offset
      const name = child.type.name
      // A continuous section break does not start a new page.
      if (name === 'pageBreak' && child.attrs.kind === 'continuous') return
      if (CONTAINERS.has(name)) {
        walk(child, p + 1)
        return
      }
      const el = view.nodeDOM(p) as HTMLElement | null
      if (!el || el.nodeType !== 1) return
      const r = el.getBoundingClientRect()
      if (r.height === 0 && name !== 'pageBreak') return
      const top = toCol(f, r.top)
      const bottom = toCol(f, r.bottom)
      units.push({
        kind: name === 'pageBreak' ? 'break' : TEXTBLOCKS.has(name) ? 'text' : 'atom',
        node: child,
        pos: p,
        el,
        top,
        bottom,
        contentTop: top, // refined lazily in measureLines (padding/border)
        contentBottom: bottom,
        heading: name === 'heading',
        keepNext: name === 'heading' || !!child.attrs.keepNext,
        breakBefore: !!child.attrs.pageBreakBefore,
        hasFloat: child.inlineContent && child.content.content.some(isFloat),
      })
    })
  }
  walk(view.state.doc, 0)
  return units
}

/** Visual lines of a textblock, from the client rects of its inline content. */
function measureLines(u: Unit, f: Frame): Line[] {
  if (u.lines) return u.lines
  const cs = getComputedStyle(u.el)
  u.padTop = parseFloat(cs.paddingTop) || 0
  u.contentTop = u.top + (parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)) / 1
  u.contentBottom = u.bottom - (parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth)) / 1
  const rects: Line[] = []
  const floats: { t: number; b: number; anchor: number }[] = []
  // Text runs (excluding text that belongs to picture chrome such as hints).
  const tw = document.createTreeWalker(u.el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  while (tw.nextNode()) {
    const t = tw.currentNode as Text
    if (!t.length || t.parentElement?.closest('.wpic')) continue
    range.selectNodeContents(t)
    for (const r of range.getClientRects()) if (r.height > 0) rects.push({ t: toCol(f, r.top), b: toCol(f, r.bottom) })
  }
  // Pictures: in-line / top-and-bottom pictures occupy a line; square-wrapped ones float.
  for (const pic of u.el.querySelectorAll<HTMLElement>('.wpic')) {
    const r = pic.getBoundingClientRect()
    if (!r.height) continue
    const box = { t: toCol(f, r.top), b: toCol(f, r.bottom) }
    // A float sits `margin-top` below the line it is anchored on (its free vertical offset).
    if (pic.dataset.wrap === 'square') floats.push({ ...box, anchor: toCol(f, r.top - parseFloat(getComputedStyle(pic).marginTop) * f.scale) })
    else rects.push({ ...box, pic: pic.dataset.wrap === 'topBottom' })
  }
  for (const br of u.el.querySelectorAll('br')) {
    const r = br.getBoundingClientRect()
    if (r.height > 0) rects.push({ t: toCol(f, r.top), b: toCol(f, r.bottom) })
  }
  rects.sort((a, b) => a.t - b.t || a.b - b.b)
  const groups: Line[] = []
  for (const r of rects) {
    const g = groups[groups.length - 1]
    if (g && r.t < g.b - 1) {
      g.t = Math.min(g.t, r.t)
      g.b = Math.max(g.b, r.b)
      g.pic = g.pic && r.pic
    } else groups.push({ ...r })
  }
  const textTops = groups.map((g) => g.t)
  let lines: Line[]
  if (!groups.length) {
    lines = [{ t: u.contentTop, b: Math.max(u.contentBottom, ...floats.map((x) => x.b)) }]
  } else {
    // Line-box boundaries: halfway between consecutive glyph runs (half-leading is symmetric).
    const bounds = [u.contentTop]
    for (let i = 1; i < groups.length; i++) bounds.push((groups[i - 1].b + groups[i].t) / 2)
    bounds.push(u.contentBottom)
    lines = groups.map((g, i) => ({ t: bounds[i], b: bounds[i + 1], pic: g.pic }))
  }
  // A float belongs to the line box it is anchored on: it moves when that line moves.
  u.floats = floats.map(({ t, b, anchor }) => {
    let line = lines.findIndex((l) => anchor < l.b - 0.5)
    if (line < 0) line = lines.length - 1
    return { t, b, line }
  })
  u.lines = lines
  u.textTops = textTops
  return lines
}

/** Top (column coords) of the glyph at `pos`, or null. */
function glyphTop(view: EditorView, f: Frame, pos: number): number | null {
  try {
    const { node, offset } = view.domAtPos(pos, 1)
    const range = document.createRange()
    if (node.nodeType === 3) {
      const len = (node as Text).length
      if (offset < len) {
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        const rs = range.getClientRects()
        if (rs.length) return toCol(f, rs[rs.length - 1].top)
      }
    } else {
      const child = node.childNodes[offset] as HTMLElement | undefined
      if (child && child.nodeType === 1 && !child.classList.contains('pg-spacer')) {
        return toCol(f, child.getBoundingClientRect().top)
      }
      if (child && child.nodeType === 3 && (child as unknown as Text).length) {
        range.setStart(child, 0)
        range.setEnd(child, 1)
        const rs = range.getClientRects()
        if (rs.length) return toCol(f, rs[0].top)
      }
    }
    return toCol(f, view.coordsAtPos(pos, 1).top)
  } catch {
    return null
  }
}

/** First document position rendered on visual line `k` of textblock `u`. */
function lineStartPos(view: EditorView, f: Frame, u: Unit, k: number): number {
  const start = u.pos + 1
  if (k === 0) return start
  const tops = u.textTops!
  const target = tops[k] - 1
  let lo = start
  let hi = u.pos + u.node.nodeSize - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const t = glyphTop(view, f, mid)
    if (t == null || t < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function frameOf(view: EditorView): Frame {
  const root = view.dom as HTMLElement
  const rr = root.getBoundingClientRect()
  return { originTop: rr.top, scale: paginationConfig.scale || (root.offsetHeight ? rr.height / root.offsetHeight : 1) }
}

// ───────────── the page-breaking pass ─────────────
function computeLayout(view: EditorView): { spacers: Spacer[]; pages: number; headings: Map<number, number> } {
  const { pitch: P, contentHeight: C } = paginationConfig
  const f = frameOf(view)
  const units = collectUnits(view, f)

  const pageOf = (y: number) => Math.max(0, Math.floor((y + TOL) / P))
  const pageTop = (n: number) => n * P
  const pageBottom = (n: number) => n * P + C

  const spacers: Spacer[] = []
  const headings = new Map<number, number>()
  let shift = 0
  let forcePage = -1 // next unit must start on a page > forcePage
  let forceSide: 'odd' | 'even' | undefined // odd/even-page section break: printed as break-before:right/left
  let lastBottom = 0

  const trace: unknown[] | null = (window as any).__pgTrace ? [] : null
  const pushTextTo = (u: Unit, k: number, targetTop: number, lineTop: number) => {
    const h = q(targetTop - lineTop)
    trace?.push({ pos: u.pos, k, lineTopNat: u.lines![k].t, glyphTopNat: u.textTops?.[k], shiftBefore: shift, targetTop, h, lines: u.lines!.slice(Math.max(0, k - 2), k + 2), textTops: u.textTops?.slice(Math.max(0, k - 2), k + 2) })
    if (h <= TOL) return
    spacers.push({
      pos: lineStartPos(view, f, u, k), height: h, block: false, target: targetTop,
      top: k === 0 ? { from: u.pos, to: u.pos + u.node.nodeSize } : undefined,
      pad: k === 0,
      padBase: k === 0 ? u.padTop : undefined,
      side: k === 0 ? forceSide : undefined,
    })
    shift += h
  }

  for (let i = 0; i < units.length; i++) {
    const u = units[i]

    if (u.kind === 'break') {
      const kind = u.node.attrs.kind
      let next = pageOf(u.top + shift) + 1 // 0-based index of the page the next block starts on
      forceSide = kind === 'oddPage' ? 'odd' : kind === 'evenPage' ? 'even' : undefined
      // Page numbers are 1-based: odd numbers sit on even indices. Leave a blank page if needed.
      if (forceSide === 'odd' && next % 2 === 1) next++
      if (forceSide === 'even' && next % 2 === 0) next++
      forcePage = next - 1
      continue
    }

    if (u.kind === 'atom') {
      const aT = u.top + shift
      const aB = u.bottom + shift
      const pg = pageOf(aT)
      const mustBreak = forcePage >= 0 && pg <= forcePage
      const overflows = aB > pageBottom(pg) + TOL && u.bottom - u.top <= C
      if ((mustBreak || overflows || aT > pageBottom(pg)) && aT > pageTop(pg) + TOL) {
        const target = pageTop(mustBreak ? forcePage + 1 : pg + 1)
        const h = q(target - aT)
        spacers.push({ pos: u.pos, height: h, block: true, target, side: mustBreak ? forceSide : undefined })
        shift += h
      }
      forcePage = -1
      forceSide = undefined
      lastBottom = u.bottom + shift
      continue
    }

    // Textblock. Fast path: the whole block sits inside one page's text area and has no
    // constraints that need line geometry → no per-line measurement at all.
    if (forcePage < 0 && !u.breakBefore && !u.keepNext && !u.hasFloat) {
      const aT = u.top + shift
      const aB = u.bottom + shift
      const pg = pageOf(aT)
      if (aT >= pageTop(pg) - TOL && aB <= pageBottom(pg) + TOL) {
        lastBottom = aB
        continue
      }
    }
    const lines = measureLines(u, f)
    let k = 0

    // Hard page break / page-break-before.
    const firstTop = lines[0].t + shift
    if (forcePage >= 0 || u.breakBefore) {
      const pg0 = pageOf(firstTop)
      const target = forcePage >= 0 ? Math.max(forcePage + 1, pg0) : firstTop > pageTop(pg0) + TOL ? pg0 + 1 : pg0
      if (pageTop(target) > firstTop + TOL) pushTextTo(u, 0, pageTop(target), firstTop)
      forcePage = -1
      forceSide = undefined
    }

    // Keep with next: if this whole block fits on its page but the next block's first
    // line does not, move this block to the next page (so a heading never ends a page).
    if (u.keepNext && i + 1 < units.length) {
      const aT = lines[0].t + shift
      const aB = lines[lines.length - 1].b + shift
      const pg = pageOf(aT)
      const nxt = units[i + 1]
      if (aB <= pageBottom(pg) + TOL && aT > pageTop(pg) + TOL && nxt.kind !== 'break') {
        // With orphan control the next paragraph needs its first two lines on this page.
        const nl = nxt.kind === 'text' ? measureLines(nxt, f) : null
        const nb = nl ? nl[Math.min(1, nl.length - 1)].b : Math.min(nxt.bottom, nxt.top + 48)
        if (nb + shift > pageBottom(pg) + TOL && aB - aT + (nb - nxt.top) <= C) {
          pushTextTo(u, 0, pageTop(pg + 1), aT)
        }
      }
    }

    while (k < lines.length) {
      const aT = lines[k].t + shift
      // A floating picture anchored on this line must fit on the same page as the line.
      const fl = u.floats?.filter((x) => x.line === k && x.b - lines[k].t <= C) ?? []
      const aB = Math.max(lines[k].b, ...fl.map((x) => x.b)) + shift
      const pg = pageOf(aT)
      if (aB <= pageBottom(pg) + TOL) {
        k++
        continue
      }
      // Line k does not fit on page pg.
      if (aB - aT > C || aT <= pageTop(pg) + TOL) {
        k++ // taller than a page, or already at the top: nothing better is possible
        continue
      }
      let s = k
      const n = lines.length
      // Widow / orphan control is about lines of text: a picture band may end or start a page alone.
      if (n >= 2 && k === 1 && !lines[0].pic) s = 0 // orphan: don't leave a lone first line
      else if (n >= 3 && k === n - 1 && !lines[k - 1].pic) s = k - 1 // widow: don't carry a lone last line
      // A floating picture stays with its anchor line, and the lines beside it would re-wrap
      // wider on the next page: never split between the anchor line and the picture's bottom.
      // Split just below the picture (it fits on this page), else above its anchor line.
      for (const fl of u.floats ?? []) {
        let last = fl.line
        while (last + 1 < n && lines[last + 1].t < fl.b - 1) last++
        if (s > fl.line && s <= last) s = k > last ? last + 1 : fl.line
      }
      const sTop = lines[s].t + shift
      if (s < k && sTop <= pageTop(pageOf(sTop)) + TOL) s = k // would not gain anything
      const lt = lines[s].t + shift
      pushTextTo(u, s, pageTop(pageOf(lt) + 1), lt)
      k = s + 1
    }

    if (u.heading) headings.set(u.pos, pageOf(lines[0].t + shift) + 1)
    // A picture hanging below the document's last paragraph still needs its page.
    lastBottom = Math.max(u.bottom, ...(u.floats ?? []).map((x) => x.b)) + shift
  }

  if (trace) (window as any).__pgTraceOut = trace
  const pages = Math.max(1, pageOf(Math.max(0, lastBottom - 1)) + 1, forcePage >= 0 ? forcePage + 2 : 1)
  return { spacers, pages, headings }
}

/** Column y (px) where the content pushed by `s` actually starts now. */
function pushedStart(view: EditorView, f: Frame, s: Spacer): number | null {
  if (s.pad && s.top) {
    const el = view.nodeDOM(s.top.from) as HTMLElement | null
    if (!el || el.nodeType !== 1) return null
    const cs = getComputedStyle(el)
    return toCol(f, el.getBoundingClientRect().top) + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)
  }
  const el = view.dom.querySelector<HTMLElement>(`.pg-spacer[data-pg-pos="${s.pos}"]`)
  return el ? toCol(f, el.getBoundingClientRect().bottom) : null
}

/**
 * The pass above predicts from the natural layout. Lines carried past a floating picture re-wrap
 * wider on their new page (the picture is no longer beside them), which it cannot foresee: so check
 * where each pushed piece really starts, in order, and correct its spacer by the difference.
 * Returns the corrected spacers (the same array when nothing was off).
 */
function reconcile(view: EditorView, spacers: Spacer[], apply: (s: Spacer[]) => void): Spacer[] {
  let out = spacers
  for (let i = 0; i < out.length; i++) {
    const at = pushedStart(view, frameOf(view), out[i])
    if (at == null) continue
    const d = out[i].target - at
    if (Math.abs(d) <= TOL) continue
    out = out.slice()
    out[i] = { ...out[i], height: Math.max(0, q(out[i].height + d)) }
    apply(out) // later spacers are measured on the corrected layout
  }
  return out
}

function sameSpacers(a: Spacer[], b: Spacer[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || a[i].block !== b[i].block || a[i].side !== b[i].side || !!a[i].top !== !!b[i].top || !!a[i].pad !== !!b[i].pad || Math.abs(a[i].height - b[i].height) > 0.5) return false
  }
  return true
}

// ───────────── plugin ─────────────
export const Pagination = Extension.create({
  name: 'pagination',

  addProseMirrorPlugins() {
    let computed: Spacer[] = [] // the last result of computeLayout
    let current: Spacer[] = [] // what is applied: `computed`, reconciled with the real layout

    return [
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(paginationKey) as Spacer[] | undefined
            if (meta) return buildDecorations(tr.doc, meta)
            return set.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state)
          },
        },
        view(view) {
          let timer = 0
          const wrapper = () => view.dom.parentElement

          const run = () => {
            if (timer) clearTimeout(timer)
            timer = 0
            if (view.isDestroyed) return
            const w = wrapper()
            if (!paginationConfig.enabled) {
              if (current.length) {
                computed = current = []
                view.dispatch(view.state.tr.setMeta(paginationKey, []).setMeta('addToHistory', false))
              }
              const pages = new Map<number, number>()
              layoutStore.set(1, pages)
              return
            }
            w?.classList.add('pg-measuring')
            let result
            const t0 = performance.now()
            try {
              result = computeLayout(view)
            } finally {
              w?.classList.remove('pg-measuring')
            }
            layoutStore.lastLayoutMs = performance.now() - t0
            layoutStore.set(result.pages, result.headings)
            // Also re-apply when the decorations were lost although the layout is the same:
            // a block whose type changes (paragraph → heading) is replaced, and its page-push goes with it.
            const want = result.spacers.reduce((n, sp) => n + (sp.pad && sp.top ? 1 : sp.top ? 2 : 1), 0)
            const have = paginationKey.getState(view.state)?.find().length ?? 0
            const apply = (s: Spacer[]) => view.dispatch(view.state.tr.setMeta(paginationKey, s).setMeta('addToHistory', false))
            if (!sameSpacers(result.spacers, computed) || have !== want) {
              computed = current = result.spacers
              apply(current)
            }
            current = reconcile(view, current, apply)
          }

          runners.set(view, run)

          // Plain timers (not rAF): layout must stay correct even when the window is hidden.
          const schedule = (delay = 40) => {
            if (timer) clearTimeout(timer)
            // Heavy documents: wait for a typing pause instead of relaying out on every key.
            const d = delay === 0 ? 0 : Math.min(400, Math.max(delay, layoutStore.lastLayoutMs * 3))
            timer = window.setTimeout(run, d)
          }

          const ro = new ResizeObserver(() => schedule(60))
          ro.observe(view.dom)
          const onLoad = (e: Event) => { if ((e.target as HTMLElement).tagName === 'IMG') schedule(0) }
          view.dom.addEventListener('load', onLoad, true)
          const onRelayout = () => schedule(0)
          window.addEventListener('grafi:relayout', onRelayout)
          document.fonts?.ready.then(() => schedule(0))
          schedule(0)

          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule()
            },
            destroy() {
              runners.delete(view)
              ro.disconnect()
              view.dom.removeEventListener('load', onLoad, true)
              window.removeEventListener('grafi:relayout', onRelayout)
              if (timer) clearTimeout(timer)
            },
          }
        },
      }),
    ]
  },
})

/** Index of the page (sheet) that column y `top` (px) falls on; 0 when not paginated. */
export function pageAt(top: number): number {
  const { enabled, pitch } = paginationConfig
  return enabled ? Math.max(0, Math.floor(top / pitch)) : 0
}

/**
 * Where a box `height` px tall that should start at `top` (column px) fits inside one page's text
 * area: pulled up off the bottom margin, or onto the next page from the gap between sheets.
 * A floating picture must fit on its page (see computeLayout), so a drop is placed where it will stay.
 */
export function fitOnPage(top: number, height: number): number {
  const { enabled, pitch: P, contentHeight: C } = paginationConfig
  if (!enabled || height > C) return top
  const page = pageAt(top)
  if (top > page * P + C) return (page + 1) * P
  return Math.max(page * P, Math.min(top, page * P + C - height))
}

/**
 * Paginate `view` synchronously, now, instead of after the usual short delay — for code that must
 * measure the paginated result right away (moving a picture). A decoration-only update: no history.
 */
export function relayoutNow(view: EditorView) {
  runners.get(view)?.()
}

/** Ask the pagination engine to re-measure (after page setup / zoom / view changes). */
export function requestRelayout() {
  window.dispatchEvent(new Event('grafi:relayout'))
}
