// Shapes (Insert ▸ Shapes), as in Word: rectangles, circles, arrows, stars, callouts, lines.
// A shape is a picture node whose `vshape` attribute describes it; its `src` is an SVG drawn
// from that description at the shape's exact size. So shapes get everything pictures have —
// the two wraps, free dragging, resizing, DOCX / ODT / PDF export — and stay editable
// (fill, outline, weight, kind) in their own «Μορφή σχήματος» tab.
import { t, type Key } from '../i18n'
import { currentTheme, tintShade } from '../model/themes'

export type ShapeKind =
  | 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'rightTriangle' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon'
  | 'heptagon' | 'decagon' | 'parallelogram' | 'trapezoid' | 'frame' | 'donut' | 'can' | 'cube' | 'moon' | 'sun' | 'cloud'
  | 'lightning' | 'teardrop' | 'smiley' | 'noSymbol' | 'wave' | 'bracketPair'
  | 'star4' | 'star5' | 'star6' | 'star8' | 'star12' | 'burst' | 'ribbon'
  | 'heart' | 'plus' | 'callout' | 'calloutRect' | 'calloutOval' | 'calloutCloud'
  | 'arrowRight' | 'arrowLeft' | 'arrowUp' | 'arrowDown' | 'arrowLeftRight' | 'arrowUpDown' | 'arrowQuad'
  | 'chevron' | 'homePlate' | 'arrowNotched' | 'arrowUturn' | 'arrowCurved'
  | 'fcDocument' | 'fcTerminator' | 'fcPredefined' | 'fcManualInput' | 'fcDelay' | 'fcStored' | 'fcOffpage' | 'fcMerge'
  | 'line' | 'lineArrow' | 'lineDouble' | 'lineDashed'

export interface VShape {
  k: ShapeKind
  /** fill colour, null = no fill */
  fill: string | null
  /** outline colour, null = no outline */
  line: string | null
  /** outline weight in px (96 dpi) */
  lw: number
  /** cropped share of the full shape on each side (0–0.95); the visible box is what's left */
  crop?: { l: number; t: number; r: number; b: number }
}

export const SHAPE_GROUPS: { key: Key; kinds: ShapeKind[] }[] = [
  { key: 'shp.grp.lines', kinds: ['line', 'lineArrow', 'lineDouble', 'lineDashed'] },
  { key: 'shp.grp.basic', kinds: ['rect', 'roundRect', 'ellipse', 'triangle', 'rightTriangle', 'parallelogram', 'trapezoid', 'diamond',
    'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'plus', 'frame', 'donut', 'noSymbol', 'can', 'cube', 'bracketPair',
    'teardrop', 'heart', 'smiley', 'sun', 'moon', 'cloud', 'lightning', 'wave'] },
  { key: 'shp.grp.arrows', kinds: ['arrowRight', 'arrowLeft', 'arrowUp', 'arrowDown', 'arrowLeftRight', 'arrowUpDown', 'arrowQuad',
    'arrowNotched', 'chevron', 'homePlate', 'arrowUturn', 'arrowCurved'] },
  { key: 'shp.grp.flow', kinds: ['fcDocument', 'fcTerminator', 'fcPredefined', 'fcManualInput', 'fcDelay', 'fcStored', 'fcOffpage', 'fcMerge'] },
  { key: 'shp.grp.stars', kinds: ['star4', 'star5', 'star6', 'star8', 'star12', 'burst', 'ribbon', 'callout', 'calloutRect', 'calloutOval', 'calloutCloud'] },
]

export const shapeLabel = (k: ShapeKind) => t(k === 'line' ? 'shp.lineShape' : (`shp.${k}` as Key))
export const isLine = (k: ShapeKind) => k.startsWith('line')

/** Outline weights offered in the ribbon, in pt (Word's list). */
export const LINE_WEIGHTS_PT = [0.75, 1, 1.5, 2.25, 3, 4.5, 6]
export const ptToPx = (pt: number) => (pt * 96) / 72
export const pxToPt = (px: number) => Math.round(((px * 72) / 96) * 100) / 100

