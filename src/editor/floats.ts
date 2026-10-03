// Floating pictures and shapes: placed freely on a page, as in Word, and never carried along by text.
//
// A wrapped picture (either wrap) is pinned to a page: `page` (0-based) and `x`, `y` — px from the
// top-left of that page's text area (`x` null = aligned per `align`). The image node stays in a
// paragraph (Word's anchor, and what DOCX / ODT export as one), but where the picture is *drawn* is
// layout: a widget ("carrier") at the start of the line it sits beside, with margins that put it
// exactly on its spot. The text there wraps around it, and print / PDF paginate it with that line.
// After every layout pass each carrier is moved to whatever line is beside the spot now: editing the
// text above never moves a picture, nor takes it to another page.
//
// `page` null: not pinned yet (inserted, pasted, or from an older document), drawn from its own line
// the old way (`x` from the paragraph's left, `y` below that line). `page` -1: imported, `x` / `y`
// relative to the text area of the page its anchor paragraph lands on. Both are pinned to where they
// show the first time they are laid out in Print Layout.
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { addLayoutPass, paginateOnly, paginationConfig, relayoutNow } from './Pagination'
import { layoutStore } from './layoutStore'

/** A wrapped picture's node view (image.ts), as placement sees it. */
export interface Floating {
  readonly uid: number
  readonly view: EditorView
  /** The picture as drawn (`.wpic`); it lives in the carrier, not in the paragraph of its node. */
  readonly el: HTMLElement
  readonly node: PMNode
  getPos(): number | undefined
  /** Offsets from the carrier: `y` below its line (as image.ts `pictureStyles`), `x` from the paragraph's
   *  left; `free`: drawn there without moving any text (it would collide with another picture). */
  place: Place | null
  render(): void
  box(): { w: number; h: number }
  /** Distances kept from the text, px. */
  dist(): { top: number; bottom: number; side: number }
  /** The anchor found on the text paginated without the picture, and where the text before it ended then (see placeObjects). */
  checked?: { at: number; prev?: number }
  /** The paragraph's text before the carrier when it was anchored (see keepAnchor). */
  anchorText?: string
  /** This layout's anchors so far, and the last correction (see placeObjects). */
  visits?: { run: number; ats: number[]; last: number }
  /** Kept free while the pictures stay as they are (moving or resizing any of them tries again). */
  stuck?: string
}
export interface Place { x: number | null; y: number; free?: boolean }

const live = new Set<Floating>()
let uids = 0
export const nextUid = () => ++uids

export function registerFloating(f: Floating) { live.add(f); requestPlacement(f.view) }
export function unregisterFloating(f: Floating) { live.delete(f); requestPlacement(f.view) }

const pending = new WeakSet<EditorView>()
/** Lay out (and so place) right after the current update, before the next paint. */
export function requestPlacement(view: EditorView) {
  if (pending.has(view)) return
  pending.add(view)
  queueMicrotask(() => {
    pending.delete(view)
    if (!view.isDestroyed) relayoutNow(view)
  })
}

export const isPinned = (n: PMNode) => typeof n.attrs.page === 'number' && n.attrs.page >= 0

// ───────────── carriers ─────────────
interface CarrierSpec { uid: number; at: number; f: Floating }

export const floatKey = new PluginKey<DecorationSet>('floats')

function carrier(f: Floating) {
  return () => {
    const s = document.createElement('span')
    s.className = 'wpic-carrier'
    s.contentEditable = 'false'
    s.appendChild(f.el)
    return s
  }
}

function carriersOf(doc: PMNode, list: CarrierSpec[]) {
  return DecorationSet.create(doc, list.map(({ uid, at, f }) => Decoration.widget(at, carrier(f), {
    uid, key: `fl${uid}`,
    // After a page-break spacer at the same position (side -1), before the line's text.
    side: -0.5,
    marks: [],
    ignoreSelection: true,
    // Pointer presses on the picture are handled by its node view (select / move / resize).
    stopEvent: () => true,
  })))
}

