// Proofing side panel (Word's Editor pane, done calmer): one card per issue in document order,
// filters per kind, one-click fixes, "fix all simple issues", full keyboard flow, and a small
// suggestion popover on the underlined words themselves.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X, Check, WandSparkles, CircleCheck, ShieldCheck, ArrowRight } from 'lucide-react'
import type { EditorView } from '@tiptap/pm/view'
import type { AppApi } from './App'
import {
  addIssueToDictionary, applyAllSafe, applyIssue, getProof, ignoreIssue, neighbour, proofConfig, revealPos,
  setActiveIssue, setHoverIssue, setProofConfig, type Issue, type IssueKind,
} from '../editor/Proofing'
import { el } from '../i18n/el'
import { t, tn, type Key } from '../i18n'
import { toast } from './toast'

const KINDS: IssueKind[] = ['spelling', 'grammar', 'punct', 'style']

const has = (k: string): k is Key => k in el
export const issueTitle = (i: Issue) => (has(`pf.r.${i.rule}`) ? t(`pf.r.${i.rule}` as Key) : i.title || t(`pf.k.${i.kind}` as Key))
const issueText = (i: Issue) => (has(`pf.r.${i.rule}.d`) ? t(`pf.r.${i.rule}.d` as Key) : i.msg || '')

/** Spaces made visible where they are the point of the fix. */
const vis = (s: string) => s.replace(/ /g, '·').replace(/\n/g, '↵')
const showWs = (i: Issue) => /^\s*$/.test(i.text) || /^\s|\s$/.test(i.text) || /^\s|\s$/.test(i.sugg[0] ?? '') || i.kind === 'punct'

function Preview({ issue, sugg }: { issue: Issue; sugg?: string }) {
  const s = sugg ?? issue.sugg[0]
  const ws = showWs(issue)
  // a few words of context on each side, cut at word boundaries
  const before = issue.before.length > 22 ? `…${issue.before.slice(-22).replace(/^\S*\s/, '')}` : issue.before
  const after = issue.after.length > 22 ? `${issue.after.slice(0, 22).replace(/\s\S*$/, '')}…` : issue.after
  if (issue.rule === 'longSentence') return <div className="pp-preview">{issue.text.slice(0, 90)}{issue.text.length > 90 ? '…' : ''}</div>
  return (
    <div className="pp-preview">
      <span className="pp-ctx">{before}</span>
      <del className={s != null ? 'x' : ''}>{ws ? vis(issue.text) : issue.text}</del>
      {s != null && s !== '' && <ins>{ws ? vis(s) : s}</ins>}
      <span className="pp-ctx">{after}</span>
    </div>
  )
}

function suggLabel(s: string, issue: Issue) {
  // fixes that only add or remove spaces read better as words than as «.·»
  if (!issue.text.trim() && !s) return t('pf.removeSpace')
  if (!issue.text.trim() && s === ' ') return t('pf.oneSpace')
  if (s.trim() === issue.text.trim() && s.length > issue.text.length) return t('pf.addSpace')
  if (s === '') return `${t('pf.delete')}${issue.text.trim() ? ` «${issue.text.trim()}»` : ''}`
  return showWs(issue) ? vis(s) : s
}

function IssueActions({ view, issue, onDone, compact }: { view: EditorView; issue: Issue; onDone: (applied: boolean) => void; compact?: boolean }) {
  const accept = (s: string) => { if (applyIssue(view, issue, s)) onDone(true); else onDone(false) }
  const spelling = issue.kind === 'spelling' && issue.rule !== 'phrase'
  return (
    <>
      {issue.sugg.length ? (
        <div className="pp-suggs">
          {issue.sugg.slice(0, compact ? 4 : 5).map((s, k) => (
            <button key={k} className={`pp-sugg${k === 0 ? ' primary' : ''}`} title={t('pf.acceptTitle', { s: s || t('pf.delete') })}
              onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); accept(s) }}>
              {suggLabel(s, issue)}
            </button>
          ))}
        </div>
      ) : <p className="pp-nosugg">{t('pf.noSugg')}</p>}
      <div className="pp-actions">
        <button title={t('pf.ignoreTitle')} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); ignoreIssue(view, issue); onDone(false) }}>{t('pf.ignore')}</button>
        {spelling && <button title={t('pf.addDictTitle')} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); addIssueToDictionary(view, issue); onDone(false) }}>{t('pf.addDict')}</button>}
      </div>
    </>
  )
}

