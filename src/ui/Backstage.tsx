// File tab ("Backstage"): New from template, Open/recent, Save As formats, Print, Export, Info.
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { generateHTML } from '@tiptap/core'
import { schemaExtensions } from '../editor/extensions'
import { applyDesign, currentStyleSet, stylesCss } from '../model/styles'
import { currentTheme, themeVarsCss } from '../model/themes'
import { DEFAULT_SETTINGS, mmToPx, normalizeSettings } from '../model/settings'
import { ArrowLeft, FilePlus, FolderOpen, Save, SaveAll, Printer, FileOutput, Info, X, FileText, Settings, Check, ChevronRight, GraduationCap } from 'lucide-react'
import type { JSONContent } from '@tiptap/core'
import type { DocSettings } from '../model/settings'
import { LESSONS, LEVEL_BONUS, Stars, isUnlocked, lessonDoc, levelLabel, levelPoints, loadProgress, rankName, rankOf, totalPoints } from './Training'
import { Lock } from 'lucide-react'
import { Ill } from './illustrations'
import { setTheme, useTheme, type ThemeMode } from './theme'
import type { AppApi } from './App'
import { TEMPLATES } from '../model/templates'
import { SAVE_FORMATS } from '../io/kinds'
import { isNative, platform } from '../platform'
import { layoutStore } from '../editor/layoutStore'
import { PAPER_SIZES, cmLabel } from '../model/settings'
import { countWords } from './StatusBar'
import { t, fmtInt, getLang, setLang, useLang, LANGS, type Key, type Lang } from '../i18n'
import { rich } from '../i18n/rich'

export type BackstagePage = 'home' | 'new' | 'open' | 'info' | 'saveas' | 'print' | 'export' | 'appearance' | 'training'

