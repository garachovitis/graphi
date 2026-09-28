// Horizontal ruler (cm): shaded margins, draggable page margins and paragraph indents
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