export const floatsPlugin = () => new Plugin<DecorationSet>({
  key: floatKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const list = tr.getMeta(floatKey) as CarrierSpec[] | undefined
      return list ? carriersOf(tr.doc, list) : set.map(tr.mapping, tr.doc)
    },
  },
  props: { decorations: (s) => floatKey.getState(s) },
  view: (view) => ({
    update(v, prev) {
      // A carrier whose line was deleted is gone: place its picture again before it is painted.
      if (v.state.doc === prev.doc) return
      const have = new Set(floatKey.getState(v.state)!.find().map((d) => (d.spec as CarrierSpec).uid))
      for (const f of live) if (f.view === view && !have.has(f.uid)) { requestPlacement(view); break }
    },
  }),
})

// ───────────── geometry ─────────────
interface Frame { top: number; left: number; scale: number; width: number }
function frameOf(view: EditorView): Frame {
  const el = view.dom as HTMLElement
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, scale: paginationConfig.scale || (el.offsetHeight ? r.height / el.offsetHeight : 1), width: el.clientWidth }
}

/** The spot a pinned picture sits on, in column px (the column's top is page 0's text area top). */
export function spotOf(n: PMNode, box: { w: number; h: number }, textWidth: number) {
  const { pitch: P, contentHeight: C } = paginationConfig
  const a = n.attrs
  const y = clamp(a.y ?? 0, 0, C - box.h)
  const x = a.x == null ? alignX(a.align, box.w, textWidth) : clamp(a.x, 0, textWidth - box.w)
  return { top: Math.max(0, a.page) * P + y, left: x }
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v))
export const alignX = (align: string, w: number, textWidth: number) => align === 'right' ? Math.max(0, textWidth - w) : align === 'left' ? 0 : Math.max(0, (textWidth - w) / 2)

interface Block { pos: number; node: PMNode; el: HTMLElement; top: number; bottom: number; left: number }

const CONTAINERS = new Set(['bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote'])

/** Textblocks (not inside tables) whose content box overlaps column y [from, to], in document order. */
function blocksIn(view: EditorView, fr: Frame, from: number, to: number): Block[] {
  const doc = view.state.doc
  const offs: number[] = []
  doc.forEach((_, off) => offs.push(off))
  const rectOf = (pos: number) => { const el = view.nodeDOM(pos) as HTMLElement | null; return el && el.nodeType === 1 ? el.getBoundingClientRect() : null }
  // Top-level blocks are laid out in order: binary search for the first one reaching `from`.
  let lo = 0, hi = offs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const r = rectOf(offs[mid])
    if (r && (r.bottom - fr.top) / fr.scale < from) lo = mid + 1
    else hi = mid
  }
  const out: Block[] = []
  const take = (node: PMNode, pos: number) => {
    const el = view.nodeDOM(pos) as HTMLElement | null
    if (!el || el.nodeType !== 1) return
    const r = el.getBoundingClientRect()
    if (!r.height) return
    const cs = getComputedStyle(el)
    const top = (r.top - fr.top) / fr.scale + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)
    const bottom = (r.bottom - fr.top) / fr.scale - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth)
    if (bottom > from && top < to) out.push({ pos, node, el, top, bottom, left: (r.left - fr.left) / fr.scale + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) })
  }
  const walk = (node: PMNode, pos: number) => {
    if (node.isTextblock) take(node, pos)
    else if (CONTAINERS.has(node.type.name)) node.forEach((c, off) => walk(c, pos + 1 + off))
  }
  for (let i = Math.max(0, lo - 1); i < offs.length; i++) {
    const r = rectOf(offs[i])
    if (r && (r.top - fr.top) / fr.scale > to) break
    walk(doc.child(i), offs[i])
  }
  return out
}

/** Start of the visual line of `b` at column y `y` (pictures don't take part in the hit test). */
function lineStart(view: EditorView, fr: Frame, b: Block, y: number): number {
  const hit = view.posAtCoords({ left: fr.left + (b.left + 1) * fr.scale, top: fr.top + y * fr.scale })
  const start = b.pos + 1, end = b.pos + b.node.nodeSize - 1
  return hit ? Math.max(start, Math.min(end, hit.pos)) : start
}

/**
 * The carrier's position for a picture whose box (with its distance from the text) starts at column
 * y `top` on page `page`: the start of the line beside that spot; between paragraphs, the first line
 * below it on the same page (or the end of the last paragraph above it, when the page has none).
 * `first`: that line is the first on its page.
 */
