// Title-bar search for Grafi's own commands (like Word's "Tell me"), not the document text.
// The index is read from the ribbon itself: every control carries a title, so nothing has to be
// kept in sync by hand. Picking a result switches to its tab and highlights the control.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, FileSearch } from 'lucide-react'
import { t } from '../i18n'
import { modKey } from '../platform'

export interface CmdEntry {
  tab: string
  tabLabel: string
  group: string
  label: string
  /** position among the tab's indexed controls, to find it again in the live ribbon */
  n: number
}

/** Controls worth listing; split-button arrows just repeat their main button. */
export const CMD_SELECTOR = '.rb-btn[title]:not(.rb-split-arrow), .combo[title], .rb-launcher[title]'

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ς/g, 'σ').toLowerCase()

function rank(e: CmdEntry, words: string[]): number {
  const label = norm(e.label)
  const hay = `${label} ${norm(e.group)} ${norm(e.tabLabel)}`
  if (!words.every((w) => hay.includes(w))) return -1
  if (label.startsWith(words.join(' '))) return 3
  if (words.every((w) => label.includes(w))) return label.split(/\s+/).some((x) => x.startsWith(words[0])) ? 2 : 1
  return 0
}

export function CommandSearch({ index, onOpen, onPick, onFindInDoc }: {
  index: CmdEntry[]
  /** (re)build the index — called whenever the box gets focus */
  onOpen: () => void
  onPick: (e: CmdEntry) => void
  onFindInDoc: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return index
      .map((e) => ({ e, r: rank(e, words) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => b.r - a.r)
      .slice(0, 12)
      .map((x) => x.e)
  }, [q, index])
  // one extra row at the end: search the document instead
  const count = results.length + 1

  useEffect(() => setSel(0), [q])

  // Alt+Q focuses the box, as in Word ("Tell me").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyQ') { e.preventDefault(); inputRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const close = () => { setOpen(false); setQ(''); inputRef.current?.blur() }
  const choose = (i: number) => {
    if (i < results.length) { const e = results[i]; close(); onPick(e) }
    else { close(); onFindInDoc() }
  }

  return (
    <div className="cmd-search" role="search">
      <Search size={14} className="cmd-icon" />
      <input
        ref={inputRef}
        className="cmd-input"
        value={q}
        placeholder={t('cmd.placeholder')}
        title={t('cmd.title')}
        aria-label={t('cmd.placeholder')}
        role="combobox"
        aria-expanded={open && !!q}
        aria-controls="cmd-results"
        spellCheck={false}
        onFocus={() => { onOpen(); setOpen(true) }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % count) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + count) % count) }
          else if (e.key === 'Enter' && q.trim()) { e.preventDefault(); choose(sel) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
        }}
      />
      {open && q.trim() && (
        <div className="cmd-results" id="cmd-results" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {results.length === 0 && <div className="cmd-none">{t('cmd.none')}</div>}
          {results.map((r, i) => (
            <button key={`${r.tab}:${r.n}`} role="option" aria-selected={i === sel} className={`cmd-item${i === sel ? ' sel' : ''}`}
              onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
              <span className="cmd-label">{r.label}</span>
              <span className="cmd-where">{r.group ? `${r.tabLabel} › ${r.group}` : r.tabLabel}</span>
            </button>
          ))}
          <button role="option" aria-selected={sel === results.length} className={`cmd-item cmd-doc${sel === results.length ? ' sel' : ''}`}
            onMouseEnter={() => setSel(results.length)} onClick={() => choose(results.length)}>
            <FileSearch size={14} />
            <span className="cmd-label">{t('cmd.findInDoc')}</span>
            <span className="cmd-where">{modKey}F</span>
          </button>
        </div>
      )}
    </div>
  )
}
