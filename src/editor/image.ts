// Pictures. Deliberately simpler than Word: exactly two layouts —
//   • "topBottom" (Πάνω & κάτω): the picture sits on its own band, text above and below;
//     no text beside it.
//   • "square" (Τετράγωνη): the picture floats inside the text and the text wraps around
//     it on its wider side.
// Both can be dragged to any line and to any horizontal spot (`x`, px from the left of the
// paragraph's text box); the ribbon's left / centre / right buttons snap them back (x = null).
// Plus shape crops (circle, rounded, hexagon…), aspect-ratio crops with a movable
// focal point (double-click to pan the picture inside its frame), and shadows.
// The «Στρογγυλεμένο» shape has an adjustable corner radius: drag the corner handle on
// the picture (Canva-style) or use the ribbon field.
// Exporters "bake" shape/crop/shadow into the image pixels so Word, LibreOffice and
// PDF show exactly what you see here.
import Image from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { t, fmtNum, onLangChange, type Key } from '../i18n'
import { parseVShape, shapeSrc, isLine, type VShape } from './shapes'

export type ImgWrap = 'topBottom' | 'square'
export type ImgAlign = 'left' | 'center' | 'right'
export type ImgShape = 'rect' | 'rounded' | 'circle' | 'ellipse' | 'hexagon' | 'diamond' | 'triangle' | 'star'
export type ImgShadow = 'none' | 'soft' | 'medium' | 'strong'

// Labels are getters so they always read in the current UI language.
const labelled = <T,>(id: T, key: Key) => ({ id, get label() { return t(key) } })
export const IMG_SHAPES: { id: ImgShape; readonly label: string }[] =
  (['rect', 'rounded', 'circle', 'ellipse', 'hexagon', 'diamond', 'triangle', 'star'] as ImgShape[]).map((id) => labelled(id, `shape.${id}` as Key))
export const IMG_ASPECTS: { id: string | null; readonly label: string }[] = [
  labelled<string | null>(null, 'aspect.original'),
  ...['1:1', '4:3', '3:4', '16:9', '3:2'].map((id) => ({ id, label: id })),
]
export const IMG_SHADOWS: { id: ImgShadow; readonly label: string }[] =
  (['none', 'soft', 'medium', 'strong'] as ImgShadow[]).map((id) => labelled(id, `shadow.${id}` as Key))

/** Shadow parameters shared by CSS and the export rasterizer (px at 96 dpi). */
export const SHADOW: Record<ImgShadow, { blur: number; y: number; alpha: number } | null> = {
  none: null, soft: { blur: 10, y: 3, alpha: 0.22 }, medium: { blur: 16, y: 6, alpha: 0.32 }, strong: { blur: 24, y: 10, alpha: 0.45 },
}

