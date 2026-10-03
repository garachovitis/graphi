// Rulers (cm). Horizontal: shaded margins, draggable page margins and paragraph indents
// (first-line ▽, hanging △, left-indent box, right indent △) — as in Word.
import { useRef, type ReactElement } from 'react'
import { mmToPx, pxToMm } from '../model/settings'
import type { AppApi } from './App'
import { t } from '../i18n'

const PT_PER_PX = 0.75
const SNAP_MM = 2.5

type DragKind = 'marginL' | 'marginR' | 'first' | 'hanging' | 'left' | 'right'

export function Ruler({ api }: { api: AppApi }) {
  const { settings: s, zoom, editor } = api
  const ref = useRef<HTMLDivElement>(null)
  const pageW = mmToPx(s.width)
  const ml = mmToPx(s.margins.left)
  const mr = mmToPx(s.margins.right)

  const para = editor.state.selection.$from.parent
  const isPara = para.type.name === 'paragraph' || para.type.name === 'heading'
  const indL = ((para.attrs.indentLeft as number) || 0) / PT_PER_PX
  const indR = ((para.attrs.indentRight as number) || 0) / PT_PER_PX
  const first = ((para.attrs.firstLine as number) || 0) / PT_PER_PX

  const startDrag = (kind: DragKind, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const snap = (px: number, free: boolean) => (free ? px : mmToPx(Math.round(pxToMm(px) / SNAP_MM) * SNAP_MM))
    const init = { ml, mr, indL, indR, first }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / zoom
      const free = ev.altKey
      const textW = pageW - init.ml - init.mr
      switch (kind) {
        case 'marginL': {
          const v = Math.max(0, Math.min(pageW - init.mr - 48, snap(init.ml + dx, free)))
          api.setSettings({ ...s, margins: { ...s.margins, left: Math.round(pxToMm(v) * 100) / 100 } })
          break
        }
        case 'marginR': {
          const v = Math.max(0, Math.min(pageW - init.ml - 48, snap(init.mr - dx, free)))
          api.setSettings({ ...s, margins: { ...s.margins, right: Math.round(pxToMm(v) * 100) / 100 } })
          break
        }
        case 'first': {
          const v = snap(init.indL + init.first + dx, free) - init.indL
          editor.chain().setParagraphAttrs({ firstLine: Math.round(v * PT_PER_PX * 10) / 10 || null }).run()
          break
        }
        case 'hanging': {
          // Moves the left indent while keeping the first line where it is.
          const nl = Math.max(-init.ml, Math.min(textW - 24, snap(init.indL + dx, free)))
          const nf = init.indL + init.first - nl
          editor.chain().setParagraphAttrs({ indentLeft: Math.round(nl * PT_PER_PX * 10) / 10 || null, firstLine: Math.round(nf * PT_PER_PX * 10) / 10 || null }).run()
          break
        }
        case 'left': {
          const nl = Math.max(-init.ml, Math.min(textW - 24, snap(init.indL + dx, free)))
          editor.chain().setParagraphAttrs({ indentLeft: Math.round(nl * PT_PER_PX * 10) / 10 || null }).run()
          break
        }
        case 'right': {
          const nr = Math.max(-init.mr, Math.min(textW - 24, snap(init.indR - dx, free)))
          editor.chain().setParagraphAttrs({ indentRight: Math.round(nr * PT_PER_PX * 10) / 10 || null }).run()
          break
        }
      }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      editor.commands.focus()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  // Ticks every 0.25 cm, numbered every cm, counted from the left margin (both directions).
  const ticks: ReactElement[] = []
  const cm = mmToPx(10)
  for (let x = ml % (cm / 4); x <= pageW; x += cm / 4) {
    const rel = Math.round(((x - ml) / cm) * 4) / 4
    const whole = Math.abs(rel % 1) < 0.001
    const half = Math.abs(Math.abs(rel % 1) - 0.5) < 0.001
    if (whole && rel !== 0) {
      ticks.push(<span key={x} className="rl-num" style={{ left: x * zoom }}>{Math.abs(rel)}</span>)
    } else if (!whole) {
      ticks.push(<span key={x} className={`rl-tick${half ? ' half' : ''}`} style={{ left: x * zoom }} />)
    }
  }

  const z = (v: number) => v * zoom
  return (
    <div className="ruler-bar no-print">
      <div className="ruler" ref={ref} style={{ width: pageW * zoom }}>
        <div className="rl-margin" style={{ left: 0, width: z(ml) }} />
        <div className="rl-margin" style={{ right: 0, width: z(mr) }} />
        {ticks}
        <div className="rl-edge" style={{ left: z(ml) - 3 }} title={t('ruler.leftMargin')} onPointerDown={(e) => startDrag('marginL', e)} />
        <div className="rl-edge" style={{ left: z(pageW - mr) - 3 }} title={t('ruler.rightMargin')} onPointerDown={(e) => startDrag('marginR', e)} />
        {isPara && (
          <>
            <div className="rl-ind first" style={{ left: z(ml + indL + first) - 5 }} title={t('ruler.firstLine')} onPointerDown={(e) => startDrag('first', e)} />
            <div className="rl-ind hanging" style={{ left: z(ml + indL) - 5 }} title={t('ruler.hanging')} onPointerDown={(e) => startDrag('hanging', e)} />
            <div className="rl-ind leftbox" style={{ left: z(ml + indL) - 5 }} title={t('ruler.leftIndent')} onPointerDown={(e) => startDrag('left', e)} />
            <div className="rl-ind right" style={{ left: z(pageW - mr - indR) - 5 }} title={t('ruler.rightIndent')} onPointerDown={(e) => startDrag('right', e)} />
          </>
        )}
      </div>
    </div>
  )
}

/** Vertical ruler beside one page: shaded top/bottom margins (draggable), cm counted from the top margin. */
export function VRuler({ api, top }: { api: AppApi; top: number }) {
  const { settings: s, zoom } = api
  const pageH = mmToPx(s.height)
  const mt = mmToPx(s.margins.top)
  const mb = mmToPx(s.margins.bottom)
  const z = (v: number) => v * zoom

  const startDrag = (kind: 'top' | 'bottom', e: React.PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const y0 = e.clientY
    const init = kind === 'top' ? mt : mb
    const move = (ev: PointerEvent) => {
      const dy = ((ev.clientY - y0) / zoom) * (kind === 'top' ? 1 : -1)
      const raw = init + dy
      const px = ev.altKey ? raw : mmToPx(Math.round(pxToMm(raw) / SNAP_MM) * SNAP_MM)
      const v = Math.max(0, Math.min(pageH - (kind === 'top' ? mb : mt) - 48, px))
      api.setSettings({ ...s, margins: { ...s.margins, [kind]: Math.round(pxToMm(v) * 100) / 100 } })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      api.editor.commands.focus()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const ticks: ReactElement[] = []
  const cm = mmToPx(10)
  for (let y = mt % (cm / 4); y <= pageH; y += cm / 4) {
    const rel = Math.round(((y - mt) / cm) * 4) / 4
    const whole = Math.abs(rel % 1) < 0.001
    const half = Math.abs(Math.abs(rel % 1) - 0.5) < 0.001
    if (whole && rel !== 0) ticks.push(<span key={y} className="rl-num" style={{ top: z(y) }}>{Math.abs(rel)}</span>)
    else if (!whole) ticks.push(<span key={y} className={`rl-tick${half ? ' half' : ''}`} style={{ top: z(y) }} />)
  }
  return (
    <div className="vruler no-print" style={{ top: z(top), height: z(pageH) }}>
      <div className="rl-margin" style={{ top: 0, height: z(mt) }} />
      <div className="rl-margin" style={{ bottom: 0, height: z(mb) }} />
      {ticks}
      <div className="rl-edge" style={{ top: z(mt) - 3 }} title={t('ruler.topMargin')} onPointerDown={(e) => startDrag('top', e)} />
      <div className="rl-edge" style={{ top: z(pageH - mb) - 3 }} title={t('ruler.bottomMargin')} onPointerDown={(e) => startDrag('bottom', e)} />
    </div>
  )
}