function anchorFor(view: EditorView, fr: Frame, page: number, top: number, wrap: string): { at: number; block: Block; first?: boolean } | null {
  const { pitch: P, contentHeight: C } = paginationConfig
  const pageTop = page * P, pageBottom = pageTop + C
  const on = blocksIn(view, fr, pageTop, pageBottom)
  const firstAt = () => on[0] && lineStart(view, fr, on[0], Math.max(pageTop, on[0].top) + 1)
  const B = on.find((b) => b.top <= top && top < b.bottom)
  if (B) { const at = lineStart(view, fr, B, Math.max(top, B.top + 1)); return { at, block: B, first: at === firstAt() } }
  const N = on.find((b) => b.top > top)
  if (N) return { at: N.pos + 1, block: N, first: N === on[0] }
  const A = on[on.length - 1] ?? blocksIn(view, fr, 0, pageTop).pop() ?? blocksIn(view, fr, pageBottom, Infinity)[0]
  if (!A) return null
  // A square picture hangs from the paragraph's last line; a top-and-bottom one follows the paragraph.
  return { at: wrap === 'square' ? lineStart(view, fr, A, A.bottom - 1) : A.pos + A.node.nodeSize - 1, block: A }
}

const coords = (view: EditorView, pos: number, side: number) => { try { return view.coordsAtPos(pos, side) } catch { return null } }

/**
 * Whether the carrier at `at` may stay for a picture whose box (with its distance from the text) starts
 * at column y `top` on page `page` — on the text as it is, without lifting the picture: lines before a
 * carrier don't depend on it. `text`: the paragraph's text before `at` when it was anchored there, so
 * `at` still starts a line. 'fit': fine, but its line opens the page and might fit on the one before
 * (`prev`: where the text before it ends) — only the text paginated without the picture can tell.
 */
function keepAnchor(view: EditorView, fr: Frame, at: number, page: number, top: number, wrap: string, text: string): boolean | { fit: number } {
  const doc = view.state.doc
  if (at > doc.content.size) return false
  const $at = doc.resolve(at)
  if (!$at.parent.isTextblock || doc.textBetween($at.start(), at) !== text) return false
  const { pitch: P, contentHeight: C } = paginationConfig
  const pageTop = page * P
  const y = (v: number) => (v - fr.top) / fr.scale
  const el = view.nodeDOM($at.before()) as HTMLElement | null
  if (!el || el.nodeType !== 1) return false
  const cs = getComputedStyle(el)
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
  // Where the text before the carrier ends: its line in this paragraph, or the block before.
  let prev: number | null = null
  if (at > $at.start()) prev = y(coords(view, at, -1)?.bottom ?? NaN)
  else {
    const b = $at.before(), nb = doc.resolve(b).nodeBefore
    const pe = nb && (view.nodeDOM(b - nb.nodeSize) as HTMLElement | null)
    if (pe && pe.nodeType === 1) prev = y(pe.getBoundingClientRect().bottom)
  }
  if (prev != null && !Number.isFinite(prev)) return false
  const next = at < $at.end() ? coords(view, at, 1) : null
  const nextTop = next && y(next.top)
  // Still a line start: what follows the carrier is below what precedes it.
  if (nextTop != null && prev != null && at > $at.start() && nextTop < prev - 2) return false
  const opens = prev == null || prev <= pageTop + 1
  const ok = wrap === 'topBottom'
    // A band: the text above it ends above it, and no further line would fit between them.
    ? (opens || prev! <= top + 1) && top - (opens ? pageTop : prev!) < lh
    // A square picture hangs from a line at or above its top, on its page (or the page's first line).
    : nextTop != null && nextTop >= pageTop - 1 && (nextTop <= top + 2 || opens)
  if (!ok) return false
  return opens && prev != null && prev + lh <= pageTop - P + C + 1 ? { fit: prev } : true
}

/** Where a picture pinned at (`page`, column top `top`) is anchored — the paragraph its node belongs in. */
export function anchorBlock(view: EditorView, page: number, top: number, wrap: string): { pos: number; node: PMNode } | null {
  const fr = frameOf(view)
  view.dom.classList.add('fl-measuring')
  try {
    const a = anchorFor(view, fr, page, top, wrap)
    return a && { pos: a.block.pos, node: a.block.node }
  } finally {
    view.dom.classList.remove('fl-measuring')
  }
}

