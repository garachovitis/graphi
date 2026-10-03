// Pictures. Deliberately simpler than Word: exactly two layouts —
//   • "topBottom" (Πάνω & κάτω): the picture sits on its own band, text above and below;
//     no text beside it.
//   • "square" (Τετράγωνη): the picture floats inside the text and the text wraps around
//     it on its wider side.
// Both are placed freely on a page and stay there whatever happens to the text (floats.ts):
// dragged anywhere inside a page's text area, never between pages; the ribbon's left / centre /
// right buttons align them horizontally (x = null).
// Plus Word's free crop (Περικοπή: the handles cut into any side, the cut-off part shows dimmed),
// shape crops (circle, rounded, hexagon…), aspect-ratio crops with a movable
// focal point (double-click to pan the picture inside its frame), and shadows.
// The «Στρογγυλεμένο» shape has an adjustable corner radius: drag the corner handle on
// the picture (Canva-style) or use the ribbon field.
// Exporters "bake" shape/crop/shadow into the image pixels so Word, LibreOffice and
// PDF show exactly what you see here.
import Image from '@tiptap/extension-image'
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { t, fmtNum, onLangChange, type Key } from '../i18n'
import { parseVShape, shapeSrc, isLine, fullSize, hasCrop, type VShape } from './shapes'
import { paginationConfig, relayoutNow } from './Pagination'
import { layoutStore } from './layoutStore'
import { anchorBlock, floatsPlugin, isPinned, nextUid, registerFloating, requestPlacement, unregisterFloating, type Floating, type Place } from './floats'

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

/** A free vertical offset below this (px) is drag / rounding noise: the picture sits on its line. */
export const MIN_Y = 4

const PT = 96 / 72
/** Space kept between a wrapped picture and the text around it, px (Word's "distance from text"). */
export const TEXT_DISTANCE: Record<ImgWrap, { top: number; bottom: number; side: number }> = {
  square: { top: 2 * PT, bottom: 4 * PT, side: 8 * PT },
  topBottom: { top: 8 * PT, bottom: 8 * PT, side: 0 },
}

/**
 * The side a square-wrapped picture at `x` (px from the left of a `textWidth` column) floats to:
 * the text wraps on its larger side (Word's "Largest only") — floats cannot wrap on both.
 */
export const squareSide = (x: number, width: number, textWidth: number): ImgAlign => (x + width / 2 <= textWidth / 2 ? 'left' : 'right')

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

/** Rotation in whole degrees, 0–359 (any number wraps round: -90 → 270). */
export const normRotate = (d: unknown) => { const n = Math.round(Number(d)); return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0 }

export function aspectValue(a: string | null | undefined): number | null {
  if (!a) return null
  const [w, h] = a.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : null
}

/** Cut-off share of the original picture on each side (0–0.95), like Word's <a:srcRect>. */
export type ImgCrop = { l: number; t: number; r: number; b: number }
export const hasImgCrop = (c?: ImgCrop | null): c is ImgCrop => !!c && c.l + c.t + c.r + c.b > 0.0005
export function parseImgCrop(v: unknown): ImgCrop | null {
  let o: any = v
  if (typeof v === 'string') { try { o = JSON.parse(v) } catch { return null } }
  if (!o || typeof o !== 'object') return null
  const f = (n: unknown) => { const x = Number(n); return Number.isFinite(x) ? Math.max(0, Math.min(0.95, x)) : 0 }
  const c = { l: f(o.l), t: f(o.t), r: f(o.r), b: f(o.b) }
  return hasImgCrop(c) && c.l + c.r < 0.98 && c.t + c.b < 0.98 ? c : null
}
/** The part of the original picture that is shown (px of the original). */
export function croppedNatural(a: Pick<ImgAttrs, 'crop'>, natural: { w: number; h: number }) {
  const c = hasImgCrop(a.crop) ? a.crop : null
  return c ? { w: natural.w * (1 - c.l - c.r), h: natural.h * (1 - c.t - c.b) } : natural
}
/**
 * Where the whole original picture is drawn relative to the box (px): its cropped part scaled to
 * cover the box (an aspect / shape crop cuts it further, at the focal point).
 */
export function picRect(a: ImgAttrs, box: { w: number; h: number }, natural: { w: number; h: number }) {
  const c = hasImgCrop(a.crop) ? a.crop : { l: 0, t: 0, r: 0, b: 0 }
  const shown = croppedNatural(a, natural)
  const s = Math.max(box.w / shown.w, box.h / shown.h)
  const ox = ((box.w - shown.w * s) * a.focusX) / 100, oy = ((box.h - shown.h * s) * a.focusY) / 100
  return { x: ox - c.l * natural.w * s, y: oy - c.t * natural.h * s, w: natural.w * s, h: natural.h * s }
}

export interface ImgAttrs {
  src: string; alt: string | null; title: string | null; width: number | null; height: number | null
  wrap: ImgWrap | null; align: ImgAlign; shape: ImgShape; aspect: string | null; focusX: number; focusY: number; shadow: ImgShadow
  radius: number
  /** Free horizontal position: px from the left of the page's text area (null = use `align`);
   *  not pinned yet: from the left of the paragraph's text box. */
  x: number | null
  /** Free vertical position: px below the top of the page's text area; not pinned yet: below the
   *  line the picture is anchored on (0 = on that line). */
  y?: number | null
  /** Page a wrapped picture is pinned to (0-based); null = not pinned yet, -1 = its anchor's page (floats.ts). */
  page?: number | null
  /** Set when this "picture" is a shape (Insert ▸ Shapes); `src` is then drawn from it. */
  vshape?: VShape | null
  /** Clockwise rotation about the centre, degrees (0–359). Text wraps around the unrotated box, as in Word. */
  rotate?: number
  /** Free crop (Περικοπή); null = the whole picture. */
  crop?: ImgCrop | null
}