export function defaultShape(k: ShapeKind): { v: VShape; w: number; h: number } {
  if (isLine(k)) return { v: { k, fill: null, line: '#243B3A', lw: ptToPx(2.25) }, w: 240, h: 24 }
  const square = SQUARE.includes(k) || k.startsWith('star')
  const tall = k === 'arrowUp' || k === 'arrowDown' || k === 'arrowUpDown' || k === 'can' || k === 'lightning'
  // Outline only: a new shape is drawn in the theme's Accent 1 and gets a fill from «Γέμισμα».
  const a1 = currentTheme.colors.accent1
  const flat = k.startsWith('arrow') && k !== 'arrowQuad' || k === 'chevron' || k === 'homePlate' || k === 'ribbon' || k === 'wave'
  return { v: { k, fill: null, line: tintShade(a1, -15), lw: ptToPx(1.5) }, w: tall ? 90 : square ? 140 : 180, h: tall ? 160 : square ? 140 : flat ? 90 : 120 }
}

const SQUARE: ShapeKind[] = ['ellipse', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'heart', 'plus', 'diamond', 'frame', 'donut',
  'noSymbol', 'cube', 'teardrop', 'smiley', 'sun', 'burst', 'arrowQuad', 'fcOffpage', 'fcMerge', 'calloutOval', 'calloutCloud', 'cloud']

export function parseVShape(v: unknown): VShape | null {
  let o: any = v
  if (typeof v === 'string') { try { o = JSON.parse(v) } catch { return null } }
  if (!o || typeof o !== 'object' || typeof o.k !== 'string') return null
  const c = o.crop
  const f = (n: unknown) => Math.max(0, Math.min(0.95, +(n as number) || 0))
  const crop = c && typeof c === 'object' ? { l: f(c.l), t: f(c.t), r: f(c.r), b: f(c.b) } : undefined
  return { k: o.k, fill: o.fill ?? null, line: o.line ?? null, lw: Number.isFinite(+o.lw) ? +o.lw : 2, ...(crop && hasCrop(crop) ? { crop } : {}) }
}

export const hasCrop = (c?: VShape['crop']) => !!c && c.l + c.t + c.r + c.b > 0.001
/** The full (uncropped) size of a shape whose visible box is W×H. */
export function fullSize(v: VShape, W: number, H: number) {
  const c = v.crop
  if (!c) return { fw: W, fh: H, ox: 0, oy: 0 }
  const fw = W / Math.max(0.05, 1 - c.l - c.r), fh = H / Math.max(0.05, 1 - c.t - c.b)
  return { fw, fh, ox: c.l * fw, oy: c.t * fh }
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
const star = (n: number, inner: number, rot = -Math.PI / 2): P[] => Array.from({ length: 2 * n }, (_, i) => {
  const r = i % 2 ? inner / 2 : 0.5
  const a = rot + (Math.PI / n) * i
  return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]
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
  heptagon: regular(7),
  decagon: regular(10),
  parallelogram: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]],
  trapezoid: [[0.22, 0], [0.78, 0], [1, 1], [0, 1]],
  lightning: [[0.4, 0], [0.78, 0], [0.55, 0.38], [0.85, 0.38], [0.25, 1], [0.42, 0.55], [0.15, 0.55]],
  star4: star(4, 0.38, 0),
  star6: star(6, 0.58),
  star8: star(8, 0.7, 0),
  star12: star(12, 0.75),
  burst: star(16, 0.72).map(([x, y], i) => i % 4 === 2 ? [0.5 + (x - 0.5) * 0.88, 0.5 + (y - 0.5) * 0.88] : [x, y]),
  ribbon: [[0, 0.2], [0.2, 0.2], [0.2, 0], [0.8, 0], [0.8, 0.2], [1, 0.2], [0.88, 0.5], [1, 0.8], [0.8, 0.8], [0.8, 0.65],
    [0.2, 0.65], [0.2, 0.8], [0, 0.8], [0.12, 0.5]],
  arrowLeftRight: [[0, 0.5], [0.25, 0], [0.25, 0.28], [0.75, 0.28], [0.75, 0], [1, 0.5], [0.75, 1], [0.75, 0.72], [0.25, 0.72], [0.25, 1]],
  arrowUpDown: [[0.5, 0], [1, 0.25], [0.72, 0.25], [0.72, 0.75], [1, 0.75], [0.5, 1], [0, 0.75], [0.28, 0.75], [0.28, 0.25], [0, 0.25]],
  arrowQuad: [[0.5, 0], [0.66, 0.16], [0.57, 0.16], [0.57, 0.43], [0.84, 0.43], [0.84, 0.34], [1, 0.5], [0.84, 0.66], [0.84, 0.57], [0.57, 0.57],
    [0.57, 0.84], [0.66, 0.84], [0.5, 1], [0.34, 0.84], [0.43, 0.84], [0.43, 0.57], [0.16, 0.57], [0.16, 0.66], [0, 0.5], [0.16, 0.34],
    [0.16, 0.43], [0.43, 0.43], [0.43, 0.16], [0.34, 0.16]],
  arrowNotched: [[0, 0.28], [0.6, 0.28], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.72], [0, 0.72], [0.15, 0.5]],
  chevron: [[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]],
  homePlate: [[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1]],
  fcManualInput: [[0, 0.25], [1, 0], [1, 1], [0, 1]],
  fcOffpage: [[0, 0], [1, 0], [1, 0.75], [0.5, 1], [0, 0.75]],
  fcMerge: [[0, 0], [1, 0], [0.5, 1]],
}

