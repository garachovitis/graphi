import { useEffect, useRef, useState } from 'react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { FileText, Monitor, Minus, Plus, SpellCheck, Check } from 'lucide-react'
import { layoutStore } from '../editor/layoutStore'
import type { AppApi } from './App'
import { currentPage } from './Canvas'
import { getProof } from '../editor/Proofing'
import { t, tn, fmtInt } from '../i18n'

export function countWords(text: string) {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.]*/gu)
  return m ? m.length : 0
}

const cache = new WeakMap<PMNode, number>()
const docWords = (doc: PMNode) => {
  let n = cache.get(doc)
  if (n == null) { n = countWords(doc.textBetween(0, doc.content.size, ' ', ' ')); cache.set(doc, n) }
  return n
}

/** Whole-document word count, recomputed at most every 400 ms while typing (O(n) on large docs). */
function useWordCount(doc: PMNode) {
  const [words, setWords] = useState(() => docWords(doc))
  const last = useRef(0)
  const timer = useRef(0)
  useEffect(() => {
    const run = () => { last.current = performance.now(); setWords(docWords(doc)) }
    const wait = 400 - (performance.now() - last.current)
    clearTimeout(timer.current)
    if (wait <= 0) run()
    else timer.current = window.setTimeout(run, wait)
    return () => clearTimeout(timer.current)
  }, [doc])
  return words
}

export function StatusBar({ api }: { api: AppApi }) {
  const { editor } = api
  const { from, to, empty } = editor.state.selection
  const words = useWordCount(editor.state.doc)
  const selWords = empty ? 0 : countWords(editor.state.doc.textBetween(from, to, ' ', ' '))
  const chars = editor.storage.characterCount?.characters?.() ?? 0
  const page = currentPage(api)
  const pages = api.view === 'print' ? layoutStore.pageCount : 1
  const pct = Math.round(api.zoom * 100)
  const slider = Math.round(Math.log(api.zoom) * 100)
  return (
    <footer className="app-chrome statusbar">
      <div className="sb-left">
        <button className="sb-item" onClick={() => api.openDialog({ type: 'goto' })} title={t('sb.gotoTitle')}>{t('sb.page', { page: Math.min(page, pages), pages })}</button>
        <button className="sb-item" onClick={() => api.openDialog({ type: 'wordCount' })} title={t('dlg.wordCount')}>
          {selWords ? t('sb.wordsOf', { sel: fmtInt(selWords), n: words }) : tn('sb.words', words)}
        </button>
        <span className="sb-item muted">{tn('sb.chars', chars)}</span>
        <ProofStatus api={api} />
        <button className="sb-item sb-lang" title={t('sb.langTitle')} onClick={() => api.openBackstage('appearance')}>{t('sb.lang')}</button>
      </div>
      <div className="sb-right">
        <button className={`sb-icon sb-view${api.view === 'print' ? ' active' : ''}`} title={t('view.print')} onClick={() => api.setView('print')}><FileText size={14} /></button>
        <button className={`sb-icon sb-view${api.view === 'web' ? ' active' : ''}`} title={t('view.web')} onClick={() => api.setView('web')}><Monitor size={14} /></button>
        <button className="sb-icon" title={t('sb.zoomOut')} onClick={() => api.run('zoomOut')}><Minus size={13} /></button>
        <input className="zoom-slider" type="range" min={-230} max={161} value={slider} aria-label={t('g.zoom')}
          onChange={(e) => api.setZoom(Math.exp(Number(e.target.value) / 100))} />
        <button className="sb-icon" title={t('sb.zoomIn')} onClick={() => api.run('zoomIn')}><Plus size={13} /></button>
        <button className="sb-item zoom-pct" title={t('view.zoom100')} onClick={() => api.setZoom(1)}>{pct}%</button>
      </div>
    </footer>
  )
}

/** Word's proofing indicator: issue count, opens the panel. */
function ProofStatus({ api }: { api: AppApi }) {
  const st = getProof(api.editor.state)
  if (!api.spellcheck && !api.proofOpen) return null
  const n = st.issues.length
  return (
    <button className={`sb-item sb-proof${api.proofOpen ? ' active' : ''}`} title={t('pf.sbTitle')} aria-label={`${t('pf.sbTitle')} — ${tn('pf.count', n)}`}
      onClick={() => api.setProofOpen(!api.proofOpen)}>
      <SpellCheck size={14} />
      {st.status === 'ready' && (n ? <span className="sb-badge">{fmtInt(n)}</span> : <Check size={13} />)}
    </button>
  )
}
