// Insert ▸ Signature: draw with mouse / stylus / finger, or import a scan/photo.
// The result is a transparent, tightly-cropped, high-resolution PNG inserted as a picture.
import { useEffect, useRef, useState } from 'react'
import { X, Undo2, Eraser, Upload } from 'lucide-react'
import type { AppApi } from './App'
import { t, type Key } from '../i18n'

const INK: readonly (readonly [string, Key])[] = [['#111827', 'sig.inkBlack'], ['#1d4ed8', 'sig.inkBlue'], ['#117470', 'sig.inkTeal']]
const SCALE = 3 // canvas pixels per CSS px → crisp in print/PDF

type Pt = { x: number; y: number; p: number }

export function SignatureDialog({ api, close, initialMode = 'draw' }: { api: AppApi; close: () => void; initialMode?: 'draw' | 'file' }) {
  const [mode, setMode] = useState<'draw' | 'file'>(initialMode)
  const [ink, setInk] = useState<string>(INK[0][0])
  const [width, setWidth] = useState(2.4)
  const [strokes, setStrokes] = useState<Pt[][]>([])
  const [fileImg, setFileImg] = useState<HTMLImageElement | null>(null)
  const [removeBg, setRemoveBg] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const current = useRef<Pt[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const W = 520, H = 200
  // Opened from «Από εικόνα…»: go straight to the file picker (still within the menu click's activation).
  useEffect(() => { if (initialMode === 'file') fileRef.current?.click() }, [])

  // Redraw all strokes as smooth quadratic curves; pen pressure modulates width.
  const redraw = (list: Pt[][]) => {
    const c = canvasRef.current
    if (!c) return
    const g = c.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, c.width, c.height)
    g.scale(SCALE, SCALE)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = ink
    for (const s of list) {
      if (s.length === 1) {
        g.beginPath(); g.fillStyle = ink; g.arc(s[0].x, s[0].y, width / 2, 0, Math.PI * 2); g.fill(); continue
      }
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1], b = s[i]
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        g.beginPath()
        g.lineWidth = width * (0.55 + 0.9 * ((a.p + b.p) / 2))
        const prev = i > 1 ? { x: (s[i - 2].x + a.x) / 2, y: (s[i - 2].y + a.y) / 2 } : a
        g.moveTo(prev.x, prev.y)
        g.quadraticCurveTo(a.x, a.y, m.x, m.y)
        g.stroke()
      }
    }
  }
  useEffect(() => redraw(strokes), [strokes, ink, width])

  const pos = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect()
    // Mouse reports pressure 0.5 while pressed; pens/fingers report real values.
    const p = e.pointerType === 'pen' ? Math.max(0.1, e.pressure) : 0.5
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, p }
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    try { canvasRef.current!.setPointerCapture(e.pointerId) } catch { /* not capturable (e.g. synthetic) — still draw */ }
    const stroke = [pos(e)]
    current.current = stroke
    setStrokes((s) => [...s, stroke])
  }
  const move = (e: React.PointerEvent) => {
    const stroke = current.current
    if (!stroke) return
    // Coalesced events give smooth high-rate strokes; some engines return an empty list.
    const co = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || []
    const events = co.length ? co : [e.nativeEvent]
    for (const ev of events) stroke.push(pos(ev as unknown as React.PointerEvent))
    // React may apply this after pointerup — use the stroke captured above, never the ref.
    const snapshot = [...stroke]
    setStrokes((s) => [...s.slice(0, -1), snapshot])
  }
  const up = () => { current.current = null }

  /** Crop to content (+padding) and return a transparent PNG data URL with its display size. */
  const exportCanvas = (src: HTMLCanvasElement): { url: string; w: number; h: number } | null => {
    const g = src.getContext('2d')!
    const { width: cw, height: ch } = src
    const d = g.getImageData(0, 0, cw, ch).data
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      if (d[(y * cw + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    if (x1 < 0) return null
    const pad = 6 * SCALE
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(cw - 1, x1 + pad); y1 = Math.min(ch - 1, y1 + pad)
    const out = document.createElement('canvas')
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
    out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
    return { url: out.toDataURL('image/png'), w: out.width / SCALE, h: out.height / SCALE }
  }

  /** Imported scan/photo → optionally knock out the paper background (near-white → transparent). */
  const processFile = (img: HTMLImageElement) => {
    const maxW = 1600
    const k = Math.min(1, maxW / img.naturalWidth)
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0, c.width, c.height)
    if (removeBg) {
      const id = g.getImageData(0, 0, c.width, c.height)
      const px = id.data
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
        // Smooth ramp: paper (≥ 225) fully transparent, ink (≤ 150) fully opaque.
        const a = lum >= 225 ? 0 : lum <= 150 ? 255 : Math.round(((225 - lum) / 75) * 255)
        px[i + 3] = Math.min(px[i + 3], a)
      }
      g.putImageData(id, 0, 0)
    }
    return c
  }

  const insert = () => {
    let res: { url: string; w: number; h: number } | null = null
    if (mode === 'draw') res = canvasRef.current ? exportCanvas(canvasRef.current) : null
    else if (fileImg) {
      const c = processFile(fileImg)
      const r = exportCanvasFrom(c)
      res = r
    }
    if (!res) return
    // Typical signature width ≈ 5 cm.
    const targetW = Math.min(190, res.w)
    const h = Math.round((res.h * targetW) / res.w)
    api.editor.chain().focus().insertContent({
      type: 'image',
      attrs: { src: res.url, alt: t('sig.title'), width: Math.round(targetW), height: h, wrap: 'topBottom', align: 'left' },
    }).run()
    close()
  }

  // File variant: crop using alpha after background removal (scale factor 1 → CSS px = px / 2).
  const exportCanvasFrom = (c: HTMLCanvasElement) => {
    const g = c.getContext('2d')!
    const d = g.getImageData(0, 0, c.width, c.height).data
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    if (x1 < 0) return null
    const out = document.createElement('canvas')
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
    out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
    return { url: out.toDataURL('image/png'), w: out.width / 2, h: out.height / 2 }
  }

  const hasInk = strokes.some((s) => s.length)
  return (
    <div className="modal-backdrop app-chrome" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="modal sig-modal" role="dialog" aria-modal="true" aria-label={t('sig.title')} style={{ width: 600 }}>
        <div className="modal-head">
          <h3>{t('sig.title')}</h3>
          <button className="modal-x" onClick={close} aria-label={t('common.close')}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="dlg-tabs">
            <button className={mode === 'draw' ? 'active' : ''} onClick={() => setMode('draw')}>{t('sig.draw')}</button>
            <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>{t('sig.fromFile')}</button>
          </div>
          {mode === 'draw' ? (
            <>
              <div className="sig-pad">
                <canvas ref={canvasRef} width={W * SCALE} height={H * SCALE} style={{ width: '100%', aspectRatio: `${W} / ${H}` }}
                  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={t('sig.pad')} />
                <div className="sig-line"><span>✕</span></div>
                {!hasInk && <div className="sig-hint">{t('sig.hint')}</div>}
              </div>
              <div className="sig-tools">
                {INK.map(([c, n]) => (
                  <button key={c} className={`sig-ink${ink === c ? ' on' : ''}`} title={t(n)} aria-label={t(n)} style={{ background: c }} onClick={() => setInk(c)} />
                ))}
                <label className="sig-width">{t('sig.thickness')}
                  <input type="range" min={1.2} max={5} step={0.2} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
                </label>
                <span className="grow" />
                <button className="btn" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!hasInk}><Undo2 size={14} /> {t('sig.undo')}</button>
                <button className="btn" onClick={() => setStrokes([])} disabled={!hasInk}><Eraser size={14} /> {t('sig.clear')}</button>
              </div>
            </>
          ) : (
            <>
              <button className="bs-big sig-upload" onClick={() => fileRef.current?.click()}><Upload size={20} /> {t('sig.choose')}</button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden-input" onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const r = new FileReader()
                r.onload = () => { const img = new Image(); img.onload = () => setFileImg(img); img.src = r.result as string }
                r.readAsDataURL(f)
                e.target.value = ''
              }} />
              <label className="check"><input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} /> {t('sig.removeBg')}</label>
              {fileImg && <SigPreview img={fileImg} process={processFile} removeBg={removeBg} />}
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="muted small">{t('sig.note')}</span>
          <span className="grow" />
          <button className="btn" onClick={close}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={insert} disabled={mode === 'draw' ? !hasInk : !fileImg}>{t('common.insert')}</button>
        </div>
      </div>
    </div>
  )
}

function SigPreview({ img, process, removeBg }: { img: HTMLImageElement; process: (i: HTMLImageElement) => HTMLCanvasElement; removeBg: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = process(img)
    c.style.maxWidth = '100%'
    c.style.maxHeight = '180px'
    ref.current?.replaceChildren(c)
  }, [img, removeBg])
  return <div className="sig-preview" ref={ref} />
}
