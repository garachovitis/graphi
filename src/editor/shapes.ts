// Shapes (Insert ▸ Shapes), as in Word: rectangles, circles, arrows, stars, callouts, lines.
// A shape is a picture node whose `vshape` attribute describes it; its `src` is an SVG drawn
// from that description at the shape's exact size. So shapes get everything pictures have —
// the two wraps, free dragging, resizing, DOCX / ODT / PDF export — and stay editable
// (fill, outline, weight, kind) in their own «Μορφή σχήματος» tab.
import { t, type Key } from '../i18n'
import { currentTheme, tintShade } from '../model/themes'

export type ShapeKind =
  | 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'rightTriangle' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon'
  | 'star5' | 'heart' | 'plus' | 'callout' | 'arrowRight' | 'arrowLeft' | 'arrowUp' | 'arrowDown' | 'line' | 'lineArrow'

export interface VShape {
  k: ShapeKind
  /** fill colour, null = no fill */
  fill: string | null
  /** outline colour, null = no outline */
  line: string | null
  /** outline weight in px (96 dpi) */
  lw: number
}

export const SHAPE_GROUPS: { key: Key; kinds: ShapeKind[] }[] = [
  { key: 'shp.grp.lines', kinds: ['line', 'lineArrow'] },
  { key: 'shp.grp.basic', kinds: ['rect', 'roundRect', 'ellipse', 'triangle', 'rightTriangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'plus', 'heart'] },
  { key: 'shp.grp.arrows', kinds: ['arrowRight', 'arrowLeft', 'arrowUp', 'arrowDown'] },
  { key: 'shp.grp.stars', kinds: ['star5', 'callout'] },
]

export const shapeLabel = (k: ShapeKind) => t(k === 'line' ? 'shp.lineShape' : (`shp.${k}` as Key))
export const isLine = (k: ShapeKind) => k === 'line' || k === 'lineArrow'

/** Outline weights offered in the ribbon, in pt (Word's list). */
export const LINE_WEIGHTS_PT = [0.75, 1, 1.5, 2.25, 3, 4.5, 6]
export const ptToPx = (pt: number) => (pt * 96) / 72
export const pxToPt = (px: number) => Math.round(((px * 72) / 96) * 100) / 100

export function defaultShape(k: ShapeKind): { v: VShape; w: number; h: number } {
  if (isLine(k)) return { v: { k, fill: null, line: '#243B3A', lw: ptToPx(2.25) }, w: 240, h: 24 }
  const square = ['ellipse', 'pentagon', 'hexagon', 'octagon', 'star5', 'heart', 'plus', 'diamond'].includes(k)
  const tall = k === 'arrowUp' || k === 'arrowDown'
  // Like Word, a new shape takes the theme's Accent 1 (outline: a darker shade of it).
  const a1 = currentTheme.colors.accent1
  return { v: { k, fill: a1, line: tintShade(a1, -35), lw: ptToPx(1.5) }, w: tall ? 90 : square ? 140 : 180, h: tall ? 160 : square ? 140 : k.startsWith('arrow') ? 90 : 120 }
}

export function parseVShape(v: unknown): VShape | null {
  let o: any = v
  if (typeof v === 'string') { try { o = JSON.parse(v) } catch { return null } }
  if (!o || typeof o !== 'object' || typeof o.k !== 'string') return null
  return { k: o.k, fill: o.fill ?? null, line: o.line ?? null, lw: Number.isFinite(+o.lw) ? +o.lw : 2 }
}

type P = [number, number]
const poly = (pts: P[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') + 'Z'
const regular = (n: number, rot = -Math.PI / 2): P[] =>
  Array.from({ length: n }, (_, i) => [0.5 + 0.5 * Math.cos(rot + (2 * Math.PI * i) / n), 0.5 + 0.5 * Math.sin(rot + (2 * Math.PI * i) / n)])
const STAR: P[] = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 0.19 : 0.5
  const a = -Math.PI / 2 + (Math.PI / 5) * i
  return [0.5 + r * Math.cos(a), 0.55 + r * Math.sin(a) * 1.05]
})
const ARROW: P[] = [[0, 0.28], [0.6, 0.28], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.72], [0, 0.72]]
const POLYS: Partial<Record<ShapeKind, P[]>> = {
  rect: [[0, 0], [1, 0], [1, 1], [0, 1]],
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  rightTriangle: [[0, 0], [1, 1], [0, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  pentagon: regular(5),
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  octagon: [[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]],
  plus: [[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]],
  star5: STAR,
  arrowRight: ARROW,
  arrowLeft: ARROW.map(([x, y]) => [1 - x, y]),
  arrowUp: ARROW.map(([x, y]) => [y, 1 - x]),
  arrowDown: ARROW.map(([x, y]) => [y, x]),
}

/** SVG path of the shape inside a W×H box, inset by `p` so the outline isn't clipped. */
function shapePath(k: ShapeKind, W: number, H: number, p: number): string {
  const w = Math.max(1, W - 2 * p), h = Math.max(1, H - 2 * p)
  const X = (x: number) => +(p + x * w).toFixed(2)
  const Y = (y: number) => +(p + y * h).toFixed(2)
  const pts = POLYS[k]
  if (pts) return poly(pts.map(([x, y]) => [X(x), Y(y)]))
  switch (k) {
    case 'roundRect': {
      const r = Math.min(w, h) * 0.18
      return `M${X(0) + r} ${Y(0)}H${X(1) - r}A${r} ${r} 0 0 1 ${X(1)} ${Y(0) + r}V${Y(1) - r}A${r} ${r} 0 0 1 ${X(1) - r} ${Y(1)}H${X(0) + r}A${r} ${r} 0 0 1 ${X(0)} ${Y(1) - r}V${Y(0) + r}A${r} ${r} 0 0 1 ${X(0) + r} ${Y(0)}Z`
    }
    case 'ellipse':
      return `M${X(0)} ${Y(0.5)}A${w / 2} ${h / 2} 0 1 0 ${X(1)} ${Y(0.5)}A${w / 2} ${h / 2} 0 1 0 ${X(0)} ${Y(0.5)}Z`
    case 'heart':
      return `M${X(0.5)} ${Y(0.28)}C${X(0.5)} ${Y(0.05)} ${X(0.12)} ${Y(-0.02)} ${X(0.03)} ${Y(0.24)}C${X(-0.04)} ${Y(0.46)} ${X(0.2)} ${Y(0.72)} ${X(0.5)} ${Y(1)}`
        + `C${X(0.8)} ${Y(0.72)} ${X(1.04)} ${Y(0.46)} ${X(0.97)} ${Y(0.24)}C${X(0.88)} ${Y(-0.02)} ${X(0.5)} ${Y(0.05)} ${X(0.5)} ${Y(0.28)}Z`
    case 'callout': {
      const r = Math.min(w, h * 0.75) * 0.14
      const b = Y(0.74)
      return `M${X(0) + r} ${Y(0)}H${X(1) - r}A${r} ${r} 0 0 1 ${X(1)} ${Y(0) + r}V${b - r}A${r} ${r} 0 0 1 ${X(1) - r} ${b}`
        + `H${X(0.42)}L${X(0.2)} ${Y(1)}L${X(0.26)} ${b}H${X(0) + r}A${r} ${r} 0 0 1 ${X(0)} ${b - r}V${Y(0) + r}A${r} ${r} 0 0 1 ${X(0) + r} ${Y(0)}Z`
    }
    default: return ''
  }
}

const esc = (c: string) => c.replace(/[^#a-zA-Z0-9(),.% -]/g, '')

/** The shape as an SVG document, drawn for a W×H box (px). */
export function shapeSvg(v: VShape, W: number, H: number): string {
  W = Math.max(4, Math.round(W)); H = Math.max(4, Math.round(H))
  const lw = v.line ? Math.max(0, v.lw) : 0
  let body: string
  if (isLine(v.k)) {
    const col = esc(v.line || '#243B3A')
    const lwl = Math.max(0.75, v.lw)
    const y = H / 2
    const head = Math.max(8, lwl * 3.2)
    const end = v.k === 'lineArrow' ? W - head * 0.9 : W
    body = `<path d="M${lwl / 2} ${y}H${end.toFixed(2)}" stroke="${col}" stroke-width="${lwl}" stroke-linecap="${v.k === 'lineArrow' ? 'butt' : 'round'}" fill="none"/>`
    if (v.k === 'lineArrow') body += `<path d="M${W - head * 1.4} ${y - head * 0.6}L${W} ${y}L${W - head * 1.4} ${y + head * 0.6}Z" fill="${col}"/>`
  } else {
    const d = shapePath(v.k, W, H, lw / 2 + 0.5)
    body = `<path d="${d}" fill="${v.fill ? esc(v.fill) : 'none'}"${lw ? ` stroke="${esc(v.line!)}" stroke-width="${lw}" stroke-linejoin="round"` : ''}/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${body}</svg>`
}

export const shapeSrc = (v: VShape, W: number, H: number) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shapeSvg(v, W, H))}`