/** Shapes made of a ring (outer + inner path) are filled even-odd, so the hole stays empty. */
const EVENODD: ShapeKind[] = ['frame', 'donut', 'noSymbol', 'smiley', 'sun']

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
    case 'calloutRect':
      return `M${X(0)} ${Y(0)}H${X(1)}V${Y(0.74)}H${X(0.42)}L${X(0.2)} ${Y(1)}L${X(0.26)} ${Y(0.74)}H${X(0)}Z`
    case 'calloutOval':
      return `M${X(0.3)} ${Y(0.8)}A${w * 0.5} ${h * 0.4} 0 1 1 ${X(0.42)} ${Y(0.83)}L${X(0.16)} ${Y(1)}Z`
    case 'cloud': case 'calloutCloud': {
      // One outline of bumps: arcs between points on an ellipse, each bulging outward.
      const ch = k === 'cloud' ? 1 : 0.8, n = 9
      const pt = (i: number): P => [X(0.5 + 0.4 * Math.cos((2 * Math.PI * i) / n)), Y((0.5 + 0.36 * Math.sin((2 * Math.PI * i) / n)) * ch + (ch < 1 ? 0.0 : 0.04))]
      let d = `M${pt(0)[0]} ${pt(0)[1]}`
      for (let i = 1; i <= n; i++) { const [x, y] = pt(i); d += `A${w * 0.15} ${h * 0.15 * ch} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}` }
      d += 'Z'
      if (k === 'calloutCloud') d += circ(0.18, 0.88, 0.06) + circ(0.1, 0.97, 0.03)
      return d
    }
    case 'frame': return poly([[X(0), Y(0)], [X(1), Y(0)], [X(1), Y(1)], [X(0), Y(1)]]) + poly([[X(0.14), Y(0.14)], [X(0.14), Y(0.86)], [X(0.86), Y(0.86)], [X(0.86), Y(0.14)]])
    case 'donut': return circ(0.5, 0.5, 0.5) + circ(0.5, 0.5, 0.27)
    case 'noSymbol': {
      // ring + a diagonal bar, as one even-odd outline
      return circ(0.5, 0.5, 0.5) + `M${X(0.25)} ${Y(0.33)}L${X(0.67)} ${Y(0.75)}A${w * 0.33} ${h * 0.33} 0 0 1 ${X(0.25)} ${Y(0.33)}Z`
        + `M${X(0.33)} ${Y(0.25)}A${w * 0.33} ${h * 0.33} 0 0 1 ${X(0.75)} ${Y(0.67)}Z`
    }
    case 'smiley':
      return circ(0.5, 0.5, 0.5) + circ(0.34, 0.38, 0.06) + circ(0.66, 0.38, 0.06)
        + `M${X(0.27)} ${Y(0.62)}Q${X(0.5)} ${Y(0.86)} ${X(0.73)} ${Y(0.62)}Q${X(0.5)} ${Y(0.76)} ${X(0.27)} ${Y(0.62)}Z`
    case 'sun': {
      let d = circ(0.5, 0.5, 0.22)
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i, b = 0.09
        const pt = (r: number, da: number): P => [X(0.5 + r * Math.cos(a + da)), Y(0.5 + r * Math.sin(a + da))]
        d += poly([pt(0.3, -b), pt(0.5, 0), pt(0.3, b)])
      }
      return d
    }
    case 'moon':
      return `M${X(0.75)} ${Y(0)}A${w * 0.5} ${h * 0.5} 0 1 0 ${X(0.75)} ${Y(1)}A${w * 0.3} ${h * 0.5} 0 0 1 ${X(0.75)} ${Y(0)}Z`
    case 'teardrop':
      return `M${X(1)} ${Y(0)}V${Y(0.5)}A${w / 2} ${h / 2} 0 1 1 ${X(0.5)} ${Y(0)}Z`
    case 'wave':
      return `M${X(0)} ${Y(0.12)}C${X(0.35)} ${Y(-0.12)} ${X(0.65)} ${Y(0.36)} ${X(1)} ${Y(0.12)}V${Y(0.88)}C${X(0.65)} ${Y(1.12)} ${X(0.35)} ${Y(0.64)} ${X(0)} ${Y(0.88)}Z`
    case 'can': {
      const ry = h * 0.12
      return `M${X(0)} ${Y(0.12)}A${w / 2} ${ry} 0 0 1 ${X(1)} ${Y(0.12)}V${Y(0.88)}A${w / 2} ${ry} 0 0 1 ${X(0)} ${Y(0.88)}Z`
        + `M${X(0)} ${Y(0.12)}A${w / 2} ${ry} 0 0 0 ${X(1)} ${Y(0.12)}`
    }
    case 'cube':
      return poly([[X(0), Y(0.25)], [X(0.25), Y(0)], [X(1), Y(0)], [X(1), Y(0.75)], [X(0.75), Y(1)], [X(0), Y(1)]])
        + `M${X(0)} ${Y(0.25)}H${X(0.75)}V${Y(1)}M${X(0.75)} ${Y(0.25)}L${X(1)} ${Y(0)}`
    case 'bracketPair':
      return `M${X(0.15)} ${Y(0)}Q${X(0)} ${Y(0)} ${X(0)} ${Y(0.15)}V${Y(0.85)}Q${X(0)} ${Y(1)} ${X(0.15)} ${Y(1)}`
        + `M${X(0.85)} ${Y(0)}Q${X(1)} ${Y(0)} ${X(1)} ${Y(0.15)}V${Y(0.85)}Q${X(1)} ${Y(1)} ${X(0.85)} ${Y(1)}`
    case 'arrowUturn':
      return `M${X(0)} ${Y(1)}V${Y(0.4)}A${w * 0.4} ${h * 0.4} 0 0 1 ${X(0.8)} ${Y(0.4)}V${Y(0.6)}H${X(1)}L${X(0.67)} ${Y(1)}L${X(0.34)} ${Y(0.6)}H${X(0.54)}V${Y(0.4)}`
        + `A${w * 0.14} ${h * 0.14} 0 0 0 ${X(0.26)} ${Y(0.4)}V${Y(1)}Z`
    case 'arrowCurved':
      return `M${X(0)} ${Y(1)}C${X(0)} ${Y(0.45)} ${X(0.3)} ${Y(0.25)} ${X(0.7)} ${Y(0.25)}V${Y(0)}L${X(1)} ${Y(0.4)}L${X(0.7)} ${Y(0.8)}V${Y(0.55)}`
        + `C${X(0.45)} ${Y(0.55)} ${X(0.28)} ${Y(0.7)} ${X(0.28)} ${Y(1)}Z`
    case 'fcDocument':
      return `M${X(0)} ${Y(0)}H${X(1)}V${Y(0.85)}C${X(0.7)} ${Y(0.7)} ${X(0.3)} ${Y(1.08)} ${X(0)} ${Y(0.9)}Z`
    case 'fcTerminator': {
      const r = Math.min(h / 2, w / 2)
      return `M${X(0) + r} ${Y(0)}H${X(1) - r}A${r} ${h / 2} 0 0 1 ${X(1) - r} ${Y(1)}H${X(0) + r}A${r} ${h / 2} 0 0 1 ${X(0) + r} ${Y(0)}Z`
    }
    case 'fcPredefined':
      return poly([[X(0), Y(0)], [X(1), Y(0)], [X(1), Y(1)], [X(0), Y(1)]]) + `M${X(0.12)} ${Y(0)}V${Y(1)}M${X(0.88)} ${Y(0)}V${Y(1)}`
    case 'fcDelay':
      return `M${X(0)} ${Y(0)}H${X(0.5)}A${w / 2} ${h / 2} 0 0 1 ${X(0.5)} ${Y(1)}H${X(0)}Z`
    case 'fcStored':
      return `M${X(0.17)} ${Y(0)}H${X(1)}A${w * 0.17} ${h / 2} 0 0 0 ${X(1)} ${Y(1)}H${X(0.17)}A${w * 0.17} ${h / 2} 0 0 1 ${X(0.17)} ${Y(0)}Z`
    default: return ''
  }
  function circ(cx: number, cy: number, r: number) {
    return `M${X(cx - r)} ${Y(cy)}A${w * r} ${h * r} 0 1 0 ${X(cx + r)} ${Y(cy)}A${w * r} ${h * r} 0 1 0 ${X(cx - r)} ${Y(cy)}Z`
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
    const arrowR = v.k === 'lineArrow' || v.k === 'lineDouble', arrowL = v.k === 'lineDouble'
    const end = arrowR ? W - head * 0.9 : W, start = arrowL ? head * 0.9 : lwl / 2
    const dash = v.k === 'lineDashed' ? ` stroke-dasharray="${lwl * 3} ${lwl * 2}"` : ''
    body = `<path d="M${start.toFixed(2)} ${y}H${end.toFixed(2)}" stroke="${col}" stroke-width="${lwl}" stroke-linecap="${arrowR ? 'butt' : 'round'}"${dash} fill="none"/>`
    if (arrowR) body += `<path d="M${W - head * 1.4} ${y - head * 0.6}L${W} ${y}L${W - head * 1.4} ${y + head * 0.6}Z" fill="${col}"/>`
    if (arrowL) body += `<path d="M${head * 1.4} ${y - head * 0.6}L0 ${y}L${head * 1.4} ${y + head * 0.6}Z" fill="${col}"/>`
  } else {
    // A cropped shape is drawn at its full size and shifted, so the svg box cuts it.
    const { fw, fh, ox, oy } = fullSize(v, W, H)
    const d = shapePath(v.k, fw, fh, lw / 2 + 0.5)
    const rule = EVENODD.includes(v.k) ? ' fill-rule="evenodd"' : ''
    body = `<path d="${d}"${rule} fill="${v.fill ? esc(v.fill) : 'none'}"${lw ? ` stroke="${esc(v.line!)}" stroke-width="${lw}" stroke-linejoin="round"` : ''}/>`
    if (ox || oy) body = `<g transform="translate(${(-ox).toFixed(2)} ${(-oy).toFixed(2)})">${body}</g>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${body}</svg>`
}

export const shapeSrc = (v: VShape, W: number, H: number) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shapeSvg(v, W, H))}`