const star = (() => {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.4 : 1
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${(50 + 50 * r * Math.cos(a)).toFixed(1)}% ${(50 + 50 * r * Math.sin(a) + 4).toFixed(1)}%`)
  }
  return pts
})()

/** Shape outline as fractional polygon points (null = not a polygon). */
export const SHAPE_POLY: Partial<Record<ImgShape, [number, number][]>> = {
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  star: star.map((p) => p.split(' ').map((v) => parseFloat(v) / 100) as [number, number]),
}

/** Default corner radius of «Στρογγυλεμένο», as % of the picture's shorter side (0–50). */
export const DEFAULT_RADIUS = 12
/** Kept to 0.1 % so small radii can be tuned finely. */
export const clampRadius = (r: unknown) => { const n = Number(r); return Number.isFinite(n) ? Math.max(0, Math.min(50, Math.round(n * 10) / 10)) : DEFAULT_RADIUS }
/** The radius slider is quadratic (slider 0–100 → 0–50 %), so the low end, where 1 % is most visible, gets most of its travel. */
export const radiusToSlider = (r: number) => Math.sqrt(clampRadius(r) / 50) * 100
export const sliderToRadius = (s: number) => clampRadius(50 * (s / 100) ** 2)
export const formatRadius = (r: number) => `${fmtNum(clampRadius(r), 1)}%`
/** Corner radius in px for a box (the % is of the shorter side, so corners stay circular). */
export const radiusPx = (radius: number | null | undefined, box: { w: number; h: number }) =>
  (Math.min(box.w, box.h) * clampRadius(radius ?? DEFAULT_RADIUS)) / 100

/** `box` gives the rounded corners in px; without it (gallery thumbnails) they're a %. */
export function shapeClipCss(shape: ImgShape | null | undefined, box?: { w: number; h: number }, radius?: number | null): string {
  switch (shape) {
    case 'rounded': return box ? `inset(0 round ${radiusPx(radius, box).toFixed(1)}px)` : `inset(0 round ${clampRadius(radius ?? DEFAULT_RADIUS)}%)`
    case 'circle': case 'ellipse': return 'ellipse(50% 50% at 50% 50%)'
    case 'hexagon': case 'diamond': case 'triangle': case 'star':
      return `polygon(${SHAPE_POLY[shape]!.map(([x, y]) => `${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`).join(',')})`
    default: return 'none'
  }
}

export function aspectValue(a: string | null | undefined): number | null {
  if (!a) return null
  const [w, h] = a.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : null
}

export interface ImgAttrs {
  src: string; alt: string | null; title: string | null; width: number | null; height: number | null
  wrap: ImgWrap | null; align: ImgAlign; shape: ImgShape; aspect: string | null; focusX: number; focusY: number; shadow: ImgShadow
  radius: number
  /** Free horizontal position: px from the left of the paragraph's text box (null = use `align`). */
  x: number | null
  /** Free vertical position: px below the line the picture is anchored on (0 = on that line). */
  y?: number | null
  /** Set when this "picture" is a shape (Insert ▸ Shapes); `src` is then drawn from it. */
  vshape?: VShape | null
}

/** Displayed box size (px) given attributes. */
export function displaySize(a: ImgAttrs, natural?: { w: number; h: number }): { w: number; h: number } {
  const w = a.width || natural?.w || 300
  const ratio = aspectValue(a.shape === 'circle' ? '1:1' : a.aspect)
  if (ratio) return { w, h: Math.round(w / ratio) }
  if (a.height) return { w, h: a.height }
  if (natural) return { w, h: Math.round((w * natural.h) / natural.w) }
  return { w, h: Math.round(w * 0.66) }
}

/**
 * CSS for the picture wrapper (layout) and the <img> (shape + crop).
 * Shadows are NOT a CSS filter on the picture: Chromium would re-rasterize the image
 * (losing the original pixels in PDF). The node view draws the shadow as a separate,
 * blurred shape layer underneath; only HTML export (`withFilter`) uses drop-shadow.
 */
export function pictureStyles(a: ImgAttrs, box: { w: number; h: number }, withFilter = false) {
  const wrap: string[] = []
  const img: string[] = [`width:${box.w}px`, `height:${box.h}px`, 'object-fit:cover', `object-position:${a.focusX}% ${a.focusY}%`]
  const gap = '8pt'
  const x = a.x == null ? null : Math.max(0, Math.round(a.x))
  const y = a.wrap && a.y ? Math.max(0, Math.round(a.y)) : 0
  if (a.wrap === 'square') {
    const side = a.align === 'right' ? 'right' : 'left'
    // A right float at `x` keeps its distance to the right edge, so text still wraps on the left.
    const edge = x == null ? '0' : side === 'left' ? `${x}px` : `max(0px, calc(100% - ${x + box.w}px))`
    const top = y ? `calc(2pt + ${y}px)` : '2pt'
    wrap.push(`float:${side}`, side === 'left' ? `margin:${top} ${gap} 4pt ${edge}` : `margin:${top} ${edge} 4pt ${gap}`)
    // Moved down by `y`: text still runs full width above the picture, only beside it does it wrap.
    if (y) wrap.push(`shape-outside:inset(${y}px 0 0 0)`)
  } else if (a.wrap === 'topBottom') {
    const top = y ? `calc(${gap} + ${y}px)` : gap
    if (x != null) wrap.push('display:table', `margin:${top} auto ${gap} ${x}px`)
    else wrap.push('display:table', `margin:${top} ${a.align === 'left' ? '0' : 'auto'} ${gap} ${a.align === 'right' ? '0' : 'auto'}`)
  } else {
    wrap.push('display:inline-block', 'vertical-align:bottom')
  }
  const clip = shapeClipCss(a.shape, box, a.radius)
  if (clip !== 'none') img.push(`clip-path:${clip}`)
  const sh = SHADOW[a.shadow || 'none']
  if (sh && withFilter) wrap.push(`filter:drop-shadow(0 ${sh.y}px ${sh.blur / 2}px rgba(0,0,0,${sh.alpha}))`)
  return { wrap: wrap.join(';'), img: img.join(';') }
}

/** Styles of the shadow layer (outer: blur + offset; inner: the shape filled with the shadow colour). */
export function shadowLayerStyles(a: ImgAttrs, box: { w: number; h: number }) {
  const sh = SHADOW[a.shadow || 'none']
  if (!sh) return null
  const clip = shapeClipCss(a.shape, box, a.radius)
  return {
    outer: `position:absolute;left:0;top:0;width:${box.w}px;height:${box.h}px;transform:translateY(${sh.y}px);filter:blur(${sh.blur / 2}px);pointer-events:none;z-index:0`,
    inner: `display:block;width:100%;height:100%;background:rgba(0,0,0,${Math.min(1, sh.alpha * 1.25)})${clip !== 'none' ? `;clip-path:${clip}` : ''}`,
  }
}

// ───────────── node view ─────────────
interface DropTarget {
  pos: number
  attrs: Pick<ImgAttrs, 'x' | 'align' | 'y'>
  /** Where the picture's top should end up (px from the top of the editor), to correct `y` after the move. */
  wantTop?: number
  /** Where the dashed drop outline is drawn (client px). */
  preview: { left: number; top: number }
}

class PictureView implements NodeView {
  dom: HTMLElement
  img: HTMLImageElement
  private shadow: HTMLElement
  private node: PMNode
  private natural: { w: number; h: number } | undefined
  private panning = false
  private radiusHandle: HTMLElement

  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.node = node
    this.dom = document.createElement('span')
    this.dom.className = 'wpic'
    this.dom.contentEditable = 'false'
    this.shadow = document.createElement('span')
    this.shadow.className = 'wpic-shadow'
    this.shadow.appendChild(document.createElement('span'))
    this.dom.appendChild(this.shadow)
    this.img = document.createElement('img')
    this.img.draggable = false
    this.img.addEventListener('load', () => {
      this.natural = { w: this.img.naturalWidth, h: this.img.naturalHeight }
      this.render()
    })
    this.dom.appendChild(this.img)
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const h = document.createElement('span')
      h.className = `wpic-handle ${corner}`
      h.addEventListener('pointerdown', (e) => this.resize(e, corner))
      this.dom.appendChild(h)
    }
    // Corner-radius handle (only for «Στρογγυλεμένο»): drag it diagonally, like Canva.
    this.radiusHandle = document.createElement('span')
    this.radiusHandle.className = 'wpic-radius'
    this.radiusHandle.appendChild(document.createElement('span')).className = 'wpic-radius-tip'
    this.radiusHandle.addEventListener('pointerdown', (e) => this.dragRadius(e))
    this.dom.appendChild(this.radiusHandle)
    const hint = document.createElement('span')
    hint.className = 'wpic-pan-hint'
    this.dom.appendChild(hint)
    this.labels()
    this.offLang = onLangChange(() => this.labels())
    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault()
      // Keep the picture selected (so its ribbon tab stays open) while panning.
      const pos = this.getPos()
      if (pos != null) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
      this.setPanning(!this.panning)
    })
    this.dom.addEventListener('pointerdown', (e) => (this.panning ? this.pan(e) : this.drag(e)))
    this.render()
  }

  private get attrs() { return this.node.attrs as ImgAttrs }

  private offLang: () => void
  /** Tooltips in the UI language (re-applied when the language changes). */
  private labels() {
    this.radiusHandle.title = t('pic.radiusTitle')
    ;(this.dom.querySelector('.wpic-pan-hint') as HTMLElement).textContent = t('pic.panHint')
  }
  destroy() { this.offLang() }

  private render() {
    const a = this.attrs
    const box = displaySize(a, this.natural)
    // Shapes are redrawn at their exact size, so outlines never stretch.
    const src = a.vshape ? shapeSrc(a.vshape, box.w, box.h) : a.src
    if (this.img.getAttribute('src') !== src) this.img.src = src
    this.img.alt = a.alt || ''
    this.dom.classList.toggle('wshape', !!a.vshape)
    const st = pictureStyles(a, box)
    this.dom.setAttribute('style', st.wrap)
    this.img.setAttribute('style', `${st.img};position:relative;z-index:1`)
    const sl = shadowLayerStyles(a, box)
    this.shadow.style.display = sl ? '' : 'none'
    if (sl) {
      this.shadow.setAttribute('style', sl.outer)
      ;(this.shadow.firstChild as HTMLElement).setAttribute('style', sl.inner)
    }
    this.dom.dataset.wrap = a.wrap || 'inline'
    this.placeRadiusHandle(box, radiusPx(a.radius, box))
  }

  /** The handle sits on the diagonal, inside the top-left corner, at the radius distance. */
  private placeRadiusHandle(box: { w: number; h: number }, r: number) {
    const rounded = this.attrs.shape === 'rounded'
    this.dom.classList.toggle('rounded', rounded)
    if (!rounded) return
    const d = Math.max(16, Math.min(r, Math.min(box.w, box.h) / 2))
    this.radiusHandle.style.left = `${d}px`
    this.radiusHandle.style.top = `${d}px`
  }

  private dragRadius(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const a = this.attrs
    const box = displaySize(a, this.natural)
    const minSide = Math.min(box.w, box.h) || 1
    const zoom = this.dom.getBoundingClientRect().width / (this.dom.offsetWidth || 1) || 1
    const x0 = e.clientX, y0 = e.clientY
    const r0 = radiusPx(a.radius, box)
    const tip = this.radiusHandle.firstChild as HTMLElement
    this.dom.classList.add('radius-drag')
    const calc = (ev: PointerEvent) => {
      // Project the drag onto the corner's diagonal: down-right = rounder.
      const along = ((ev.clientX - x0) + (ev.clientY - y0)) / 2 / zoom
      return clampRadius(((r0 + along) / minSide) * 100)
    }
    const show = (pct: number) => {
      const clip = shapeClipCss('rounded', box, pct)
      this.img.style.clipPath = clip
      ;(this.shadow.firstChild as HTMLElement).style.clipPath = clip
      this.placeRadiusHandle(box, radiusPx(pct, box))
      tip.textContent = formatRadius(pct)
    }
    show(clampRadius(a.radius))
    const move = (ev: PointerEvent) => show(calc(ev))
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      this.dom.classList.remove('radius-drag')
      this.setAttrs({ radius: calc(ev) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  private setAttrs(patch: Partial<ImgAttrs>) {
    const pos = this.getPos()
    if (pos == null) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch })
    // Keep the picture selected so its ribbon tab stays open after a drag.
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
  }

  private setPanning(on: boolean) {
    const canPan = !!aspectValue(this.attrs.shape === 'circle' ? '1:1' : this.attrs.aspect) || this.attrs.shape !== 'rect'
    this.panning = on && canPan
    this.dom.classList.toggle('panning', this.panning)
    if (this.panning) {
      const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') { this.setPanning(false); document.removeEventListener('keydown', esc, true) } }
      document.addEventListener('keydown', esc, true)
    }
  }

  private pan(e: PointerEvent) {
    if (!this.panning || (e.target as HTMLElement).closest('.wpic-handle, .wpic-radius')) return
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX, y0 = e.clientY
    const { focusX: fx, focusY: fy } = this.attrs
    const r = this.img.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      // Dragging the picture right reveals its left part → focus moves left.
      const nx = Math.max(0, Math.min(100, fx - ((ev.clientX - x0) / r.width) * 100))
      const ny = Math.max(0, Math.min(100, fy - ((ev.clientY - y0) / r.height) * 100))
      this.img.style.objectPosition = `${nx}% ${ny}%`
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const nx = Math.round(Math.max(0, Math.min(100, fx - ((ev.clientX - x0) / r.width) * 100)))
      const ny = Math.round(Math.max(0, Math.min(100, fy - ((ev.clientY - y0) / r.height) * 100)))
      this.setAttrs({ focusX: nx, focusY: ny })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * Press selects the picture; dragging moves it. The drop point picks the line the
   * picture's top lands on (it's anchored at that line's start) and its horizontal spot.
   * On touch, the first tap only selects, so a swipe over a picture still scrolls.
   */
  private drag(e: PointerEvent) {
    if (e.button !== 0 || !this.view.editable || (e.target as HTMLElement).closest('.wpic-handle, .wpic-radius')) return
    const pos = this.getPos()
    if (pos == null) return
    const wasSelected = this.dom.classList.contains('selected')
    e.preventDefault()
    this.view.focus()
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    if (e.pointerType === 'touch' && !wasSelected) return
    const x0 = e.clientX, y0 = e.clientY
    const r0 = this.dom.getBoundingClientRect()
    const zoom = r0.width / (this.dom.offsetWidth || 1) || 1
    const marker = document.createElement('div')
    marker.className = 'wpic-drop'
    let moving = false
    let target: DropTarget | null = null
    const move = (ev: PointerEvent) => {
      if (!moving) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
        moving = true
        this.dom.classList.add('moving')
        document.body.appendChild(marker)
      }
      const dx = ev.clientX - x0, dy = ev.clientY - y0
      this.dom.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`
      target = this.dropTarget(r0.left + dx, r0.top + dy, r0.width, zoom)
      marker.style.display = target ? '' : 'none'
      if (target) Object.assign(marker.style, { left: `${target.preview.left}px`, top: `${target.preview.top}px`, width: `${r0.width}px`, height: `${r0.height}px` })
    }
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      marker.remove()
      this.dom.classList.remove('moving')
      this.dom.style.transform = ''
      if (moving && target && ev.type === 'pointerup') this.moveTo(target)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  /** Where a picture whose top-left corner is at (left, top) (client px) would land. */
  private dropTarget(left: number, top: number, width: number, zoom: number): DropTarget | null {
    const view = this.view
    const edRect = view.dom.getBoundingClientRect()
    const probeX = Math.max(edRect.left + 2, Math.min(edRect.right - 2, left + width / 2))
    const probeY = Math.max(edRect.top + 2, Math.min(edRect.bottom - 2, top + 2))
    const hit = view.posAtCoords({ left: probeX, top: probeY })
    if (!hit) return null
    const $hit = view.state.doc.resolve(hit.pos)
    if (!$hit.parent.inlineContent || $hit.depth === 0) return null
    const block = view.nodeDOM($hit.before()) as HTMLElement | null
    if (!block || block.nodeType !== 1) return null
    const cs = getComputedStyle(block)
    const br = block.getBoundingClientRect()
    const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)
    const textLeft = br.left + padL * zoom
    const textW = block.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const w = width / zoom
    const a = this.attrs
    // Anchor: the start of the line under the probe (an in-line picture goes exactly there).
    let pos = hit.pos
    if (a.wrap) {
      const lineStart = view.posAtCoords({ left: textLeft + 1, top: probeY })
      if (lineStart && lineStart.pos >= $hit.start() && lineStart.pos <= $hit.end()) pos = lineStart.pos
      // Below the block's last line (e.g. the empty rest of the page): anchor at its end.
      try { if (top > view.coordsAtPos($hit.end()).bottom) pos = $hit.end() } catch { /* keep the line */ }
    }
    // Horizontal spot, snapped to the left / centre / right when close.
    const maxX = Math.max(0, textW - w)
    let x: number | null = Math.max(0, Math.min(maxX, (left - textLeft) / zoom))
    let align: ImgAlign = a.align
    const SNAP = 10
    if (a.wrap === 'square') {
      align = x + w / 2 <= textW / 2 ? 'left' : 'right'
      if (x < SNAP) { x = null; align = 'left' } else if (maxX - x < SNAP) { x = null; align = 'right' }
    } else if (a.wrap === 'topBottom') {
      align = 'left'
      if (x < SNAP) x = null
      else if (maxX - x < SNAP) { x = null; align = 'right' }
      else if (Math.abs(x - maxX / 2) < SNAP) { x = null; align = 'center' }
    } else x = a.x
    if (x != null) x = Math.round(x)
    const px = x ?? (align === 'left' ? 0 : align === 'right' ? maxX : maxX / 2)
    if (!a.wrap) {
      let lineTop = top
      try { lineTop = view.coordsAtPos(pos).top } catch { /* keep the pointer's y */ }
      return { pos, attrs: { x, align, y: null }, preview: { left, top: lineTop } }
    }
    // Free vertical spot: the picture lands exactly where it is dropped (not on the line's top).
    let lineTop = top
    try { lineTop = view.coordsAtPos(pos).top } catch { /* keep the pointer's y */ }
    const y = Math.max(0, Math.round((top - lineTop) / zoom))
    return {
      pos, attrs: { x, align, y: y < 4 ? null : y },
      wantTop: (Math.max(top, edRect.top) - edRect.top) / zoom,
      preview: { left: textLeft + px * zoom, top: Math.max(top, edRect.top) },
    }
  }

  private moveTo(target: DropTarget) {
    this.place(target)
    if (target.wantTop != null) PictureView.settle(this.view, target.wantTop)
  }

  /**
   * After a move the text reflows (the picture left its old spot, wrapped lines re-wrap), so the
   * estimated `y` can be off: measure where the picture really landed and nudge `y` to match.
   */
  private static settle(view: EditorView, wantTop: number, tries = 3) {
    requestAnimationFrame(() => {
      const sel = view.state.selection
      if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return
      const dom = view.nodeDOM(sel.from) as HTMLElement | null
      if (!dom || dom.nodeType !== 1) return
      const ed = view.dom.getBoundingClientRect()
      const zoom = ed.width / ((view.dom as HTMLElement).offsetWidth || 1) || 1
      const now = (dom.getBoundingClientRect().top - ed.top) / zoom
      const d = Math.round(wantTop - now)
      if (Math.abs(d) < 2) return
      const y0 = Number(sel.node.attrs.y) || 0
      const y = Math.max(0, y0 + d)
      if (y === y0) return
      const tr = view.state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, y: y < 4 ? null : y })
      view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, sel.from)))
      if (tries > 1) PictureView.settle(view, wantTop, tries - 1)
    })
  }

  private place(target: DropTarget) {
    const from = this.getPos()
    if (from == null) return
    const { state } = this.view
    const attrs = { ...this.node.attrs, ...target.attrs }
    let tr = state.tr
    if (target.pos === from || target.pos === from + 1) {
      tr = tr.setNodeMarkup(from, undefined, attrs)
      this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, from)))
      return
    }
    const $from = state.doc.resolve(from)
    const $to = state.doc.resolve(target.pos)
    // A picture that was alone in its paragraph takes the (now empty) paragraph with it.
    const alone = $from.parent.type.name === 'paragraph' && $from.parent.childCount === 1 && $from.node(-1).childCount > 1 && !$to.sameParent($from)
    if (alone) tr.delete($from.before(), $from.after())
    else tr.delete(from, from + 1)
    const to = tr.mapping.map(target.pos)
    tr.insert(to, this.node.type.create(attrs))
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, to)))
  }

  private resize(e: PointerEvent, corner: string) {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const start = displaySize(this.attrs, this.natural)
    const zoom = this.dom.getBoundingClientRect().width / (this.dom.offsetWidth || 1) || 1
    const colW = (this.view.dom as HTMLElement).clientWidth
    const dir = corner.includes('w') ? -1 : 1
    const ratio = start.h / start.w
    const calc = (ev: PointerEvent) => Math.round(Math.max(24, Math.min(colW, start.w + (dir * (ev.clientX - x0)) / zoom)))
    // Shapes resize freely (Shift keeps the proportions); pictures always keep theirs.
    const vs = this.attrs.vshape
    const y0 = e.clientY
    const dirY = corner.includes('n') ? -1 : 1
    const calcH = (ev: PointerEvent, w: number) => {
      if (!vs || ev.shiftKey) return Math.round(w * ratio)
      return Math.round(Math.max(isLine(vs.k) ? 12 : 16, start.h + (dirY * (ev.clientY - y0)) / zoom))
    }
    const move = (ev: PointerEvent) => {
      const w = calc(ev)
      const h = calcH(ev, w)
      this.img.style.width = `${w}px`
      this.img.style.height = `${h}px`
      if (vs) this.img.src = shapeSrc(vs, w, h)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const w = calc(ev)
      const h = calcH(ev, w)
      this.setAttrs(vs ? { width: w, height: h, src: shapeSrc(vs, w, h) } : { width: w, height: Math.round(w * ratio) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  selectNode() { this.dom.classList.add('selected') }
  deselectNode() {
    this.dom.classList.remove('selected')
    // Defer: a re-selection of this same picture (dblclick) must not cancel panning.
    setTimeout(() => { if (!this.dom.classList.contains('selected')) this.setPanning(false) }, 0)
  }
  stopEvent(e: Event) {
    const t = e.target as HTMLElement
    // Pointer presses are ours (select / move / pan / resize), not ProseMirror's.
    return this.panning || !!t.closest?.('.wpic-handle, .wpic-radius') || e.type === 'dblclick' || e.type === 'mousedown' || e.type === 'dragstart'
  }
  ignoreMutation() { return true }
}

const attr = (name: string, def: unknown, parse?: (v: string) => unknown) => ({
  default: def,
  parseHTML: (el: HTMLElement) => {
    const v = el.getAttribute(`data-${name}`)
    return v == null ? def : parse ? parse(v) : v
  },
  renderHTML: () => ({}),
})

export const Picture = Image.extend({
  // Moving is our own pointer drag (PictureView.drag), which can drop at any line and
  // any horizontal spot; the browser's native drag could only drop into the text.
  draggable: false,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => { const n = parseFloat(el.getAttribute('width') || (el as HTMLElement).style.width || ''); return Number.isFinite(n) ? n : null },
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: (el) => { const n = parseFloat(el.getAttribute('height') || (el as HTMLElement).style.height || ''); return Number.isFinite(n) ? n : null },
        renderHTML: () => ({}),
      },
      wrap: attr('wrap', null, (v) => (v === 'square' || v === 'topBottom' ? v : null)),
      align: attr('align', 'center'),
      shape: attr('shape', 'rect'),
      aspect: attr('aspect', null, (v) => v || null),
      focusX: attr('focus-x', 50, Number),
      focusY: attr('focus-y', 50, Number),
      shadow: attr('shadow', 'none'),
      radius: attr('radius', DEFAULT_RADIUS, clampRadius),
      x: attr('x', null, (v) => (v === '' || !Number.isFinite(Number(v)) ? null : Number(v))),
      y: attr('y', null, (v) => (v === '' || !Number.isFinite(Number(v)) ? null : Number(v))),
      vshape: attr('vshape', null, parseVShape),
      // One style attribute for HTML export / clipboard, computed from all of the above.
      _style: {
        default: null,
        parseHTML: () => null,
        renderHTML: (a: Record<string, any>) => {
          const box = displaySize(a as ImgAttrs)
          const st = pictureStyles(a as ImgAttrs, box, true)
          const out: Record<string, string> = { style: `${st.wrap};${st.img}`, width: String(box.w), height: String(box.h) }
          if (a.wrap) out['data-wrap'] = a.wrap
          if (a.align !== 'center') out['data-align'] = a.align
          if (a.shape !== 'rect') out['data-shape'] = a.shape
          if (a.aspect) out['data-aspect'] = a.aspect
          if (a.focusX !== 50) out['data-focus-x'] = String(a.focusX)
          if (a.focusY !== 50) out['data-focus-y'] = String(a.focusY)
          if (a.shadow !== 'none') out['data-shadow'] = a.shadow
          if (a.radius != null && a.radius !== DEFAULT_RADIUS) out['data-radius'] = String(a.radius)
          if (a.x != null) out['data-x'] = String(Math.round(a.x))
          if (a.y) out['data-y'] = String(Math.round(a.y))
          if (a.vshape) out['data-vshape'] = JSON.stringify(a.vshape)
          return out
        },
      },
    }
  },

  addNodeView() {
    return ({ node, view, getPos }) => new PictureView(node, view, getPos as () => number | undefined)
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      // Changing a selected picture's attributes (shape, shadow, wrap…) maps the node selection
      // to a text cursor, which would close the «Εικόνα» tab after every click. Keep it selected.
      new Plugin({
        key: new PluginKey('picture-keep-selection'),
        appendTransaction(trs, oldState, newState) {
          const old = oldState.selection
          if (!(old instanceof NodeSelection) || old.node.type.name !== 'image') return null
          if (newState.selection instanceof NodeSelection || !trs.some((tr) => tr.docChanged)) return null
          if (trs.some((tr) => tr.selectionSet && !tr.docChanged)) return null
          const pos = trs.reduce((p, tr) => tr.mapping.map(p), old.from)
          const node = newState.doc.nodeAt(pos)
          if (node?.type.name !== 'image') return null
          return newState.tr.setSelection(NodeSelection.create(newState.doc, pos))
        },
      }),
    ]
  },
}).configure({ inline: true, allowBase64: true, resize: false })