/** Displayed box size (px) given attributes. */
export function displaySize(a: ImgAttrs, natural?: { w: number; h: number }): { w: number; h: number } {
  if (natural && !a.vshape) natural = croppedNatural(a, natural)
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
 * `lineHeight`: the anchor paragraph's line height in px, when known (the editor measures it).
 */
export function pictureStyles(a: ImgAttrs, box: { w: number; h: number }, o: { withFilter?: boolean; lineHeight?: number; place?: Place | null } = {}) {
  const wrap: string[] = []
  const img: string[] = [`width:${box.w}px`, `height:${box.h}px`, 'object-fit:cover', `object-position:${a.focusX}% ${a.focusY}%`]
  // `place`: where floats.ts puts a pinned picture, from the line it is drawn beside (may be < 0).
  const x = o.place ? o.place.x : a.x == null ? null : Math.max(0, Math.round(a.x))
  const y = o.place ? o.place.y : a.wrap && a.y ? Math.max(0, Math.round(a.y)) : 0
  const px = (n: number) => `${+n.toFixed(3)}px`
  if (o.place?.free && a.wrap) {
    // Drawn on its spot without moving any text: a float whose margin box is empty.
    const top = TEXT_DISTANCE[a.wrap].top + y, left = x ?? 0
    wrap.push('float:left', `margin:${px(top)} ${px(-(left + box.w))} ${px(-(top + box.h))} ${px(left)}`)
  } else if (a.wrap === 'square') {
    const d = TEXT_DISTANCE.square
    const side = a.align === 'right' ? 'right' : 'left'
    // A right float at `x` keeps its distance to the right edge, so text still wraps on the left.
    const edge = x == null ? '0' : side === 'left' ? px(x) : `max(0px, calc(100% - ${px(x + box.w)}))`
    const top = px(d.top + y)
    wrap.push(`float:${side}`, side === 'left' ? `margin:${top} ${px(d.side)} ${px(d.bottom)} ${edge}` : `margin:${top} ${edge} ${px(d.bottom)} ${px(d.side)}`)
    // Moved down by `y`, text runs full width above the picture and wraps only beside it: the float
    // area (shape-outside) starts a line above the picture, because a line is shortened by what the
    // area covers at the line's top. Chromium ignores shape-outside on the line the float sits in,
    // so a picture whose top is inside that line (y < one line) has no shape: its whole margin box,
    // from that line down, is the float area.
    if (o.lineHeight != null) {
      if (y >= o.lineHeight) wrap.push(`shape-outside:inset(${Math.round(y - o.lineHeight)}px 0 0 0)`)
    } else if (y) {
      // Not laid out yet (HTML export): let CSS resolve the line (`lh` of the paragraph's line height).
      wrap.push('line-height:inherit', `shape-outside:inset(max(0px, calc(${y}px - 1lh)) 0 0 0)`)
    }
  } else if (a.wrap === 'topBottom') {
    const d = TEXT_DISTANCE.topBottom
    const top = px(d.top + y), bottom = px(d.bottom)
    // A block of the picture's width (not a table: that would be pushed aside by a square-wrapped
    // picture beside it; a block may overlap one, and the text below still wraps around it).
    wrap.push('display:block', `width:${box.w}px`)
    if (x != null) wrap.push(`margin:${top} auto ${bottom} ${px(x)}`)
    // margin: top right bottom left — the side it is aligned to gets 0, the other(s) auto.
    else wrap.push(`margin:${top} ${a.align === 'right' ? '0' : 'auto'} ${bottom} ${a.align === 'left' ? '0' : 'auto'}`)
  } else {
    wrap.push('display:inline-block', 'vertical-align:bottom')
  }
  const clip = shapeClipCss(a.shape, box, a.radius)
  if (clip !== 'none') img.push(`clip-path:${clip}`)
  const c = hasImgCrop(a.crop) && !a.vshape ? a.crop : null
  if (c) img.push(`object-view-box:inset(${[c.t, c.r, c.b, c.l].map((v) => `${+(v * 100).toFixed(3)}%`).join(' ')})`)
  // The `rotate` property, not `transform`: dragging moves the picture with a transform of its own.
  if (a.rotate) wrap.push(`rotate:${normRotate(a.rotate)}deg`)
  const sh = SHADOW[a.shadow || 'none']
  if (sh && o.withFilter) wrap.push(`filter:drop-shadow(0 ${sh.y}px ${sh.blur / 2}px rgba(0,0,0,${sh.alpha}))`)
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

// ───────────── drop geometry ─────────────
const coordsAt = (view: EditorView, pos: number, side = 1) => { try { return view.coordsAtPos(pos, side) } catch { return null } }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v))

