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

/**
 * `top` marks a block that was moved whole to a new page: in print the forced break
 * propagates to the block's start (CSS Fragmentation), so its space-before must be
 * suppressed there — exactly what Word does for a paragraph at the top of a page.
 */
interface Spacer { pos: number; height: number; block: boolean; top?: { from: number; to: number }; pad?: boolean; side?: 'odd' | 'even' }

const CONTAINERS = new Set(['bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote'])
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])
const TOL = 0.75 // px tolerance against sub-pixel rounding
/** Chromium lays out in 1/64 px units; quantizing spacer heights keeps predictions exact over hundreds of pages. */
const q = (h: number) => Math.round(h * 64) / 64

function makeSpacerDom(height: number, block: boolean, side?: 'odd' | 'even') {
  const el = document.createElement(block ? 'div' : 'span')
  el.className = (block ? 'pg-spacer pg-spacer-block' : 'pg-spacer') + (side ? ` pg-${side}` : '')
  el.style.height = `${height}px`
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-hidden', 'true')
  return el
}

function buildDecorations(doc: PMNode, spacers: Spacer[]) {
  const decos: Decoration[] = []
  for (const s of spacers) {
    // A heading moved whole to the next page is pushed down with padding instead of an
    // inline spacer, so its section number (::before) moves with it.
    if (s.pad && s.top) {
      decos.push(Decoration.node(s.top.from, s.top.to, { class: `pg-top pg-pad${s.side ? ` pg-${s.side}` : ''}`, style: `padding-top:${s.height}px` }))
      continue
    }
    decos.push(Decoration.widget(s.pos, () => makeSpacerDom(s.height, s.block, s.side), {
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

interface Line { t: number; b: number }

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
  /** Square-wrapped (floating) pictures anchored in this block, with the line they start on. */
  floats?: { t: number; b: number; line: number }[]
}

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
  u.contentTop = u.top + (parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)) / 1
  u.contentBottom = u.bottom - (parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth)) / 1
  const rects: Line[] = []
  const floats: { t: number; b: number }[] = []
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
    if (pic.dataset.wrap === 'square') floats.push(box)
    else rects.push(box)
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
    lines = groups.map((_, i) => ({ t: bounds[i], b: bounds[i + 1] }))
  }
  // A float starts on the line box that contains its top edge.
  u.floats = floats.map((x) => {
    let line = lines.findIndex((l) => x.t < l.b - 0.5)
    if (line < 0) line = lines.length - 1
    return { ...x, line }
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

// ───────────── the page-breaking pass ─────────────
function computeLayout(view: EditorView): { spacers: Spacer[]; pages: number; headings: Map<number, number> } {
  const { pitch: P, contentHeight: C } = paginationConfig
  const root = view.dom as HTMLElement
  const rr = root.getBoundingClientRect()
  const f: Frame = { originTop: rr.top, scale: paginationConfig.scale || (root.offsetHeight ? rr.height / root.offsetHeight : 1) }
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
      pos: lineStartPos(view, f, u, k), height: h, block: false,
      top: k === 0 ? { from: u.pos, to: u.pos + u.node.nodeSize } : undefined,
      pad: k === 0 && u.heading,
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
        spacers.push({ pos: u.pos, height: h, block: true, side: mustBreak ? forceSide : undefined })
        shift += h
      }
      forcePage = -1
      forceSide = undefined
      lastBottom = u.bottom + shift
      continue
    }

    // Textblock. Fast path: the whole block sits inside one page's text area and has no
    // constraints that need line geometry → no per-line measurement at all.
    if (forcePage < 0 && !u.breakBefore && !u.keepNext) {
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
      const fl = u.floats?.filter((x) => x.line === k && x.b - lines[k].t <= C) || []
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
      if (n >= 2 && k === 1) s = 0 // orphan: don't leave a lone first line
      else if (n >= 3 && k === n - 1) s = k - 1 // widow: don't carry a lone last line
      // Lines beside a square-wrapped picture would re-wrap wider on the next page and
      // change the paragraph's height, so only split below the picture (or move it whole).
      if (u.floats?.length) {
        const clear = Math.max(...u.floats.map((x) => x.b))
        while (s > 0 && lines[s].t < clear - 1) s--
      }
      const sTop = lines[s].t + shift
      if (s < k && sTop <= pageTop(pageOf(sTop)) + TOL) s = k // would not gain anything
      const lt = lines[s].t + shift
      pushTextTo(u, s, pageTop(pageOf(lt) + 1), lt)
      k = s + 1
    }

    if (u.heading) headings.set(u.pos, pageOf(lines[0].t + shift) + 1)
    lastBottom = u.bottom + shift
  }

  if (trace) (window as any).__pgTraceOut = trace
  const pages = Math.max(1, pageOf(Math.max(0, lastBottom - 1)) + 1, forcePage >= 0 ? forcePage + 2 : 1)
  return { spacers, pages, headings }
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
    let current: Spacer[] = []

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
            timer = 0
            if (view.isDestroyed) return
            const w = wrapper()
            if (!paginationConfig.enabled) {
              if (current.length) {
                current = []
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
            if (!sameSpacers(result.spacers, current)) {
              current = result.spacers
              view.dispatch(view.state.tr.setMeta(paginationKey, current).setMeta('addToHistory', false))
            }
          }

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

/** Ask the pagination engine to re-measure (after page setup / zoom / view changes). */
export function requestRelayout() {
  window.dispatchEvent(new Event('grafi:relayout'))
}