// ───────────── placement ─────────────
const floatsOf = (view: EditorView) => [...live].filter((f) => f.view === view && f.node.attrs.wrap && f.getPos() != null)

/** Puts the carriers where `want` says; carriers at the same position keep `order` (top-down on the page). */
function applyCarriers(view: EditorView, want: Map<Floating, number>, order?: Map<Floating, number>): boolean {
  const set = floatKey.getState(view.state)
  if (!set) return false
  const cur = new Map(set.find().map((d) => [(d.spec as CarrierSpec).uid, d.from]))
  let same = cur.size === want.size
  for (const [f, at] of want) if (cur.get(f.uid) !== at || !f.el.parentElement?.isConnected) same = false
  if (same) return false
  const rank = (f: Floating) => order?.get(f) ?? -1
  const list: CarrierSpec[] = [...want].sort((a, b) => a[1] - b[1] || rank(a[0]) - rank(b[0])).map(([f, at]) => ({ uid: f.uid, at, f }))
  view.dispatch(view.state.tr.setMeta(floatKey, list).setMeta('addToHistory', false))
  return true
}

/**
 * Puts every floating picture of `view` on its spot (a pass after pagination; see Pagination.run).
 * Returns true when anything moved, so the text is paginated again around the new positions.
 */
function placeObjects(view: EditorView): boolean {
  const fs = floatsOf(view)
  const set = floatKey.getState(view.state)
  if (!fs.length) return set && set.find().length ? applyCarriers(view, new Map()) : false
  const paginated = paginationConfig.enabled
  const connected = (view.dom as HTMLElement).isConnected && (view.dom as HTMLElement).offsetHeight > 0

  // Not laid out in pages (Web Layout), not pinned yet, or not measurable: from the picture's own line.
  const want = new Map<Floating, number>()
  const cur = new Map((set?.find() ?? []).map((d) => [(d.spec as CarrierSpec).uid, d.from]))
  let changed = false
  for (const f of fs) {
    const pos = f.getPos()!
    if (paginated && connected && isPinned(f.node)) { want.set(f, cur.get(f.uid) ?? pos); continue }
    const a = f.node.attrs
    // Positioned on its anchor's page, not yet known: not drawn (it would push its paragraph) until pinned.
    if (paginated && connected && a.page === -1) continue
    want.set(f, pos)
    const place = isPinned(f.node) || a.page === -1 ? { x: a.x, y: 0 } : { x: a.x, y: a.y ?? 0 }
    if (f.place?.x !== place.x || f.place?.y !== place.y) { f.place = place; f.render(); changed = true }
  }
  changed = applyCarriers(view, want) || changed
  if (!paginated || !connected) return changed

  const fr = frameOf(view)
  const { pitch: P } = paginationConfig
  // Where a picture's (unrotated) box is, in column px: from the centre of what is drawn, which rotation keeps.
  const boxAt = (f: Floating) => {
    const r = f.el.getBoundingClientRect(), b = f.box()
    return { top: ((r.top + r.bottom) / 2 - fr.top) / fr.scale - b.h / 2, left: ((r.left + r.right) / 2 - fr.left) / fr.scale - b.w / 2, drawn: r.width > 0 || r.height > 0 }
  }

  // Pin what is drawn the old way where it shows now (kept out of the undo history, not an edit).
  const pins: { pos: number; attrs: Record<string, unknown> }[] = []
  for (const f of fs) {
    const a = f.node.attrs
    if (isPinned(f.node)) continue
    const box = f.box()
    if (a.page === -1) continue
    const at = boxAt(f)
    if (!at.drawn) continue
    const page = Math.max(0, Math.min(layoutStore.pageCount - 1, Math.floor((at.top + box.h / 2) / P)))
    const y = Math.round(clamp(at.top - page * P, 0, paginationConfig.contentHeight - box.h))
    pins.push({ pos: f.getPos()!, attrs: { ...a, page, y, x: a.x == null ? null : Math.round(clamp(at.left, 0, fr.width - box.w)) } })
  }
  if (pins.length) {
    const tr = view.state.tr
    for (const p of pins) tr.setNodeMarkup(p.pos, undefined, p.attrs)
    view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true))
    return true
  }

  // Imported pictures on their paragraph's page (where Word and LibreOffice put them): one at a time,
  // in document order, each once the ones before it are placed — they take room on the pages.
  const next = fs.filter((f) => f.node.attrs.page === -1).sort((a, b) => a.getPos()! - b.getPos()!)[0]
  if (next) {
    const pos = next.getPos()!
    const el = view.nodeDOM(view.state.doc.resolve(pos).before()) as HTMLElement | null
    const top = el && el.nodeType === 1 ? (el.getBoundingClientRect().top - fr.top) / fr.scale + parseFloat(getComputedStyle(el).paddingTop) : 0
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...next.node.attrs, page: Math.max(0, Math.floor((top + 1) / P)) })
      .setMeta('addToHistory', false).setMeta('preventUpdate', true))
    layoutStore.pinning = true
    changed = true
  }

  // Top-down, one at a time: each picture is anchored on the text as the pictures above it leave it,
  // measured without itself, then moved onto its exact spot before the next one is placed.
  const pinned = fs.filter((f) => isPinned(f.node))
    .map((f) => ({ f, spot: spotOf(f.node, f.box(), fr.width) }))
    .sort((a, b) => a.spot.top - b.spot.top || a.spot.left - b.spot.left)
  const order = new Map(pinned.map(({ f }, i) => [f, i]))
  const layoutSig = pinned.map(({ f, spot }) => `${f.uid}:${f.node.attrs.page}:${spot.top}:${spot.left}:${f.node.attrs.wrap}:${f.node.attrs.align}:${f.box().w}x${f.box().h}`).join()
  const doc = view.state.doc
  // Text can't wrap around pictures that overlap (CSS floats and bands push each other away): the later
  // one is drawn exactly on its spot, in front of the text — as is one whose spot could not be reached.
  const taken: { page: number; top: number; bottom: number; left: number; right: number; band: boolean; side: string }[] = []
  const trace: unknown[] | null = (window as any).__flTrace ? (window as any).__flTrace : null
  // Pagination is redone before a picture when one above it moved: the text below that one flows
  // differently now, and each picture must be anchored on the text as it will be paginated.
  let moved = false
  for (const { f, spot } of pinned) {
    if (moved) { paginateOnly(view); moved = false }
    const a = f.node.attrs, box = f.box(), d = f.dist()
    const r = { page: a.page, top: spot.top - d.top, bottom: spot.top + box.h + d.bottom, left: spot.left - d.side, right: spot.left + box.w + d.side, band: a.wrap === 'topBottom', side: a.align === 'right' ? 'right' : 'left' }
    // Two bands can't share lines, nor two square pictures on the same side (or overlapping); a band
    // and a square picture can.
    const free = f.stuck === layoutSig || taken.some((o) => o.page === r.page && o.top < r.bottom && r.top < o.bottom
      && (o.band && r.band || !o.band && !r.band && (o.side === r.side || (o.left < r.right && r.left < o.right))))
    if (!free) taken.push(r)

    // Usually the line it hangs from still does: keep it (no search, no lifting).
    const cur = want.get(f)
    const keep = f.place && !!f.place.free === free && cur != null && f.anchorText != null && f.el.isConnected
      ? keepAnchor(view, fr, cur, a.page, spot.top - d.top, a.wrap, f.anchorText) : false
    // A line that opens the page and would fit on the one before was checked already (unless that page changed).
    const ck = f.checked
    const checkedFit = typeof keep === 'object' && !!ck && ck.at === cur && (ck.prev == null || Math.abs(ck.prev - keep.fit) < 1)
    if (checkedFit && f.checked!.prev == null) f.checked!.prev = (keep as { fit: number }).fit
    let anchor: { at: number; block?: Block; first?: boolean } | null = keep === true || checkedFit ? { at: cur! } : null
    if (!anchor) {
      view.dom.classList.add('fl-measuring')
      f.el.classList.add('lifted')
      try {
        const find = () => anchorFor(view, frameOf(view), a.page, spot.top - d.top, a.wrap)
        anchor = find()
        // A line that opens the page may be there only because the picture went before it (a page
        // break carried both over): without the picture it may fit on the page before. Measured on the
        // text paginated without the picture.
        if (!free && (anchor?.first || typeof keep === 'object')) {
          paginateOnly(view)
          anchor = find()
          f.checked = anchor ? { at: anchor.at } : undefined
          changed = moved = true
        }
      } finally {
        f.el.classList.remove('lifted')
        view.dom.classList.remove('fl-measuring')
      }
    }
    trace?.push({ uid: f.uid, spot, free, at: anchor?.at, first: anchor?.first, had: want.get(f), text: anchor && doc.textBetween(anchor.at, Math.min(anchor.at + 24, doc.content.size)) })
    if (!anchor) continue
    // Back on a line it already left during this layout, or corrected back and forth: it is fighting
    // another picture. Drawn free (from the next pass on), it settles.
    const run = layoutStore.layoutRun
    if (f.visits?.run !== run) f.visits = { run, ats: [], last: 0 }
    if (want.get(f) !== anchor.at && f.visits.ats.includes(anchor.at)) f.stuck = layoutSig
    f.visits.ats.push(anchor.at)
    let fresh = false
    if (want.get(f) !== anchor.at || !f.place || !!f.place.free !== free || !f.el.isConnected) {
      // A first guess from the line's top; measured and corrected below.
      const lt = view.coordsAtPos(anchor.at, 1).top
      const $at = doc.resolve(anchor.at)
      f.anchorText = doc.textBetween($at.start(), anchor.at)
      f.place = { y: spot.top - d.top - (lt - fr.top) / fr.scale, x: spot.left - (anchor.block?.left ?? 0), free }
      f.render()
      want.set(f, anchor.at)
      changed = applyCarriers(view, want, order) || changed
      moved = true
      fresh = true
    }
    // Exact offsets: whatever the line box geometry, measure where the picture is and correct it.
    for (let k = 0; k < 2; k++) {
      if (!f.el.isConnected) break
      const at = boxAt(f)
      const dy = spot.top - at.top, dx = spot.left - at.left
      trace?.push({ uid: f.uid, dy, dx, y: f.place!.y })
      if (k === 0) {
        if (!fresh && Math.abs(dy) > 1 && Math.abs(dy + f.visits.last) < Math.abs(dy) / 4) f.stuck = layoutSig
        f.visits.last = dy
      }
      // Layout rounds positions to fractions of a pixel: closer than that is on the spot.
      if (Math.abs(dy) <= 0.5 && Math.abs(dx) <= 0.5) break
      f.place = { ...f.place!, y: f.place!.y + dy, x: (f.place!.x ?? 0) + dx }
      f.render()
      changed = true
      // Moved enough to change how the text below flows: paginate again before the next picture.
      if (Math.max(Math.abs(dy), Math.abs(dx)) > 2) moved = true
    }
  }
  return changed
}