/** Left edge (client px) and width (CSS px) of the text box of the textblock containing `pos`. */
function textBox(view: EditorView, pos: number, zoom: number): { left: number; width: number } | null {
  const $pos = view.state.doc.resolve(pos)
  const el = view.nodeDOM($pos.before()) as HTMLElement | null
  if (!el || el.nodeType !== 1) return null
  const cs = getComputedStyle(el)
  return {
    left: el.getBoundingClientRect().left + (parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)) * zoom,
    width: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
  }
}

/** Start of the visual line of textblock `$in` that is at client `y`, or null. */
function lineStartAt(view: EditorView, $in: ResolvedPos, y: number, zoom: number): number | null {
  const box = textBox(view, $in.pos, zoom)
  const p = box && view.posAtCoords({ left: box.left + 1, top: y })?.pos
  return p != null && p >= $in.start() && p <= $in.end() ? p : null
}

/** Moves the picture at `from` to `to` (same spot: only new `attrs`), keeping it selected. */
function movePicture(view: EditorView, from: number, to: number, attrs: Record<string, unknown>) {
  const { state } = view
  const tr = state.tr
  if (to === from || to === from + 1) {
    tr.setNodeMarkup(from, undefined, attrs)
  } else {
    const node = state.doc.nodeAt(from)!
    const $from = state.doc.resolve(from)
    // A picture that was alone in its paragraph takes the (now empty) paragraph with it.
    const alone = $from.parent.type.name === 'paragraph' && $from.parent.childCount === 1 && $from.node(-1).childCount > 1 && !state.doc.resolve(to).sameParent($from)
    if (alone) tr.delete($from.before(), $from.after())
    else tr.delete(from, from + 1)
    from = tr.mapping.map(to)
    tr.insert(from, node.type.create(attrs))
  }
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, from)))
}

// ───────────── node view ─────────────
/** Where a dragged picture lands: a spot on a page (a pinned picture), or a line (in-line pictures, Web Layout). */
type Drop = ({ page: number; x: number; y: number } | { pos: number; attrs: Partial<ImgAttrs> }) & {
  /** Where the dashed drop outline is drawn (client px). */
  preview: { left: number; top: number }
}

// Crop mode (Εικόνα / Μορφή σχήματος ▸ Περικοπή): while on, the selected picture's or shape's handles crop instead of resize.
let cropMode = false
const cropListeners = new Set<() => void>()
export const isShapeCropMode = () => cropMode
export function setShapeCropMode(on: boolean) {
  if (on === cropMode) return
  cropMode = on
  cropListeners.forEach((f) => f())
}
export function onCropMode(f: () => void) { cropListeners.add(f); return () => { cropListeners.delete(f) } }

/** Attributes that move or resize a picture: a change places it again. */
const PLACING = ['page', 'x', 'y', 'wrap', 'align', 'width', 'height', 'aspect', 'shape', 'vshape', 'crop']

class PictureView implements NodeView, Floating {
  /** In-line: the picture itself. Wrapped: only the anchor (empty); the picture is drawn by a carrier (floats.ts). */
  dom: HTMLElement
  /** The picture as drawn (`.wpic`). */
  el: HTMLElement
  /** The box the picture is shown in: cuts it to its crop and shape. */
  private frame: HTMLElement
  img: HTMLImageElement
  /** While cropping: the whole picture, dimmed, around the part that is kept (as in Word). */
  private full: HTMLImageElement
  readonly uid = nextUid()
  place: Place | null = null
  private readonly wrapped: boolean
  private shadow: HTMLElement
  private natural: { w: number; h: number } | undefined
  private panning = false
  private radiusHandle: HTMLElement
  private rotateHandle: HTMLElement

  constructor(public node: PMNode, readonly view: EditorView, private readonly pos: () => number | undefined) {
    this.wrapped = !!node.attrs.wrap
    this.el = document.createElement('span')
    this.el.className = 'wpic'
    this.el.contentEditable = 'false'
    this.shadow = document.createElement('span')
    this.shadow.className = 'wpic-shadow'
    this.shadow.appendChild(document.createElement('span'))
    this.el.appendChild(this.shadow)
    this.full = document.createElement('img')
    this.full.className = 'wpic-full'
    this.full.draggable = false
    this.full.alt = ''
    this.el.appendChild(this.full)
    this.frame = document.createElement('span')
    this.frame.className = 'wpic-frame'
    this.img = document.createElement('img')
    this.img.draggable = false
    this.img.addEventListener('load', () => {
      this.natural = { w: this.img.naturalWidth, h: this.img.naturalHeight }
      this.render()
      if (this.wrapped) requestPlacement(this.view)
    })
    this.frame.appendChild(this.img)
    this.el.appendChild(this.frame)
    // Side handles (n, e, s, w) only show on shapes and while cropping: pictures always keep their proportions.
    for (const corner of ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w']) {
      const h = document.createElement('span')
      h.className = `wpic-handle ${corner}`
      h.addEventListener('pointerdown', (e) => this.resize(e, corner))
      this.el.appendChild(h)
    }
    // Corner-radius handle (only for «Στρογγυλεμένο»): drag it diagonally, like Canva.
    this.radiusHandle = document.createElement('span')
    this.radiusHandle.className = 'wpic-radius'
    this.radiusHandle.appendChild(document.createElement('span')).className = 'wpic-radius-tip'
    this.radiusHandle.addEventListener('pointerdown', (e) => this.dragRadius(e))
    this.el.appendChild(this.radiusHandle)
    // Rotation handle above the top edge, as in Word: drag round the centre (Shift: 15° steps).
    this.rotateHandle = document.createElement('span')
    this.rotateHandle.className = 'wpic-rotate'
    this.rotateHandle.appendChild(document.createElement('span')).className = 'wpic-radius-tip'
    this.rotateHandle.addEventListener('pointerdown', (e) => this.dragRotate(e))
    this.el.appendChild(this.rotateHandle)
    const hint = document.createElement('span')
    hint.className = 'wpic-pan-hint'
    this.el.appendChild(hint)
    this.labels()
    this.offLang = onLangChange(() => this.labels())
    this.offCrop = onCropMode(() => this.render())
    this.el.addEventListener('dblclick', (e) => {
      e.preventDefault()
      // Keep the picture selected (so its ribbon tab stays open) while panning.
      const pos = this.getPos()
      if (pos != null) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
      this.setPanning(!this.panning)
    })
    this.el.addEventListener('pointerdown', (e) => (this.panning ? this.pan(e) : this.drag(e)))
    if (this.wrapped) {
      this.dom = document.createElement('span')
      this.dom.className = 'wpic-anchor'
      this.dom.contentEditable = 'false'
      registerFloating(this)
    } else this.dom = this.el
    this.render()
    // Once ProseMirror has put the picture in its paragraph, render again with that paragraph's line height.
    queueMicrotask(() => this.render())
  }