export function ProofPanel({ api, onClose }: { api: AppApi; onClose: () => void }) {
  const view = api.editor.view
  const st = getProof(api.editor.state)
  const [filter, setFilter] = useState<IssueKind | 'all'>('all')
  const [cfg, setCfg] = useState(proofConfig)
  const listRef = useRef<HTMLDivElement>(null)
  const resumeAt = useRef<number | null>(null)

  const counts = Object.fromEntries(KINDS.map((k) => [k, st.issues.filter((i) => i.kind === k).length])) as Record<IssueKind, number>
  const shown = filter === 'all' ? st.issues : st.issues.filter((i) => i.kind === filter)
  const safe = shown.filter((i) => i.safe && i.sugg.length).length
  const active = shown.find((i) => i.id === st.active) ?? null

  // Keep going after a fix: the next issue at or after the one just handled becomes active.
  useEffect(() => {
    if (resumeAt.current == null || st.active) return
    const next = shown.find((i) => i.from >= resumeAt.current!) ?? shown[0]
    resumeAt.current = null
    if (next) setActiveIssue(view, next.id, true)
  }, [st.issues])

  // The active card stays in view.
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector('.pp-card.open') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [st.active])

  useEffect(() => () => { setHoverIssue(view, null) }, [view])

  const activate = (i: Issue) => setActiveIssue(view, i.id, true)
  const done = (i: Issue) => (applied: boolean) => {
    resumeAt.current = i.from
    if (!applied) setActiveIssue(view, null)
    listRef.current?.focus({ preventScroll: true })
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = neighbour(shown, st.active, e.key === 'ArrowDown' ? 1 : -1)
      if (n) activate(n)
    } else if (e.key === 'Enter' && active) {
      e.preventDefault()
      if (active.sugg.length && applyIssue(view, active, active.sugg[0])) done(active)(true)
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && active) {
      e.preventDefault()
      ignoreIssue(view, active)
      done(active)(false)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const fixAll = () => {
    const n = applyAllSafe(view, filter === 'all' ? undefined : filter)
    if (n) toast(tn('pf.fixed', n))
  }
  const setOpt = (c: Partial<typeof cfg>) => { setProofConfig(c); setCfg(proofConfig()) }

  return (
    <aside className="proof-panel no-print" aria-label={t('pf.title')} onKeyDown={onKey}>
      <header className="pp-head">
        <div className="pp-title">{t('pf.title')}</div>
        {st.status === 'ready' && <span className="pp-total">{tn('pf.count', st.issues.length)}</span>}
        <button className="pp-x" title={`${t('common.close')} (Esc)`} aria-label={t('common.close')} onClick={onClose}><X size={16} /></button>
      </header>

      <div className="pp-filters" role="tablist">
        <button role="tab" aria-selected={filter === 'all'} className={`pp-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
          {t('pf.all')} <b>{st.issues.length}</b>
        </button>
        {KINDS.map((k) => (
          <button key={k} role="tab" aria-selected={filter === k} className={`pp-chip k-${k}${filter === k ? ' on' : ''}`} disabled={!counts[k] && filter !== k}
            onClick={() => setFilter(filter === k ? 'all' : k)}>
            <i className="pp-dot" />{t(`pf.k.${k}` as Key)} <b>{counts[k]}</b>
          </button>
        ))}
      </div>

      {safe > 1 && (
        <button className="pp-fixall" title={t('pf.fixAllTitle')} onClick={fixAll}>
          <WandSparkles size={15} /> {tn('pf.fixAll', safe)}
        </button>
      )}

      <div className="pp-list" ref={listRef} tabIndex={0} role="listbox" aria-label={t('pf.title')}>
        {st.status === 'loading' && !st.issues.length && (
          <div className="pp-loading"><span className="pp-spin" />{t('pf.loading')}</div>
        )}
        {st.status === 'ready' && !shown.length && (
          <div className="pp-empty">
            <CircleCheck size={40} strokeWidth={1.5} />
            <div className="pp-empty-title">{filter === 'all' ? t('pf.clean') : t('pf.cleanFiltered')}</div>
            {filter === 'all' && <div className="pp-empty-sub">{t('pf.cleanSub')}</div>}
          </div>
        )}
        {shown.map((i) => {
          const open = i.id === st.active
          return (
            <div key={i.id} role="option" aria-selected={open} className={`pp-card k-${i.kind}${open ? ' open' : ''}`}
              onMouseEnter={() => setHoverIssue(view, i.id)} onMouseLeave={() => setHoverIssue(view, null)}
              onClick={() => (open ? revealPos(view, i.from) : activate(i))}>
              <div className="pp-card-top">
                <i className="pp-dot" />
                <span className="pp-rule">{issueTitle(i)}</span>
                {!open && i.sugg.length > 0 && (
                  <button className="pp-quick" title={t('pf.acceptTitle', { s: i.sugg[0] || t('pf.delete') })} aria-label={t('pf.acceptTitle', { s: i.sugg[0] || t('pf.delete') })}
                    onClick={(e) => { e.stopPropagation(); if (applyIssue(view, i, i.sugg[0])) done(i)(true) }}>
                    <Check size={14} />
                  </button>
                )}
              </div>
              <Preview issue={i} />
              {open && (
                <div className="pp-body">
                  {issueText(i) && <p className="pp-msg">{issueText(i)}</p>}
                  <IssueActions view={view} issue={i} onDone={done(i)} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <footer className="pp-foot">
        {shown.length > 0 && <div className="pp-keys">{t('pf.keys')}</div>}
        <label className="pp-opt">
          <input type="checkbox" checked={cfg.live} onChange={(e) => setOpt({ live: e.target.checked })} />
          <span>{t('pf.live')}</span>
        </label>
        <label className="pp-opt" title={t('pf.onlineHint')}>
          <input type="checkbox" checked={cfg.online} onChange={(e) => setOpt({ online: e.target.checked })} />
          <span>{t('pf.online')}</span>
        </label>
        <div className="pp-privacy">
          <ShieldCheck size={13} /> {cfg.online ? t('pf.onlineHint') : t('pf.private')}
        </div>
      </footer>
    </aside>
  )
}

/** Suggestions right on the underlined word (click or right-click), like Google Docs. */
export function ProofPopover({ api, panelOpen, openPanel }: { api: AppApi; panelOpen: boolean; openPanel: () => void }) {
  const view = api.editor.view
  const [at, setAt] = useState<{ id: string; rect: DOMRect } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const target = (e: Event) => (e.target as HTMLElement | null)?.closest?.('[data-pf]') as HTMLElement | null
    const onClick = (e: MouseEvent) => {
      const el = target(e)
      if (!el || e.button !== 0) return
      const id = el.dataset.pf!
      if (panelOpen) { setActiveIssue(view, id); return }
      // not while extending a selection
      setTimeout(() => { if (view.state.selection.empty) setAt({ id, rect: el.getBoundingClientRect() }) }, 0)
    }
    const onMenu = (e: MouseEvent) => {
      const el = target(e)
      if (!el) return
      e.preventDefault()
      const id = el.dataset.pf!
      if (panelOpen) setActiveIssue(view, id)
      setAt({ id, rect: el.getBoundingClientRect() })
    }
    view.dom.addEventListener('click', onClick)
    view.dom.addEventListener('contextmenu', onMenu)
    return () => { view.dom.removeEventListener('click', onClick); view.dom.removeEventListener('contextmenu', onMenu) }
  }, [view, panelOpen])

  const issue = at ? getProof(api.editor.state).issues.find((i) => i.id === at.id) ?? null : null

  useEffect(() => {
    if (!at) return
    const close = (e: Event) => { if (!boxRef.current?.contains(e.target as Node)) setAt(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null) }
    const scroller = view.dom.closest('.canvas-scroll')
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', key, true)
    scroller?.addEventListener('scroll', () => setAt(null), { once: true })
    return () => { window.removeEventListener('mousedown', close, true); window.removeEventListener('keydown', key, true) }
  }, [at, view])

  // The issue went away (typed over, fixed elsewhere) → close.
  useEffect(() => { if (at && !issue) setAt(null) }, [at, issue])

  useLayoutEffect(() => {
    if (!at || !boxRef.current) { setPos(null); return }
    const b = boxRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(at.rect.left, window.innerWidth - b.width - 8))
    const below = at.rect.bottom + 6
    const top = below + b.height > window.innerHeight - 8 ? Math.max(8, at.rect.top - b.height - 6) : below
    setPos({ left, top })
  }, [at, issue?.id])

  if (!at || !issue) return null
  return (
    <div ref={boxRef} className={`pf-pop k-${issue.kind} no-print`} role="dialog" aria-label={issueTitle(issue)}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
      <div className="pp-card-top"><i className="pp-dot" /><span className="pp-rule">{issueTitle(issue)}</span></div>
      <IssueActions view={view} issue={issue} compact onDone={() => setAt(null)} />
      {!panelOpen && (
        <button className="pf-pop-more" onClick={() => { setActiveIssue(view, issue.id); setAt(null); openPanel() }}>
          {t('pf.more')} <ArrowRight size={13} />
        </button>
      )}
    </div>
  )
}