addLayoutPass(placeObjects)

/**
 * The document for export: each pinned picture's node moved into a paragraph that starts on its page,
 * because Word and LibreOffice place a floating picture on the page of its anchor paragraph.
 */
export function exportDoc(view: EditorView) {
  const { state } = view
  if (!paginationConfig.enabled) return state.doc
  const fr = frameOf(view)
  const { pitch: P, contentHeight: C } = paginationConfig
  const moves: { from: number; to: number }[] = []
  view.dom.classList.add('fl-measuring')
  try {
    for (const f of floatsOf(view)) {
      if (!isPinned(f.node)) continue
      const pos = f.getPos()!
      const page = f.node.attrs.page
      const on = blocksIn(view, fr, page * P, page * P + C)
      const starts = (b: Block) => b.top >= page * P - 1
      const $pos = state.doc.resolve(pos)
      if (on.some((b) => starts(b) && b.pos === $pos.before())) continue
      const target = on.find((b) => starts(b) && b.node.type.name === 'paragraph') ?? on.find(starts) ?? on[0]
      if (target && target.pos !== $pos.before()) moves.push({ from: pos, to: target.pos + 1 })
    }
  } finally {
    view.dom.classList.remove('fl-measuring')
  }
  if (!moves.length) return state.doc
  const tr = state.tr
  for (const m of moves.sort((a, b) => b.from - a.from)) {
    const node = state.doc.nodeAt(m.from)!
    const from = tr.mapping.map(m.from)
    tr.delete(from, from + 1)
    tr.insert(tr.mapping.map(m.to, -1), node)
  }
  return tr.doc
}