/** Is the picture "baked" (needs pixel processing for export)? */
export const needsBake = (a: ImgAttrs) => a.shape !== 'rect' || !!a.aspect || (a.shadow && a.shadow !== 'none')

/**
 * Render the picture exactly as displayed (crop, shape, shadow) into a PNG.
 * Returns the PNG plus its display size; the shadow adds padding around the box.
 */
export async function bakePicture(a: ImgAttrs, img: HTMLImageElement): Promise<{ dataUrl: string; w: number; h: number }> {
  const box = displaySize(a, { w: img.naturalWidth, h: img.naturalHeight })
  const sh = SHADOW[a.shadow || 'none']
  const pad = sh ? Math.ceil(sh.blur + sh.y) : 0
  // Render at the picture's native resolution (≥2×) for print quality.
  const k = Math.max(2, Math.min(4, img.naturalWidth / box.w))
  const c = document.createElement('canvas')
  c.width = Math.round((box.w + pad * 2) * k)
  c.height = Math.round((box.h + pad * 2) * k)
  const g = c.getContext('2d')!
  g.scale(k, k)
  const path = new Path2D()
  const x0 = pad, y0 = pad, W = box.w, H = box.h
  switch (a.shape) {
    case 'rounded': path.roundRect(x0, y0, W, H, radiusPx(a.radius, box)); break
    case 'circle': case 'ellipse': path.ellipse(x0 + W / 2, y0 + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2); break
    case 'hexagon': case 'diamond': case 'triangle': case 'star': {
      const pts = SHAPE_POLY[a.shape]!
      pts.forEach(([px, py], i) => (i ? path.lineTo(x0 + px * W, y0 + py * H) : path.moveTo(x0 + px * W, y0 + py * H)))
      path.closePath()
      break
    }
    default: path.rect(x0, y0, W, H)
  }
  if (sh) {
    g.save()
    g.shadowColor = `rgba(0,0,0,${sh.alpha})`
    g.shadowBlur = sh.blur
    g.shadowOffsetY = sh.y
    g.fillStyle = '#fff'
    g.fill(path)
    g.restore()
  }
  // object-fit: cover with focal point.
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s
  const dx = x0 + (W - dw) * (a.focusX / 100), dy = y0 + (H - dh) * (a.focusY / 100)
  g.save()
  g.clip(path)
  g.drawImage(img, dx, dy, dw, dh)
  g.restore()
  return { dataUrl: c.toDataURL('image/png'), w: box.w + pad * 2, h: box.h + pad * 2 }
}