export function Backstage({ api, page, setPage, onClose }: { api: AppApi; page: BackstagePage; setPage: (p: BackstagePage) => void; onClose: () => void }) {
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => { platform.recent().then(setRecent) }, [])
  const nav: [BackstagePage | 'save' | 'close', string, ReactElement][] = [
    ['home', t('bs.home'), <FileText size={17} />],
    ['new', t('bs.new'), <FilePlus size={17} />],
    ['open', t('bs.open'), <FolderOpen size={17} />],
    ['info', t('bs.info'), <Info size={17} />],
    ['save', t('bs.save'), <Save size={17} />],
    ['saveas', t('bs.saveAs'), <SaveAll size={17} />],
    ['print', t('bs.print'), <Printer size={17} />],
    ['export', t('bs.export'), <FileOutput size={17} />],
  ]
  const s = api.settings
  const paper = PAPER_SIZES.find((p) => p.id === s.paper)?.label || t('paper.custom')
  const text = api.editor.state.doc.textBetween(0, api.editor.state.doc.content.size, ' ', ' ')

  const Templates = () => (
    <div className="bs-templates">
      {TEMPLATES.map((tpl) => (
        <button key={tpl.id} className="bs-template" onClick={() => api.newFromTemplate(tpl.id)}>
          <TemplateThumb id={tpl.id} />
          <b>{tpl.name}</b>
          <small>{tpl.description}</small>
        </button>
      ))}
    </div>
  )
  const Recent = () => (
    <div className="bs-recent">
      {!isNative && <p className="muted">{t('bs.recentDesktopOnly')}</p>}
      {isNative && !recent.length && <p className="muted">{t('bs.noRecent')}</p>}
      {recent.map((p) => (
        <button key={p} className="bs-recent-item" onClick={() => api.openPath(p)}>
          <FileText size={18} />
          <span><b>{p.split(/[\\/]/).pop()}</b><small>{p}</small></span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="backstage app-chrome" role="dialog" aria-label={t('qat.file')}>
      <div className="bs-top">
        <button className="bs-back" onClick={onClose} title={`${t('bs.back')} (Esc)`}><ArrowLeft size={17} /> <span>{t('bs.back')}</span></button>
        <div className="bs-top-title">{t('bs.topTitle', { name: api.file.name })}</div>
        <img className="app-mark" src="./icons/logo-mark.png" alt="" aria-hidden draggable={false} />
      </div>
      <div className="bs-body">
      <aside className="bs-nav">
        {nav.map(([id, label, icon]) => (
          <button key={id} className={`bs-nav-item${page === id ? ' active' : ''}`}
            onClick={() => (id === 'save' ? api.save().then((ok) => ok && onClose()) : setPage(id as BackstagePage))}>
            {icon}<span>{label}</span>
          </button>
        ))}
        <div className="bs-nav-spacer" />
        <button className={`bs-nav-item${page === 'appearance' ? ' active' : ''}`} onClick={() => setPage('appearance')}><Settings size={17} /><span>{t('bs.options')}</span></button>
        <button className={`bs-nav-item${page === 'training' ? ' active' : ''}`} onClick={() => setPage('training')}><GraduationCap size={17} /><span>{t('bs.training')}</span></button>
        <button className="bs-nav-item" onClick={onClose}><X size={17} /><span>{t('bs.close')}</span></button>
      </aside>
      <main className="bs-main">
        {page === 'home' && (<><div className="bs-home-head"><div className="bs-home-brand"><img className="bs-logo" src="./icons/logo-mark.png" alt="Grafi" draggable={false} /><h1>{t('bs.welcome')}</h1></div><div className="bs-home-switches"><LangSwitch /><ThemeSwitch onMore={() => setPage('appearance')} /></div></div><h2>{t('bs.startTemplate')}</h2><Templates /><h2>{t('bs.recent')}</h2><Recent /><div className="bs-credit">made by dotgiar</div></>)}
        {page === 'appearance' && (
          <>
            <h1>{t('bs.options')}</h1>
            <p className="muted">{t('opt.lead')}</p>
            <h2>{t('opt.language')}</h2>
            <LangCards />
            <h2>{t('opt.theme')}</h2>
            <p className="muted">{t('opt.themeLead')}</p>
            <ThemeCards />
          </>
        )}
        {page === 'training' && <TrainingLevels api={api} />}
        {page === 'new' && (<><h1>{t('bs.new')}</h1><Templates /></>)}
        {page === 'open' && (
          <>
            <h1>{t('bs.open')}</h1>
            <button className="bs-big" onClick={api.openFile}><FolderOpen size={22} /> {t('bs.browse')}</button>
            <p className="muted">{t('bs.supported')}</p>
            <h2>{t('bs.recent')}</h2><Recent />
          </>
        )}
        {page === 'info' && (
          <>
            <h1>{t('bs.info')}</h1>
            <div className="bs-info">
              <label>{t('bs.title')}<input value={s.title} onChange={(e) => api.setSettings({ ...s, title: e.target.value })} placeholder={t('bs.addTitle')} /></label>
              <label>{t('bs.author')}<input value={s.author} onChange={(e) => api.setSettings({ ...s, author: e.target.value })} placeholder={t('bs.addAuthor')} /></label>
              <dl>
                <dt>{t('bs.file')}</dt><dd>{api.file.path || api.file.name}</dd>
                <dt>{t('bs.pages')}</dt><dd>{fmtInt(layoutStore.pageCount)}</dd>
                <dt>{t('bs.words')}</dt><dd>{fmtInt(countWords(text))}</dd>
                <dt>{t('bs.paper')}</dt><dd>{paper} · {s.orientation === 'portrait' ? t('bs.portrait') : t('bs.landscape')}</dd>
              </dl>
              {api.file.path && isNative && <button className="bs-link" onClick={() => platform.reveal(api.file.path!)}>{t('bs.openLocation')}</button>}
            </div>
          </>
        )}
        {page === 'saveas' && (
          <>
            <h1>{t('bs.saveAs')}</h1>
            <div className="bs-formats">
              {SAVE_FORMATS.map((f) => (
                <button key={f.kind} className="bs-format" onClick={() => api.saveAs(f.kind)}>
                  <span className={`fmt-badge fmt-${f.kind}`}>{f.ext.toUpperCase()}</span>
                  <span><b>{f.label}</b><small>{fmtHint(f.kind)}</small></span>
                </button>
              ))}
            </div>
          </>
        )}
        {page === 'print' && (
          <>
            <h1>{t('bs.print')}</h1>
            <button className="bs-big" onClick={api.print}><Printer size={22} /> {t('bs.printBtn')}</button>
            <dl className="bs-print-summary">
              <dt>{t('bs.pages')}</dt><dd>{fmtInt(layoutStore.pageCount)}</dd>
              <dt>{t('bs.paper')}</dt><dd>{paper} ({cmLabel(s.width)} × {cmLabel(s.height)})</dd>
              <dt>{t('bs.orientation')}</dt><dd>{s.orientation === 'portrait' ? t('lay.portrait') : t('lay.landscape')}</dd>
              <dt>{t('bs.margins')}</dt><dd>{t('bs.marginsShort', { top: cmLabel(s.margins.top), bottom: cmLabel(s.margins.bottom), left: cmLabel(s.margins.left), right: cmLabel(s.margins.right) })}</dd>
            </dl>
            <button className="bs-link" onClick={() => { onClose(); api.openDialog({ type: 'pageSetup' }) }}>{t('bs.pageSetup')}</button>
            <p className="muted">{t('bs.printNote')}</p>
          </>
        )}
        {page === 'export' && (
          <>
            <h1>{t('bs.export')}</h1>
            <div className="bs-formats">
              <button className="bs-format" onClick={api.exportPdf}>
                <span className="fmt-badge fmt-pdf">PDF</span>
                <span><b>{t('bs.createPdf')}</b><small>{t('bs.createPdfHint')}</small></span>
              </button>
              {SAVE_FORMATS.filter((f) => f.kind !== 'pdf').map((f) => (
                <button key={f.kind} className="bs-format" onClick={() => api.saveAs(f.kind)}>
                  <span className={`fmt-badge fmt-${f.kind}`}>{f.ext.toUpperCase()}</span>
                  <span><b>{f.label}</b><small>{fmtHint(f.kind)}</small></span>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
      </div>
    </div>
  )
}

// ───────────── theme ─────────────
const theme = (id: ThemeMode) => ({ id, get name() { return t(`theme.${id}` as Key) }, get hint() { return t(`theme.${id}Hint` as Key) } })
const THEMES: { id: ThemeMode; readonly name: string; readonly hint: string }[] = [theme('system'), theme('light'), theme('dark')]

// ───────────── display language ─────────────
/** Language code shown on the switch (in the language itself, as Word's language list does). */
const LANG_CODE: Record<Lang, string> = { el: 'ΕΛ', en: 'EN' }

/** Compact language switch for the File › Home header. */
function LangSwitch() {
  const lang = useLang()
  return (
    <div className="theme-switch lang-switch" role="radiogroup" aria-label={t('opt.displayLang')}>
      {LANGS.map((l) => (
        <button key={l.id} role="radio" aria-checked={lang === l.id} className={lang === l.id ? 'on' : ''} onClick={() => setLang(l.id)} title={l.native} lang={l.id}>
          <b className="lang-code">{LANG_CODE[l.id]}</b><span>{l.native}</span>
        </button>
      ))}
    </div>
  )
}

function LangCards() {
  const lang = useLang()
  return (
    <>
      <div className="lang-cards" role="radiogroup" aria-label={t('opt.displayLang')}>
        {LANGS.map((l) => (
          <button key={l.id} role="radio" aria-checked={lang === l.id} className={`lang-card${lang === l.id ? ' on' : ''}`} onClick={() => setLang(l.id)} lang={l.id}>
            <b className="lang-code big">{LANG_CODE[l.id]}</b>
            <span><b>{l.native}</b><small>{l.id === 'el' ? 'Greek' : 'Αγγλικά'}</small></span>
            {lang === l.id && <span className="lang-check"><Check size={14} strokeWidth={3} /></span>}
          </button>
        ))}
      </div>
      <p className="muted small">{t('opt.langHint')}</p>
    </>
  )
}

/** Colourful theme icons in the same spirit as the ribbon illustrations. */
export function ThemeIcon({ mode, size = 22 }: { mode: ThemeMode; size?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a)
    return <path key={i} d={`M${16 + c * 10} ${16 + s * 10}L${16 + c * 13} ${16 + s * 13}`} />
  })
  return (
    <svg className="theme-ico" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {mode === 'light' && (<>
        <g stroke="#F59E0B" strokeWidth={2.4} strokeLinecap="round">{rays}</g>
        <circle cx={16} cy={16} r={6.6} fill="#FDE047" stroke="#F59E0B" strokeWidth={1.6} />
        <circle cx={13.8} cy={13.8} r={1.8} fill="#FFF7C2" />
      </>)}
      {mode === 'dark' && (<>
        <path d="M18.5 3.5A12.5 12.5 0 1 0 28.5 23 10 10 0 0 1 18.5 3.5Z" fill="#8B5CF6" stroke="#6D28D9" strokeWidth={1.4} strokeLinejoin="round" />
        <path d="M24 5.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" fill="#FDE047" />
        <circle cx={28} cy={14} r={1.2} fill="#FDE047" />
      </>)}
      {mode === 'system' && (<>
        <defs><clipPath id="ti-scr"><rect x={3.5} y={5} width={25} height={17} rx={2.5} /></clipPath></defs>
        <g clipPath="url(#ti-scr)">
          <rect x={3.5} y={5} width={25} height={17} fill="#FFF4B8" />
          <path d="M20 5h9v17H12Z" fill="#3B2F7A" />
          <circle cx={10} cy={11.5} r={3} fill="#FDE047" stroke="#F59E0B" strokeWidth={1.2} />
          <path d="M23.6 10.2a3.6 3.6 0 1 0 2.9 5.2 3 3 0 0 1-2.9-5.2Z" fill="#C4B5FD" />
        </g>
        <rect x={3.5} y={5} width={25} height={17} rx={2.5} fill="none" stroke="#117470" strokeWidth={1.8} />
        <path d="M16 22v4.5M11 27h10" stroke="#117470" strokeWidth={2} strokeLinecap="round" />
      </>)}
    </svg>
  )
}

/** Compact switch for the File › Home header. */
function ThemeSwitch({ onMore }: { onMore: () => void }) {
  const mode = useTheme()
  return (
    <div className="theme-switch" role="radiogroup" aria-label={t('opt.theme')}>
      {THEMES.map((th) => (
        <button key={th.id} role="radio" aria-checked={mode === th.id} className={mode === th.id ? 'on' : ''} onClick={() => setTheme(th.id)} title={th.hint}>
          <ThemeIcon mode={th.id} size={20} /><span>{th.name}</span>
        </button>
      ))}
      <button className="theme-more" onClick={onMore} title={t('opt.all')}><ChevronRight size={16} /></button>
    </div>
  )
}

type MockPalette = { ribbon: string; canvas: string; line: string; tab: string }
const MOCK: Record<'light' | 'dark', MockPalette> = {
  light: { ribbon: '#ffffff', canvas: '#dfe6e6', line: '#c9d6d6', tab: '#117470' },
  dark: { ribbon: '#1d2626', canvas: '#111818', line: '#3c5050', tab: '#1ab3ac' },
}

/** A miniature of the app window in the given palette. */
function Mock({ p }: { p: MockPalette }) {
  return (
    <span className="tm-win" style={{ '--m-ribbon': p.ribbon, '--m-canvas': p.canvas, '--m-line': p.line, '--m-tab': p.tab } as CSSProperties}>
      <span className="tm-bar"><i /><i /><i /><b /></span>
      <span className="tm-tabs"><em className="on" /><em /><em /><em /></span>
      <span className="tm-ribbon"><u style={{ background: '#1ab3ac' }} /><u style={{ background: '#f59e0b' }} /><u style={{ background: '#3b82f6' }} /><s /><u style={{ background: '#ec4899' }} /><u style={{ background: '#22c55e' }} /></span>
      <span className="tm-canvas">
        <span className="tm-page"><b /><i /><i /><i style={{ width: '70%' }} /><i /><i style={{ width: '55%' }} /></span>
      </span>
      <span className="tm-status" />
    </span>
  )
}

function ThemeCards() {
  const mode = useTheme()
  return (
    <div className="theme-cards" role="radiogroup" aria-label={t('opt.theme')}>
      {THEMES.map((th) => (
        <button key={th.id} role="radio" aria-checked={mode === th.id} className={`theme-card${mode === th.id ? ' on' : ''}`} onClick={() => setTheme(th.id)}>
          <span className="tm-preview">
            {th.id === 'system'
              ? (<><Mock p={MOCK.light} /><span className="tm-half"><Mock p={MOCK.dark} /></span></>)
              : <Mock p={MOCK[th.id]} />}
            {mode === th.id && <span className="tm-check"><Check size={14} strokeWidth={3} /></span>}
          </span>
          <span className="tm-label">
            <ThemeIcon mode={th.id} size={28} />
            <span><b>{th.name}</b><small>{th.hint}</small></span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** File ▸ Training: the five levels, points and rank. */
function TrainingLevels({ api }: { api: AppApi }) {
  const progress = useMemo(loadProgress, [])
  const done = LESSONS.filter((l) => progress[l.id]).length
  const total = totalPoints(progress)
  const nextIdx = LESSONS.findIndex((l) => !progress[l.id])
  return (
    <div className="bs-training">
      <h1>{t('bs.training')}</h1>
      <p className="bs-lead">{rich('bs.trLead')}</p>
      <div className="bs-rank">
        <span className="bs-rank-medal">{done === LESSONS.length ? '👑' : '🎓'}</span>
        <span className="bs-rank-text">
          <small>{t('bs.trRank')}</small>
          <b>{rankOf(progress)}</b>
          <span className="bs-rank-bar"><i style={{ width: `${(done / LESSONS.length) * 100}%` }} /></span>
          <small>{t('bs.trLevelsDone', { done, total: LESSONS.length })}{done < LESSONS.length ? t('bs.trNextRank', { rank: rankName(done + 1) }) : ''}</small>
        </span>
        <span className="bs-rank-points">⭐ {fmtInt(total)}<small>{t('bs.trPoints')}</small></span>
      </div>
      <div className="bs-levels">
        {LESSONS.map((l, i) => {
          const open = isUnlocked(progress, i)
          const got = progress[l.id]
          const isNext = i === nextIdx
          return (
            <div key={l.id} className={`bs-level${open ? '' : ' locked'}${got ? ' done' : ''}${isNext ? ' next' : ''}${l.pro ? ' pro' : ''}`}>
              <span className="bs-level-thumb"><DocThumb id={`lesson-${l.id}`} doc={() => lessonDoc(l.id)} width={96} /></span>
              <span className="bs-level-info">
                <span className="bs-level-badge">{levelLabel(l)}</span>
                <b>{l.name}</b>
                <small>{l.blurb}</small>
                <span className="bs-level-learn">{l.learn.map((ic) => <Ill key={ic} name={ic} size={22} />)}</span>
              </span>
              <span className="bs-level-side">
                {got ? <><Stars n={3} size={22} /><small>{t('bs.trGot', { n: got.points })}</small></> : <small>{t('bs.trUpTo', { n: levelPoints(l) })}</small>}
                {open
                  ? <button className={`bs-level-go${got ? '' : ' primary'}`} onClick={() => api.startTraining(l.id)}>{got ? t('bs.trAgain') : i === 0 ? t('bs.trStart') : t('bs.trStartNext')}</button>
                  : <span className="bs-level-lock"><Lock size={16} /> {t('bs.trLocked', { name: LESSONS[i - 1].pro ? 'Pro' : levelLabel(LESSONS[i - 1]) })}</span>}
              </span>
            </div>
          )
        })}
      </div>
      <p className="muted">{rich('bs.trFooter', { bonus: LEVEL_BONUS })}</p>
    </div>
  )
}

const fmtHint = (kind: string) => t(`fmtHint.${kind}` as Key)

// ───────────── live template thumbnails ─────────────
const thumbCache = new Map<string, { html: string; css: string; pad: string; w: number; h: number }>()

/** Renders the first page of a template exactly as the editor would (its own style set). */
function TemplateThumb({ id }: { id: string }) {
  const tpl = TEMPLATES.find((x) => x.id === id)!
  return <DocThumb id={id} doc={tpl.doc} settings={tpl.settings} />
}

function DocThumb({ id, doc, settings, width = 150 }: { id: string; doc: () => JSONContent; settings?: Partial<DocSettings>; width?: number }) {
  const data = useMemo(() => {
    const key = `${getLang()}:${id}`
    const hit = thumbCache.get(key)
    if (hit) return hit
    const st = normalizeSettings({ ...DEFAULT_SETTINGS, theme: undefined, ...(settings || {}) } as Partial<DocSettings>)
    const prev = [currentStyleSet, currentTheme] as const
    applyDesign(st.styleSet, st.theme)
    const scope = `.tpl-${id} .doc-surface`
    const css = `${scope}{${themeVarsCss(st.theme)}}\n${stylesCss(scope)}`
    applyDesign(...prev)
    const html = generateHTML(doc(), schemaExtensions())
      .replace(/<div data-toc[^>]*><\/div>/g, `<div class="toc"><div class="toc-title">${t('toc.title')}</div></div>`)
    const m = st.margins
    const out = { html, css, pad: `${mmToPx(m.top)}px ${mmToPx(m.right)}px 0 ${mmToPx(m.left)}px`, w: mmToPx(st.width), h: mmToPx(st.height) }
    thumbCache.set(key, out)
    return out
  }, [id, getLang()])
  const W = width
  const k = W / data.w
  return (
    <span className={`bs-thumb tpl-${id}`} style={{ width: W, height: Math.round(data.h * k) }} aria-hidden>
      <style>{data.css}</style>
      <span className="tpl-scale" style={{ width: data.w, height: data.h, padding: data.pad, transform: `scale(${k})` }}>
        <span className="doc-surface" dangerouslySetInnerHTML={{ __html: data.html }} />
      </span>
    </span>
  )
}