  getPos() { return this.pos() }
  private get attrs() { return this.node.attrs as ImgAttrs }
  box() { return displaySize(this.attrs, this.natural) }
  dist() { return TEXT_DISTANCE[this.attrs.wrap || 'topBottom'] }

  private offLang: () => void
  /** Tooltips in the UI language (re-applied when the language changes). */
  private labels() {
    this.radiusHandle.title = t('pic.radiusTitle')
    this.rotateHandle.title = t('pic.rotateTitle')
    ;(this.el.querySelector('.wpic-pan-hint') as HTMLElement).textContent = t('pic.panHint')
  }
  private offCrop: () => void
  destroy() {
    this.offLang()
    this.offCrop()
    if (this.wrapped) { unregisterFloating(this); this.el.remove() }
  }

  render() {
    const a = this.attrs
    const box = displaySize(a, this.natural)
    // Shapes are redrawn at their exact size, so outlines never stretch.
    const src = a.vshape ? shapeSrc(a.vshape, box.w, box.h) : a.src
    if (this.img.getAttribute('src') !== src) this.img.src = src
    this.img.alt = a.alt || ''
    this.el.classList.toggle('wshape', !!a.vshape)
    this.el.classList.toggle('cropping', this.cropping())
    const st = pictureStyles(a, box, { lineHeight: this.lineHeight(), place: this.wrapped ? this.place : null })
    this.el.setAttribute('style', st.wrap)
    this.drawImg(a, box)
    const sl = shadowLayerStyles(a, box)
    this.shadow.style.display = sl ? '' : 'none'
    if (sl) {
      this.shadow.setAttribute('style', sl.outer)
      ;(this.shadow.firstChild as HTMLElement).setAttribute('style', sl.inner)
    }
    this.el.dataset.wrap = a.wrap || 'inline'
    this.el.dataset.pinned = this.wrapped && isPinned(this.node) ? '1' : ''
    this.el.dataset.free = this.wrapped && this.place?.free ? '1' : ''
    this.placeRadiusHandle(box, radiusPx(a.radius, box))
  }

  private cropping() { const v = this.attrs.vshape; return cropMode && (!v || !isLine(v.k)) }

  /** Sizes the frame to `box` and draws the picture in it (and, while cropping, the whole picture around it). */
  private drawImg(a: ImgAttrs, box: { w: number; h: number }, stretch = false) {
    const clip = shapeClipCss(a.shape, box, a.radius)
    this.frame.setAttribute('style', `width:${box.w}px;height:${box.h}px${clip !== 'none' ? `;clip-path:${clip}` : ''}`)
    const px = (n: number) => `${+n.toFixed(2)}px`
    // Shapes are drawn at their box size; a picture not loaded yet simply covers its box.
    const r = !a.vshape && this.natural ? picRect(a, box, this.natural) : null
    this.img.setAttribute('style', r ? `left:${px(r.x)};top:${px(r.y)};width:${px(r.w)};height:${px(r.h)}`
      : `width:100%;height:100%;object-fit:${stretch ? 'fill' : 'cover'};object-position:${a.focusX}% ${a.focusY}%`)
    const showFull = !!r && this.cropping()
    if (showFull && this.full.getAttribute('src') !== a.src) this.full.src = a.src
    this.full.setAttribute('style', showFull ? `left:${px(r!.x)};top:${px(r!.y)};width:${px(r!.w)};height:${px(r!.h)}` : 'display:none')
  }

  /** Line height (px) of the paragraph the picture is drawn in, once it is in the document. */
  private lineHeight(): number | undefined {
    const p = this.el.closest('p, h1, h2, h3, h4, h5, h6, pre, li') ?? this.el.parentElement
    if (!p) return undefined
    const cs = getComputedStyle(p)
    const lh = parseFloat(cs.lineHeight)
    return Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.2 // 'normal'
  }

