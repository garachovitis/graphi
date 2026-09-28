// The document canvas: page sheets, header/footer, the editing column, zoom, ruler.
import { useEffect, useRef, useState } from 'react'
import { EditorContent } from '@tiptap/react'
import { layoutStore } from '../editor/layoutStore'
import { expandHF, mmToPx } from '../model/settings'
import type { AppApi } from './App'
import { Ruler } from './Ruler'
import { samplePages } from './Training'
import { t } from '../i18n'

export const PAGE_GAP = 20

export function Canvas({ api }: { api: AppApi }) {
  const { editor, settings: s, zoom, view } = api
  const scrollRef = useRef<HTMLDivElement>(null)
  const colRef = useRef<HTMLDivElement>(null)
  const [colH, setColH] = useState(0)

  const pageW = mmToPx(s.width)
  const pageH = mmToPx(s.height)
  const P = pageH + PAGE_GAP
  const mt = mmToPx(s.margins.top)
  const ml = mmToPx(s.margins.left)
  const textW = mmToPx(s.width - s.margins.left - s.margins.right)
  const mb = mmToPx(s.margins.bottom)

  useEffect(() => {
    const el = colRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setColH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pages = view === 'print' ? Math.max(layoutStore.pageCount, Math.ceil((colH + 1) / P)) : 1
  const totalH = view === 'print' ? pages * P - PAGE_GAP : Math.max(pageH, colH + mt + mb)

  // Ctrl/Cmd + wheel zoom, like Word.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      api.setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, api])

  // Clicking empty page area below the text moves the caret to the end (Word behaviour).
  const onPageMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.ProseMirror')) return
    if ((e.target as HTMLElement).closest('.page-hf')) return
    e.preventDefault()
    const pm = editor.view.dom.getBoundingClientRect()
    if (e.clientY > pm.bottom) editor.commands.focus('end')
    else {
      const pos = editor.view.posAtCoords({ left: Math.min(Math.max(e.clientX, pm.left + 1), pm.right - 1), top: e.clientY })
      if (pos) editor.chain().focus().setTextSelection(pos.pos).run()
      else editor.commands.focus()
    }
  }

  const hf = s.hf
  const hfStyle = { left: ml, width: textW }

  return (
    <div className="canvas-scroll" ref={scrollRef}>
      {api.showRuler && view === 'print' && <Ruler api={api} />}
      <div className="canvas-zoom" style={{ width: pageW * zoom, height: totalH * zoom }}>
        <div
          className={`pages${api.showMarks ? ' show-marks' : ''}${view === 'web' ? ' layout-web' : ''}`}
          style={{ width: pageW, height: totalH, transform: `scale(${zoom})` }}
          onMouseDown={onPageMouseDown}
        >
          {Array.from({ length: pages }, (_, i) => {
            const showHF = !(hf.differentFirstPage && i === 0)
            return (
              <div key={i} className="page-sheet" style={{ top: i * P, height: view === 'print' ? pageH : totalH, width: pageW }}
                aria-label={t('canvas.page', { n: i + 1 })}>
                {showHF && hf.headerText && view === 'print' && (
                  <div className="page-hf header" style={{ ...hfStyle, top: mmToPx(hf.headerDistance), textAlign: hf.headerAlign }}
                    onDoubleClick={() => api.openDialog({ type: 'headerFooter' })} title={t('canvas.editHeader')}>
                    {expandHF(hf.headerText, i + 1, pages, s.title)}
                  </div>
                )}
                {showHF && hf.footerText && view === 'print' && (
                  <div className="page-hf footer" style={{ ...hfStyle, bottom: mmToPx(hf.footerDistance), textAlign: hf.footerAlign }}
                    onDoubleClick={() => api.openDialog({ type: 'headerFooter' })} title={t('canvas.editFooter')}>
                    {expandHF(hf.footerText, i + 1, pages, s.title)}
                  </div>
                )}
                {api.training && view === 'print' && i <= samplePages(api.training) && (
                  <div className={`train-tag no-print${i === samplePages(api.training) ? ' mine' : ''}`} style={{ left: ml, top: Math.max(8, mt / 2 - 14) }}>
                    {t(i < samplePages(api.training) ? 'canvas.trSample' : 'canvas.trMine', { n: i + 1 })}
                  </div>
                )}
                {view === 'print' && (
                  <>
                    <div className="hf-hit top" style={{ height: mt * 0.8 }} onDoubleClick={() => api.openDialog({ type: 'headerFooter' })} />
                    <div className="hf-hit bottom" style={{ height: mb * 0.8 }} onDoubleClick={() => api.openDialog({ type: 'headerFooter' })} />
                  </>
                )}
              </div>
            )
          })}
          <div className="editor-column" ref={colRef} style={{ top: mt, left: ml, width: textW }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Page index (1-based) that contains the selection head. */
export function currentPage(api: AppApi): number {
  try {
    const { editor, settings: s, zoom, view } = api
    if (view !== 'print') return 1
    const pagesEl = editor.view.dom.closest('.pages') as HTMLElement | null
    if (!pagesEl) return 1
    const top = pagesEl.getBoundingClientRect().top
    const c = editor.view.coordsAtPos(editor.state.selection.head)
    const y = (c.top - top) / zoom
    return Math.max(1, Math.floor(y / (mmToPx(s.height) + PAGE_GAP)) + 1)
  } catch {
    return 1
  }
}
