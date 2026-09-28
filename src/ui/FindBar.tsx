import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { ChevronDown, ChevronUp, X, CaseSensitive, WholeWord, Regex } from 'lucide-react'
import { searchKey } from '../editor/SearchReplace'
import { toast } from './toast'
import { t, tn } from '../i18n'

export function FindBar({ editor, mode, setMode, onClose }: { editor: Editor; mode: 'find' | 'replace'; setMode: (m: 'find' | 'replace') => void; onClose: () => void }) {
  const initial = editor.state.selection.empty ? '' : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to).slice(0, 200)
  const [query, setQuery] = useState(initial)
  const [repl, setRepl] = useState('')
  const [opts, setOpts] = useState({ caseSensitive: false, wholeWord: false, regex: false, diacritics: false })
  const inputRef = useRef<HTMLInputElement>(null)
  const st = searchKey.getState(editor.state)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [mode])
  useEffect(() => { editor.commands.setSearch({ query, ...opts }) }, [query, opts, editor])

  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }))
  const total = st?.matches.length || 0
  const idx = st && st.index >= 0 ? st.index + 1 : 0

  return (
    <div className="findbar no-print" role="search" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className="fb-row">
        <input ref={inputRef} className="fb-input" placeholder={t('find.placeholder')} value={query} aria-label={t('find.aria')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? editor.commands.findPrev() : editor.commands.findNext() } }} />
        <span className="fb-count">{query ? (total ? t('find.count', { i: idx, n: total }) : t('find.none')) : ''}</span>
        <button className={`fb-opt${opts.caseSensitive ? ' on' : ''}`} title={t('find.matchCase')} onClick={() => toggle('caseSensitive')}><CaseSensitive size={15} /></button>
        <button className={`fb-opt${opts.wholeWord ? ' on' : ''}`} title={t('find.wholeWords')} onClick={() => toggle('wholeWord')}><WholeWord size={15} /></button>
        <button className={`fb-opt${opts.diacritics ? ' on' : ''}`} title={t('find.diacritics')} onClick={() => toggle('diacritics')}>ά</button>
        <button className={`fb-opt${opts.regex ? ' on' : ''}`} title={t('find.regex')} onClick={() => toggle('regex')}><Regex size={15} /></button>
        <button className="fb-btn" title={`${t('find.prev')} (⇧↵)`} onClick={() => editor.commands.findPrev()} disabled={!total}><ChevronUp size={15} /></button>
        <button className="fb-btn" title={`${t('find.next')} (↵)`} onClick={() => editor.commands.findNext()} disabled={!total}><ChevronDown size={15} /></button>
        <button className="fb-btn" title={mode === 'find' ? t('find.replace') : t('find.findOnly')} onClick={() => setMode(mode === 'find' ? 'replace' : 'find')}>⇄</button>
        <button className="fb-btn" title={`${t('common.close')} (Esc)`} onClick={onClose}><X size={15} /></button>
      </div>
      {mode === 'replace' && (
        <div className="fb-row">
          <input className="fb-input" placeholder={t('find.replaceWith')} value={repl} aria-label={t('find.replaceWith')}
            onChange={(e) => setRepl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.replaceCurrent(repl); editor.commands.findNext() } }} />
          <button className="fb-text" disabled={!total} onClick={() => { editor.commands.replaceCurrent(repl) }}>{t('find.replace')}</button>
          <button className="fb-text" disabled={!total} onClick={() => { const n = total; editor.commands.replaceAll(repl); setTimeout(() => alertCount(n), 0) }}>{t('find.replaceAll')}</button>
        </div>
      )}
    </div>
  )
}

function alertCount(n: number) {
  toast(tn('find.done', n))
}