  /** The handle sits on the diagonal, inside the top-left corner, at the radius distance. */
  private placeRadiusHandle(box: { w: number; h: number }, r: number) {
    const rounded = this.attrs.shape === 'rounded'
    this.el.classList.toggle('rounded', rounded)
    if (!rounded) return
    const d = Math.max(16, Math.min(r, Math.min(box.w, box.h) / 2))
    this.radiusHandle.style.left = `${d}px`
    this.radiusHandle.style.top = `${d}px`
  }

  /** The page's zoom (from the editor: a rotated picture's own rect is larger than its box). */
  private zoom() { const d = this.view.dom as HTMLElement; return d.getBoundingClientRect().width / (d.offsetWidth || 1) || 1 }

  private dragRadius(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const a = this.attrs
    const box = displaySize(a, this.natural)
    const minSide = Math.min(box.w, box.h) || 1
    const zoom = this.zoom()
    const x0 = e.clientX, y0 = e.clientY
    const r0 = radiusPx(a.radius, box)
    const tip = this.radiusHandle.firstChild as HTMLElement
    this.el.classList.add('radius-drag')
    const calc = (ev: PointerEvent) => {
      // Project the drag onto the corner's diagonal: down-right = rounder.
      const along = ((ev.clientX - x0) + (ev.clientY - y0)) / 2 / zoom
      return clampRadius(((r0 + along) / minSide) * 100)
    }
    const show = (pct: number) => {
      const clip = shapeClipCss('rounded', box, pct)
      this.frame.style.clipPath = clip
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
      this.el.classList.remove('radius-drag')
      this.setAttrs({ radius: calc(ev) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  private dragRotate(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    // The centre doesn't move while rotating, and the rotated box's bounding rect has the same centre.
    const r = this.el.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const tip = this.rotateHandle.firstChild as HTMLElement
    this.el.classList.add('rotate-drag')
    const calc = (ev: PointerEvent) => {
      // 0° = handle straight above the centre.
      const deg = (Math.atan2(ev.clientX - cx, cy - ev.clientY) * 180) / Math.PI
      return normRotate(ev.shiftKey ? Math.round(deg / 15) * 15 : deg)
    }
    const show = (d: number) => { this.el.style.rotate = `${d}deg`; tip.textContent = `${d}°` }
    show(normRotate(this.attrs.rotate))
    const move = (ev: PointerEvent) => show(calc(ev))
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      this.el.classList.remove('rotate-drag')
      if (ev.type === 'pointerup') this.setAttrs({ rotate: calc(ev) })
      else this.render()
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
    this.el.classList.toggle('panning', this.panning)
    if (this.panning) {
      const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') { this.setPanning(false); document.removeEventListener('keydown', esc, true) } }
      document.addEventListener('keydown', esc, true)
    }
  }

  private pan(e: PointerEvent) {
    if (!this.panning || (e.target as HTMLElement).closest('.wpic-handle, .wpic-radius, .wpic-rotate')) return
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX, y0 = e.clientY
    const { focusX: fx, focusY: fy } = this.attrs
    const r = this.frame.getBoundingClientRect()
    const box = this.box()
    const move = (ev: PointerEvent) => {
      // Dragging the picture right reveals its left part → focus moves left.
      const nx = Math.max(0, Math.min(100, fx - ((ev.clientX - x0) / r.width) * 100))
      const ny = Math.max(0, Math.min(100, fy - ((ev.clientY - y0) / r.height) * 100))
      this.drawImg({ ...this.attrs, focusX: nx, focusY: ny }, box)
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
   * Press selects the picture; dragging moves it — a wrapped picture to exactly where it is
   * released (kept inside one page's text area), an in-line one into the line under it.
   * On touch, the first tap only selects, so a swipe over a picture still scrolls.
   */
  private drag(e: PointerEvent) {
    if (e.button !== 0 || !this.view.editable || (e.target as HTMLElement).closest('.wpic-handle, .wpic-radius, .wpic-rotate')) return
    const pos = this.getPos()
    if (pos == null) return
    const wasSelected = this.el.classList.contains('selected')
    e.preventDefault()
    this.view.focus()
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    if (e.pointerType === 'touch' && !wasSelected) return
    const x0 = e.clientX, y0 = e.clientY
    const zoom = this.zoom()
    // The picture's box (client px), from the centre of what is drawn: rotation keeps the centre.
    const rr = this.el.getBoundingClientRect(), b = this.box()
    const r0 = { left: (rr.left + rr.right) / 2 - (b.w * zoom) / 2, top: (rr.top + rr.bottom) / 2 - (b.h * zoom) / 2, width: b.w * zoom, height: b.h * zoom }
    const marker = document.createElement('div')
    marker.className = 'wpic-drop'
    // The picture follows the pointer as a fixed copy (moving the picture itself would stretch the
    // scrolled area below the last page); the drop is worked out from the pointer as the page is now,
    // so scrolling while dragging (the wheel, or holding it near the top / bottom edge) is followed.
    const ghost = this.el.cloneNode(true) as HTMLElement
    ghost.classList.remove('selected', 'moving')
    ghost.classList.add('wpic-ghost')
    const scroller = this.view.dom.closest('.canvas-scroll') as HTMLElement | null
    const gx = x0 - r0.left, gy = y0 - r0.top
    let px = x0, py = y0
    let moving = false
    let target: Drop | null = null
    let frame = 0
    const update = () => {
      const left = px - gx, top = py - gy
      Object.assign(ghost.style, { left: `${left / zoom}px`, top: `${top / zoom}px` })
      target = this.dropAt(left, top, r0, zoom)
      marker.style.display = target ? '' : 'none'
      if (target) Object.assign(marker.style, { left: `${target.preview.left}px`, top: `${target.preview.top}px`, width: `${r0.width}px`, height: `${r0.height}px` })
    }
    const autoScroll = () => {
      frame = 0
      if (!moving || !scroller) return
      const r = scroller.getBoundingClientRect()
      const v = py < r.top + 48 ? -Math.ceil((r.top + 48 - py) / 4) : py > r.bottom - 48 ? Math.ceil((py - r.bottom + 48) / 4) : 0
      if (v) { scroller.scrollTop += v; update() }
      frame = requestAnimationFrame(autoScroll)
    }
    const move = (ev: PointerEvent) => {
      px = ev.clientX; py = ev.clientY
      if (!moving) {
        if (Math.hypot(px - x0, py - y0) < 5) return
        moving = true
        this.el.classList.add('moving')
        ghost.setAttribute('style', `${this.el.getAttribute('style') || ''};position:fixed;margin:0;float:none;zoom:${zoom};z-index:1000;pointer-events:none;opacity:.8`)
        document.body.append(ghost, marker)
        frame = requestAnimationFrame(autoScroll)
      }
      update()
    }
    const onScroll = () => { if (moving) update() }
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('scroll', onScroll, true)
      cancelAnimationFrame(frame)
      marker.remove()
      ghost.remove()
      this.el.classList.remove('moving')
      if (moving && target && ev.type === 'pointerup') this.moveTo(target)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('scroll', onScroll, true)
  }

  /** Where a picture of client `size` whose top-left corner is at (left, top) (client px) would land. */
  private dropAt(left: number, top: number, size: { width: number; height: number }, zoom: number): Drop | null {
    const view = this.view
    const a = this.attrs
    const ed = view.dom.getBoundingClientRect()
    const w = size.width / zoom, h = size.height / zoom
    if (a.wrap && paginationConfig.enabled) {
      // Free: the page the picture is mostly over, and inside that page's text area — never between pages.
      const { pitch: P, contentHeight: C } = paginationConfig
      const cx = (left - ed.left) / zoom, cy = (top - ed.top) / zoom
      const page = clamp(Math.floor((cy + h / 2) / P), 0, layoutStore.pageCount - 1)
      const y = Math.round(clamp(cy - page * P, 0, C - h))
      const x = Math.round(clamp(cx, 0, (view.dom as HTMLElement).clientWidth - w))
      return { page, x, y, preview: { left: ed.left + x * zoom, top: ed.top + (page * P + y) * zoom } }
    }
    // In-line pictures, and Web Layout (no pages): into the line under the picture's top.
    const hit = view.posAtCoords({ left: clamp(left + size.width / 2, ed.left + 2, ed.right - 2), top: clamp(top + 2, ed.top + 2, ed.bottom - 2) })
    if (!hit) return null
    const $hit = view.state.doc.resolve(hit.pos)
    if (!$hit.parent.inlineContent || $hit.depth === 0) return null
    if (!a.wrap) return { pos: hit.pos, attrs: {}, preview: { left, top: coordsAt(view, hit.pos)?.top ?? top } }
    const start = lineStartAt(view, $hit, top + 2, zoom) ?? hit.pos
    const box = textBox(view, start, zoom)
    if (!box) return null
    const x = Math.round(clamp((left - box.left) / zoom, 0, box.width - w))
    const align = a.wrap === 'square' ? squareSide(x, w, box.width) : a.align
    return { pos: start, attrs: { page: null, x, y: null, align }, preview: { left: box.left + x * zoom, top: coordsAt(view, start)?.top ?? top } }
  }

  private moveTo(drop: Drop) {
    const view = this.view
    const from = this.getPos()
    if (from == null) return
    const a = this.attrs
    if ('page' in drop) {
      const attrs = { ...a, page: drop.page, x: drop.x, y: drop.y, align: a.wrap === 'square' ? squareSide(drop.x, this.box().w, (view.dom as HTMLElement).clientWidth) : a.align }
      // The node moves into the paragraph beside its new spot (Word's anchor: it is exported with it,
      // and deleting that paragraph deletes the picture). The picture itself is placed by floats.ts.
      this.el.classList.add('lifted')
      const blk = anchorBlock(view, drop.page, drop.page * paginationConfig.pitch + drop.y - this.dist().top, a.wrap!)
      this.el.classList.remove('lifted')
      const $from = view.state.doc.resolve(from)
      movePicture(view, from, !blk || blk.pos === $from.before() ? from : blk.pos + 1, attrs)
    } else movePicture(view, from, drop.pos, { ...a, ...drop.attrs })
    relayoutNow(view)
  }

  private resize(e: PointerEvent, corner: string) {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX, y0 = e.clientY
    const start = displaySize(this.attrs, this.natural)
    const zoom = this.zoom()
    const colW = (this.view.dom as HTMLElement).clientWidth
    // A pinned picture stays inside one page's text area.
    const pinned = this.wrapped && isPinned(this.node) && paginationConfig.enabled
    const maxH = pinned ? paginationConfig.contentHeight : Infinity
    const ratio = start.h / start.w
    // Which edges this handle moves: ±1 per axis, 0 = that axis stays.
    const dx = corner.includes('w') ? -1 : corner.includes('e') ? 1 : 0
    const dy = corner.includes('n') ? -1 : corner.includes('s') ? 1 : 0
    const a0 = this.attrs
    const vs = a0.vshape
    const crop = this.cropping() && (!!vs || !!this.natural)
    // The full (uncropped) size and the crop to start from. A picture's aspect / circle crop and
    // focal point become part of its free crop, so cropping starts from exactly what is shown.
    let full: { fw: number; fh: number } | null = null
    let c0: ImgCrop = vs?.crop || { l: 0, t: 0, r: 0, b: 0 }
    if (vs) full = fullSize(vs, start.w, start.h)
    else if (crop) {
      const r = picRect(a0, start, this.natural!)
      full = { fw: r.w, fh: r.h }
      c0 = { l: -r.x / r.w, t: -r.y / r.h, r: 1 - (start.w - r.x) / r.w, b: 1 - (start.h - r.y) / r.h }
    }
    // On a rotated picture, the pointer's movement in the picture's own (unrotated) axes.
    const rad = (normRotate(this.attrs.rotate) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad)
    const local = (ev: PointerEvent) => { const mx = ev.clientX - x0, my = ev.clientY - y0; return { mx: mx * cos + my * sin, my: -mx * sin + my * cos } }
    // Corners keep the proportions (a shape's corner with Shift: free); a shape's side handles stretch it.
    const minW = 24, minH = vs && isLine(vs.k) ? 12 : 16
    const calc = (ev: PointerEvent): { w: number; h: number; v?: VShape; c?: ImgCrop } => {
      const { mx, my } = local(ev)
      let w = dx ? Math.round(Math.max(minW, Math.min(colW, start.w + (dx * mx) / zoom))) : start.w
      let h = dy ? Math.round(Math.max(minH, Math.min(maxH, start.h + (dy * my) / zoom))) : start.h
      const keep = !crop && (!vs || (dx && dy && !ev.shiftKey))
      if (keep) {
        // The pointer's movement along the box's diagonal (or the one axis a side handle moves) scales both sides.
        const s = dx && dy ? 1 + (dx * mx * start.w + dy * my * start.h) / (start.w * start.w + start.h * start.h) / zoom
          : dx ? w / start.w : h / start.h
        const lo = Math.max(minW / start.w, minH / start.h), hi = Math.min(colW / start.w, maxH / start.h)
        const k = Math.max(Math.min(lo, hi), Math.min(hi, s))
        w = Math.round(start.w * k); h = Math.max(1, Math.round(w * ratio))
        return vs ? { w, h, v: vs } : { w, h }
      }
      if (vs && !crop) return { w, h, v: vs }
      // Cropping: the full shape keeps its size; the dragged edge cuts into it (or uncovers it again).
      const { fw, fh } = full!
      const c = { ...c0 }
      const clampC = (n: number, max: number) => Math.max(0, Math.min(max, n))
      if (dx > 0) c.r = clampC(1 - c.l - w / fw, 0.95 - c.l)
      if (dx < 0) c.l = clampC(1 - c.r - w / fw, 0.95 - c.r)
      if (dy > 0) c.b = clampC(1 - c.t - h / fh, 0.95 - c.t)
      if (dy < 0) c.t = clampC(1 - c.b - h / fh, 0.95 - c.b)
      w = Math.round(fw * (1 - c.l - c.r)); h = Math.round(fh * (1 - c.t - c.b))
      if (!vs) return { w, h, c }
      const nv: VShape = { ...vs }
      if (hasCrop(c)) nv.crop = c; else delete nv.crop
      return { w, h, v: nv }
    }
    // On a pinned picture the opposite corner / edge stays where it is, as in Word.
    const shift = (w: number, h: number) => ({ x: pinned && dx < 0 ? start.w - w : 0, y: pinned && dy < 0 ? start.h - h : 0 })
    // A cropped picture: the crop alone, no aspect / focal point / circle (an ellipse looks the same).
    const cropped = (c: ImgCrop): Partial<ImgAttrs> => ({ crop: parseImgCrop(c), aspect: null, focusX: 50, focusY: 50, ...(a0.shape === 'circle' ? { shape: 'ellipse' as ImgShape } : {}) })
    // While dragging, a shape's picture is only stretched: drawing it again on every move would load a
    // new image each time, and every load lays the document out again (the flicker). Redrawn on release.
    let last: PointerEvent | null = null, frame = 0
    const draw = () => {
      frame = 0
      if (!last) return
      const { w, h, v, c } = calc(last)
      const a = c ? { ...a0, ...cropped(c) } : v ? { ...a0, vshape: v } : a0
      this.drawImg(a, { w, h }, !!v)
      const sl = shadowLayerStyles(a, { w, h })
      if (sl) { this.shadow.setAttribute('style', sl.outer); (this.shadow.firstChild as HTMLElement).setAttribute('style', sl.inner) }
      const s = shift(w, h)
      this.el.style.transform = s.x || s.y ? `translate(${s.x}px, ${s.y}px)` : ''
    }
    const move = (ev: PointerEvent) => { last = ev; if (!frame) frame = requestAnimationFrame(draw) }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      cancelAnimationFrame(frame)
      this.el.style.transform = ''
      if (ev.type !== 'pointerup') { this.render(); return }
      const { w, h, v, c } = calc(ev)
      const patch: Partial<ImgAttrs> = v ? { width: w, height: h, vshape: v, src: shapeSrc(v, w, h) } : c ? { width: w, height: h, ...cropped(c) } : { width: w, height: h }
      const s = shift(w, h)
      const a = this.attrs
      if (s.x && a.x != null) patch.x = Math.max(0, Math.round(a.x + s.x))
      if (s.y) patch.y = Math.max(0, Math.round((a.y ?? 0) + s.y))
      this.setAttrs(patch)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  update(node: PMNode) {
    if (node.type !== this.node.type || !!node.attrs.wrap !== this.wrapped) return false
    const moved = PLACING.some((k) => node.attrs[k] !== this.node.attrs[k])
    this.node = node
    this.render()
    if (this.wrapped && moved) requestPlacement(this.view)
    return true
  }

  selectNode() { this.el.classList.add('selected') }
  deselectNode() {
    this.el.classList.remove('selected')
    // Defer: a re-selection of this same picture (dblclick) must not cancel panning.
    setTimeout(() => { if (!this.el.classList.contains('selected')) this.setPanning(false) }, 0)
  }
  stopEvent(e: Event) {
    const t = e.target as HTMLElement
    // Pointer presses are ours (select / move / pan / resize), not ProseMirror's.
    return this.panning || !!t.closest?.('.wpic-handle, .wpic-radius, .wpic-rotate') || e.type === 'dblclick' || e.type === 'mousedown' || e.type === 'dragstart'
  }
  ignoreMutation() { return true }
}

const isWrapped = (n: PMNode | null | undefined) => n?.type.name === 'image' && !!n.attrs.wrap

/** A copy of pasted / dropped content whose wrapped pictures are no longer pinned: they show where they land. */
function unpin(f: Fragment): Fragment {
  const out: PMNode[] = []
  f.forEach((n) => out.push(isWrapped(n) && n.attrs.page != null ? n.type.create({ ...n.attrs, page: null, x: null, y: null }, n.content, n.marks)
    : n.isLeaf ? n : n.copy(unpin(n.content))))
  return Fragment.from(out)
}

/**
 * A wrapped picture's node is an invisible anchor in the text: the caret steps over it, Backspace /
 * Delete next to it delete the text beyond it, and typing or Enter while the picture is selected
 * does nothing — so a picture elsewhere on the page is never deleted or replaced by accident.
 */
const anchorKeys = () => new Plugin({
  key: new PluginKey('picture-anchors'),
  props: {
    handleKeyDown(view, e) {
      const { state } = view
      const sel = state.selection
      if (sel instanceof NodeSelection) return isWrapped(sel.node) && e.key === 'Enter'
      if (!sel.empty || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return false
      const back = e.key === 'Backspace' || e.key === 'ArrowLeft'
      if (!back && e.key !== 'Delete' && e.key !== 'ArrowRight') return false
      let p = sel.from
      if (back) while (isWrapped(state.doc.resolve(p).nodeBefore)) p--
      else while (isWrapped(state.doc.resolve(p).nodeAfter)) p++
      if (p !== sel.from) view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, p)))
      return false
    },
    handleTextInput(view) {
      const sel = view.state.selection
      return sel instanceof NodeSelection && isWrapped(sel.node)
    },
    transformPasted: (slice) => new Slice(unpin(slice.content), slice.openStart, slice.openEnd),
  },
})

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

  // Only embedded pictures: a remote `src` (pasted web page, HTML / Markdown file) would make the
  // editor fetch it behind the user's back. Graphi's own copies, imports and Insert ▸ Pictures ▸
  // From a URL all embed the picture as a data: URL.
  parseHTML() {
    return [{ tag: 'img[src^="data:"]' }]
  },

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
      page: attr('page', null, (v) => (v === '' || !Number.isInteger(Number(v)) ? null : Number(v))),
      vshape: attr('vshape', null, parseVShape),
      rotate: attr('rotate', 0, normRotate),
      crop: attr('crop', null, parseImgCrop),
      // One style attribute for HTML export / clipboard, computed from all of the above.
      _style: {
        default: null,
        parseHTML: () => null,
        renderHTML: (a: Record<string, any>) => {
          const box = displaySize(a as ImgAttrs)
          // Pages don't exist outside Print Layout: a pinned picture goes on its anchor's line.
          const st = pictureStyles({ ...a, y: a.page != null ? null : a.y } as ImgAttrs, box, { withFilter: true })
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
          if (a.page != null) out['data-page'] = String(a.page)
          if (a.rotate) out['data-rotate'] = String(normRotate(a.rotate))
          if (a.vshape) out['data-vshape'] = JSON.stringify(a.vshape)
          if (hasImgCrop(a.crop)) out['data-crop'] = JSON.stringify(a.crop)
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
      floatsPlugin(),
      anchorKeys(),
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
export const needsBake = (a: ImgAttrs) => a.shape !== 'rect' || !!a.aspect || (a.shadow && a.shadow !== 'none') || (!a.vshape && hasImgCrop(a.crop))

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
  // The crop, covering the box at the focal point — as the editor draws it.
  const r = picRect(a, box, { w: img.naturalWidth, h: img.naturalHeight })
  g.save()
  g.clip(path)
  g.drawImage(img, x0 + r.x, y0 + r.y, r.w, r.h)
  g.restore()
  return { dataUrl: c.toDataURL('image/png'), w: box.w + pad * 2, h: box.h + pad * 2 }
}
