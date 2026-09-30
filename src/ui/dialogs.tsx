// Modal dialogs.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { AppApi } from './App'
import {
  PAPER_SIZES, MARGIN_PRESETS, withOrientation, withPaper, type DocSettings, type HFAlign, mmToPx,
} from '../model/settings'
import { FONT_CHOICES, fontHint, fontLabel, fontStack } from '../model/styles'
import { currentFontFamily, currentFontSizePt, currentStyle, FONT_SIZES } from '../editor/format'
import { layoutStore } from '../editor/layoutStore'
import { countWords } from './StatusBar'
import { modKey, platform } from '../platform'
import { PAGE_GAP } from './Canvas'
import { parseLocale, ColorWell } from './controls'
import { resolveColor } from '../model/themes'
import { SignatureDialog } from './SignatureDialog'
import { ThemeStudio } from './ThemeTools'
import type { DocTheme } from '../model/themes'
import { t, fmtInt, fmtNum, decSep, type Key } from '../i18n'

export type DialogState =
  | null
  | { type: 'table' | 'link' | 'symbol' | 'headerFooter' | 'font' | 'paragraph' | 'pageSetup' | 'wordCount' | 'shortcuts' | 'imageUrl' | 'listStart' | 'goto' | 'signature' }
  | { type: 'theme'; theme?: DocTheme }

export function Modal(p: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.modal-x)')
    first?.focus()
  }, [])
  return (
    <div className="modal-backdrop app-chrome" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={p.title} ref={ref} style={{ width: p.width || 460 }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose() } }}>
        <div className="modal-head">
          <h3>{p.title}</h3>
          <button className="modal-x" onClick={p.onClose} aria-label={t('common.close')}><X size={16} /></button>
        </div>
        <div className="modal-body">{p.children}</div>
        {p.footer && <div className="modal-foot">{p.footer}</div>}
      </div>
    </div>
  )
}

const Field = (p: { label: string; children: ReactNode; wide?: boolean }) => (
  <label className={`field${p.wide ? ' wide' : ''}`}><span>{p.label}</span>{p.children}</label>
)

function Cm(p: { value: number; onChange: (mm: number) => void; min?: number }) {
  const show = (mm: number) => (mm / 10).toFixed(2).replace('.', decSep())
  const [text, setText] = useState(show(p.value))
  useEffect(() => setText(show(p.value)), [p.value])
  const commit = () => {
    const n = parseLocale(text)
    if (n == null) return setText(show(p.value))
    p.onChange(Math.max(p.min ?? 0, n * 10))
  }
  return <span className="unit-input"><input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} /><i>{t('unit.cm')}</i></span>
}

function Pt(p: { value: number; onChange: (pt: number) => void; step?: number }) {
  return <span className="unit-input"><input type="number" step={p.step ?? 1} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} /><i>{t('unit.pt')}</i></span>
}

const Footer = (p: { onOk: () => void; onCancel: () => void; okLabel?: string; extra?: ReactNode }) => (
  <>
    {p.extra}
    <span className="grow" />
    <button className="btn" onClick={p.onCancel}>{t('common.cancel')}</button>
    <button className="btn primary" onClick={p.onOk}>{p.okLabel || t('common.ok')}</button>
  </>
)

export function Dialogs({ api, dialog, close }: { api: AppApi; dialog: DialogState; close: () => void }) {
  if (!dialog) return null
  switch (dialog.type) {
    case 'pageSetup': return <PageSetup api={api} close={close} />
    case 'paragraph': return <ParagraphDlg api={api} close={close} />
    case 'font': return <FontDlg api={api} close={close} />
    case 'headerFooter': return <HeaderFooterDlg api={api} close={close} />
    case 'table': return <TableDlg api={api} close={close} />
    case 'link': return <LinkDlg api={api} close={close} />
    case 'imageUrl': return <ImageUrlDlg api={api} close={close} />
    case 'symbol': return <SymbolDlg api={api} close={close} />
    case 'wordCount': return <WordCountDlg api={api} close={close} />
    case 'shortcuts': return <ShortcutsDlg close={close} />
    case 'listStart': return <ListStartDlg api={api} close={close} />
    case 'goto': return <GotoDlg api={api} close={close} />
    case 'signature': return <SignatureDialog api={api} close={close} />
    case 'theme': return <ThemeStudio api={api} close={close} initial={dialog.theme} />
  }
}

// ───────────── Page setup ─────────────
function PageSetup({ api, close }: { api: AppApi; close: () => void }) {
  const [s, set] = useState<DocSettings>(api.settings)
  const [tab, setTab] = useState<'margins' | 'paper' | 'layout'>('margins')
  const m = (k: keyof DocSettings['margins'], v: number) => set({ ...s, margins: { ...s.margins, [k]: v } })
  const textW = s.width - s.margins.left - s.margins.right
  const textH = s.height - s.margins.top - s.margins.bottom
  const valid = textW >= 20 && textH >= 20
  const scale = 120 / Math.max(s.width, s.height)
  return (
    <Modal title={t('dlg.pageSetup')} onClose={close} width={560}
      footer={<Footer onCancel={close} onOk={() => { if (valid) { api.setSettings(s); close() } }}
        extra={!valid && <span className="err">{t('dlg.marginsTooBig')}</span>} />}>
      <div className="dlg-tabs">
        {([['margins', 'dlg.tabMargins'], ['paper', 'dlg.tabPaper'], ['layout', 'dlg.tabLayout']] as const).map(([id, l]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{t(l)}</button>
        ))}
      </div>
      <div className="dlg-split">
        <div className="dlg-grid">
          {tab === 'margins' && (
            <>
              <Field label={t('common.top')}><Cm value={s.margins.top} onChange={(v) => m('top', v)} /></Field>
              <Field label={t('common.bottom')}><Cm value={s.margins.bottom} onChange={(v) => m('bottom', v)} /></Field>
              <Field label={t('common.left')}><Cm value={s.margins.left} onChange={(v) => m('left', v)} /></Field>
              <Field label={t('common.right')}><Cm value={s.margins.right} onChange={(v) => m('right', v)} /></Field>
              <Field label={t('dlg.presets')} wide>
                <select value="" onChange={(e) => { const p = MARGIN_PRESETS.find((x) => x.id === e.target.value); if (p) set({ ...s, margins: { ...p.m } }) }}>
                  <option value="">{t('dlg.choose')}</option>
                  {MARGIN_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
              <Field label={t('dlg.orientation')} wide>
                <div className="seg">
                  <button className={s.orientation === 'portrait' ? 'on' : ''} onClick={() => set(withOrientation(s, 'portrait'))}>{t('lay.portrait')}</button>
                  <button className={s.orientation === 'landscape' ? 'on' : ''} onClick={() => set(withOrientation(s, 'landscape'))}>{t('lay.landscape')}</button>
                </div>
              </Field>
            </>
          )}
          {tab === 'paper' && (
            <>
              <Field label={t('dlg.paperSize')} wide>
                <select value={s.paper} onChange={(e) => (e.target.value === 'custom' ? set({ ...s, paper: 'custom' }) : set(withPaper(s, e.target.value)))}>
                  {PAPER_SIZES.map((p) => <option key={p.id} value={p.id}>{p.label} ({fmtNum(p.w / 10)} × {fmtNum(p.h / 10)} {t('unit.cm')})</option>)}
                  <option value="custom">{t('paper.customSize')}</option>
                </select>
              </Field>
              <Field label={t('common.width')}><Cm value={s.width} min={50} onChange={(v) => set({ ...s, paper: 'custom', width: v })} /></Field>
              <Field label={t('common.height')}><Cm value={s.height} min={50} onChange={(v) => set({ ...s, paper: 'custom', height: v })} /></Field>
            </>
          )}
          {tab === 'layout' && (
            <>
              <Field label={t('dlg.headerFromEdge')}><Cm value={s.hf.headerDistance} onChange={(v) => set({ ...s, hf: { ...s.hf, headerDistance: v } })} /></Field>
              <Field label={t('dlg.footerFromEdge')}><Cm value={s.hf.footerDistance} onChange={(v) => set({ ...s, hf: { ...s.hf, footerDistance: v } })} /></Field>
              <label className="check wide"><input type="checkbox" checked={s.hf.differentFirstPage} onChange={(e) => set({ ...s, hf: { ...s.hf, differentFirstPage: e.target.checked } })} /> {t('dlg.differentFirst')}</label>
            </>
          )}
        </div>
        <div className="page-preview" aria-hidden>
          <div className="pp-sheet" style={{ width: s.width * scale, height: s.height * scale }}>
            <div className="pp-text" style={{ top: s.margins.top * scale, left: s.margins.left * scale, right: s.margins.right * scale, bottom: s.margins.bottom * scale }}>
              {Array.from({ length: 14 }, (_, i) => <i key={i} />)}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ───────────── Paragraph ─────────────
function ParagraphDlg({ api, close }: { api: AppApi; close: () => void }) {
  const e = api.editor
  const para = e.state.selection.$from.parent.attrs
  const st = currentStyle(e)
  const ptToCm = (pt: number) => (pt / 72) * 25.4
  const cmToPt = (mm: number) => Math.round((mm / 25.4) * 72 * 10) / 10
  const [align, setAlign] = useState<string>(para.textAlign || st.align || 'left')
  const [left, setLeft] = useState(ptToCm(para.indentLeft || 0))
  const [right, setRight] = useState(ptToCm(para.indentRight || 0))
  const fl = para.firstLine || 0
  const [special, setSpecial] = useState<'none' | 'first' | 'hanging'>(fl > 0 ? 'first' : fl < 0 ? 'hanging' : 'none')
  const [by, setBy] = useState(ptToCm(Math.abs(fl)) || 12.7)
  const [before, setBefore] = useState<number>(para.spaceBefore ?? st.spaceBeforePt)
  const [after, setAfter] = useState<number>(para.spaceAfter ?? st.spaceAfterPt)
  const lhRaw = String(para.lineHeight ?? st.lineHeight)
  const exact = lhRaw.endsWith('pt')
  const lhNum = parseFloat(lhRaw)
  const initialRule = exact ? 'exact' : lhNum === 1 ? 'single' : lhNum === 1.5 ? 'onehalf' : lhNum === 2 ? 'double' : 'multiple'
  const [rule, setRule] = useState(initialRule)
  const [lhVal, setLhVal] = useState(exact ? lhNum : lhNum)
  const [keepNext, setKeepNext] = useState(!!para.keepNext)
  const [pbb, setPbb] = useState(!!para.pageBreakBefore)

  const apply = () => {
    const lineHeight = rule === 'single' ? '1' : rule === 'onehalf' ? '1.5' : rule === 'double' ? '2' : rule === 'exact' ? `${lhVal}pt` : String(lhVal)
    e.chain().focus()
      .setTextAlign(align)
      .setParagraphAttrs({
        indentLeft: left ? cmToPt(left) : null,
        indentRight: right ? cmToPt(right) : null,
        firstLine: special === 'none' ? null : special === 'first' ? cmToPt(by) : -cmToPt(by),
        spaceBefore: before, spaceAfter: after, lineHeight, keepNext, pageBreakBefore: pbb,
      })
      .run()
    close()
  }
  return (
    <Modal title={t('dlg.paragraph')} onClose={close} width={520} footer={<Footer onOk={apply} onCancel={close} />}>
      <fieldset><legend>{t('dlg.general')}</legend>
        <Field label={t('dlg.alignment')}>
          <select value={align} onChange={(ev) => setAlign(ev.target.value)}>
            <option value="left">{t('common.left')}</option><option value="center">{t('common.center')}</option><option value="right">{t('common.right')}</option><option value="justify">{t('common.justify')}</option>
          </select>
        </Field>
      </fieldset>
      <fieldset><legend>{t('dlg.indentation')}</legend>
        <div className="dlg-grid">
          <Field label={t('common.left')}><Cm value={left} onChange={setLeft} /></Field>
          <Field label={t('common.right')}><Cm value={right} onChange={setRight} /></Field>
          <Field label={t('dlg.special')}>
            <select value={special} onChange={(ev) => setSpecial(ev.target.value as any)}>
              <option value="none">{t('dlg.specialNone')}</option><option value="first">{t('dlg.firstLine')}</option><option value="hanging">{t('dlg.hanging')}</option>
            </select>
          </Field>
          <Field label={t('dlg.by')}><Cm value={by} onChange={setBy} /></Field>
        </div>
      </fieldset>
      <fieldset><legend>{t('dlg.spacing')}</legend>
        <div className="dlg-grid">
          <Field label={t('dlg.before')}><Pt value={before} step={6} onChange={setBefore} /></Field>
          <Field label={t('dlg.after')}><Pt value={after} step={6} onChange={setAfter} /></Field>
          <Field label={t('dlg.lineSpacing')}>
            <select value={rule} onChange={(ev) => { setRule(ev.target.value); if (ev.target.value === 'exact') setLhVal(14); if (ev.target.value === 'multiple') setLhVal(1.15) }}>
              <option value="single">{t('dlg.single')}</option><option value="onehalf">{t('dlg.onehalf')}</option><option value="double">{t('dlg.double')}</option>
              <option value="multiple">{t('dlg.multiple')}</option><option value="exact">{t('dlg.exactly')}</option>
            </select>
          </Field>
          <Field label={t('dlg.at')}>
            <span className="unit-input"><input type="number" step={rule === 'exact' ? 1 : 0.05} min={rule === 'exact' ? 1 : 0.5} value={lhVal}
              disabled={rule === 'single' || rule === 'onehalf' || rule === 'double'} onChange={(ev) => setLhVal(Number(ev.target.value))} /><i>{rule === 'exact' ? t('unit.pt') : '×'}</i></span>
          </Field>
        </div>
      </fieldset>
      <fieldset><legend>{t('dlg.breaks')}</legend>
        <label className="check"><input type="checkbox" checked={keepNext} onChange={(ev) => setKeepNext(ev.target.checked)} /> {t('dlg.keepNext')}</label>
        <label className="check"><input type="checkbox" checked={pbb} onChange={(ev) => setPbb(ev.target.checked)} /> {t('dlg.pageBreakBefore')}</label>
      </fieldset>
    </Modal>
  )
}

// ───────────── Font ─────────────
function FontDlg({ api, close }: { api: AppApi; close: () => void }) {
  const e = api.editor
  const [family, setFamily] = useState(currentFontFamily(e))
  const [size, setSize] = useState(currentFontSizePt(e))
  const [bold, setBold] = useState(e.isActive('bold'))
  const [italic, setItalic] = useState(e.isActive('italic'))
  const [underline, setUnderline] = useState(e.isActive('underline'))
  const [strike, setStrike] = useState(e.isActive('strike'))
  const [sup, setSup] = useState(e.isActive('superscript'))
  const [sub, setSub] = useState(e.isActive('subscript'))
  const [color, setColor] = useState<string | null>(e.getAttributes('textStyle').color || null)
  const apply = () => {
    let c = e.chain().focus().setFontFamily(fontStack(family)).setFontSize(`${size}pt`)
    c = color ? c.setColor(color) : c.unsetColor()
    c = bold ? c.setBold() : c.unsetBold()
    c = italic ? c.setItalic() : c.unsetItalic()
    c = underline ? c.setUnderline() : c.unsetUnderline()
    c = strike ? c.setStrike() : c.unsetStrike()
    c = sup ? c.setSuperscript() : c.unsetSuperscript()
    c = sub ? c.setSubscript() : c.unsetSubscript()
    c.run()
    close()
  }
  const fonts = FONT_CHOICES.includes(family) ? FONT_CHOICES : [family, ...FONT_CHOICES]
  return (
    <Modal title={t('dlg.font')} onClose={close} width={500} footer={<Footer onOk={apply} onCancel={close} />}>
      <div className="dlg-grid">
        <Field label={t('dlg.font')}>
          <select value={family} onChange={(ev) => setFamily(ev.target.value)}>
            {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{fontHint(f) ? `${fontLabel(f)} (${fontHint(f)})` : f}</option>)}
          </select>
        </Field>
        <Field label={t('dlg.size')}>
          <span className="unit-input"><input type="number" min={1} max={1638} step={0.5} value={size} list="font-sizes" onChange={(ev) => setSize(Number(ev.target.value))} /><i>{t('unit.pt')}</i></span>
          <datalist id="font-sizes">{FONT_SIZES.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <div className="field"><span>{t('dlg.fontColor')}</span><ColorWell label={t('dlg.fontColor')} value={color} linkTheme onChange={setColor} /></div>
      </div>
      <fieldset><legend>{t('dlg.effects')}</legend>
        <div className="checks">
          <label className="check"><input type="checkbox" checked={bold} onChange={(ev) => setBold(ev.target.checked)} /> {t('font.bold')}</label>
          <label className="check"><input type="checkbox" checked={italic} onChange={(ev) => setItalic(ev.target.checked)} /> {t('font.italic')}</label>
          <label className="check"><input type="checkbox" checked={underline} onChange={(ev) => setUnderline(ev.target.checked)} /> {t('font.underline')}</label>
          <label className="check"><input type="checkbox" checked={strike} onChange={(ev) => setStrike(ev.target.checked)} /> {t('font.strike')}</label>
          <label className="check"><input type="checkbox" checked={sup} onChange={(ev) => { setSup(ev.target.checked); if (ev.target.checked) setSub(false) }} /> {t('font.sup')}</label>
          <label className="check"><input type="checkbox" checked={sub} onChange={(ev) => { setSub(ev.target.checked); if (ev.target.checked) setSup(false) }} /> {t('font.sub')}</label>
        </div>
      </fieldset>
      <div className="font-preview" style={{
        fontFamily: fontStack(family), fontSize: `${Math.min(size, 36)}pt`, color: color ? resolveColor(color) : '#000', fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal',
        textDecoration: [underline && 'underline', strike && 'line-through'].filter(Boolean).join(' ') || 'none',
      }}>
        {sup ? <sup>Αα Ββ Γγ Abc</sup> : sub ? <sub>Αα Ββ Γγ Abc</sub> : 'Αα Ββ Γγ Abc 123'}
      </div>
    </Modal>
  )
}

// ───────────── Header & footer ─────────────
/** [label key, field text or a key whose translation is the field text] */
const HF_PRESETS: [Key, string][] = [
  ['hf.blank', ''], ['hf.pageNumber', '{page}'], ['hf.pageXofY', 'pn.xOfYField'], ['hf.dashes', '– {page} –'],
  ['hf.title', '{title}'], ['hf.date', '{date}'], ['hf.titlePage', 'hf.titlePageField'],
]
const hfPresetText = (v: string) => (/^[a-z]+\.[A-Za-z]+$/.test(v) ? t(v as Key) : v)

function HFEditor(p: { label: string; text: string; align: HFAlign; onText: (t: string) => void; onAlign: (a: HFAlign) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const insert = (tok: string) => {
    const el = ref.current
    if (!el) return p.onText(p.text + tok)
    const a = el.selectionStart ?? p.text.length
    const b = el.selectionEnd ?? p.text.length
    p.onText(p.text.slice(0, a) + tok + p.text.slice(b))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tok.length, a + tok.length) })
  }
  return (
    <fieldset><legend>{p.label}</legend>
      <div className="hf-line">
        <input ref={ref} value={p.text} onChange={(e) => p.onText(e.target.value)} placeholder={t('dlg.hfEmpty')} />
        <select value="" onChange={(e) => { if (e.target.value !== '') p.onText(hfPresetText(HF_PRESETS[Number(e.target.value)][1])) }}>
          <option value="">{t('dlg.hfPresets')}</option>
          {HF_PRESETS.map(([l], i) => <option key={l} value={i}>{t(l)}</option>)}
        </select>
      </div>
      <div className="hf-line">
        <div className="seg">
          {(['left', 'center', 'right'] as HFAlign[]).map((a) => (
            <button key={a} className={p.align === a ? 'on' : ''} onClick={() => p.onAlign(a)}>{a === 'left' ? t('common.left') : a === 'center' ? t('dlg.hfCenter') : t('common.right')}</button>
          ))}
        </div>
        <span className="grow" />
        <button className="chip" onClick={() => insert('{page}')}>{t('dlg.hfPageNo')}</button>
        <button className="chip" onClick={() => insert('{pages}')}>{t('dlg.hfPages')}</button>
        <button className="chip" onClick={() => insert('{date}')}>{t('dlg.hfDate')}</button>
      </div>
    </fieldset>
  )
}

function HeaderFooterDlg({ api, close }: { api: AppApi; close: () => void }) {
  const [hf, setHf] = useState(api.settings.hf)
  return (
    <Modal title={t('dlg.headerFooter')} onClose={close} width={600}
      footer={<Footer onCancel={close} onOk={() => { api.setSettings({ ...api.settings, hf }); close() }} />}>
      <HFEditor label={t('dlg.header')} text={hf.headerText} align={hf.headerAlign} onText={(t) => setHf({ ...hf, headerText: t })} onAlign={(a) => setHf({ ...hf, headerAlign: a })} />
      <HFEditor label={t('dlg.footer')} text={hf.footerText} align={hf.footerAlign} onText={(t) => setHf({ ...hf, footerText: t })} onAlign={(a) => setHf({ ...hf, footerAlign: a })} />
      <label className="check"><input type="checkbox" checked={hf.differentFirstPage} onChange={(e) => setHf({ ...hf, differentFirstPage: e.target.checked })} /> {t('dlg.hfDifferentFirst')}</label>
      <p className="muted small">{t('dlg.hfNote')}</p>
    </Modal>
  )
}

// ───────────── Table / link / image URL / list start / goto ─────────────
function TableDlg({ api, close }: { api: AppApi; close: () => void }) {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [header, setHeader] = useState(true)
  const ok = () => { api.editor.chain().focus().insertTable({ rows, cols, withHeaderRow: header }).run(); close() }
  return (
    <Modal title={t('dlg.insertTable')} onClose={close} width={360} footer={<Footer onOk={ok} onCancel={close} />}>
      <div className="dlg-grid">
        <Field label={t('dlg.columns')}><input type="number" min={1} max={63} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(63, Number(e.target.value))))} /></Field>
        <Field label={t('dlg.rows')}><input type="number" min={1} max={500} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(500, Number(e.target.value))))} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> {t('dlg.headerRow')}</label>
    </Modal>
  )
}

function LinkDlg({ api, close }: { api: AppApi; close: () => void }) {
  const e = api.editor
  const existing = e.getAttributes('link').href as string | undefined
  const { from, to, empty } = e.state.selection
  const [url, setUrl] = useState(existing || '')
  const [text, setText] = useState(empty ? '' : e.state.doc.textBetween(from, to))
  const ok = () => {
    let href = url.trim()
    if (!href) { e.chain().focus().extendMarkRange('link').unsetLink().run(); return close() }
    if (!/^(https?:|mailto:|tel:|#)/i.test(href)) href = href.includes('@') && !href.includes('/') ? `mailto:${href}` : `https://${href}`
    if (empty && !existing) {
      e.chain().focus().insertContent({ type: 'text', text: text || href, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else {
      e.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    close()
  }
  return (
    <Modal title={existing ? t('dlg.editLink') : t('dlg.insertLink')} onClose={close} width={460}
      footer={<Footer onOk={ok} onCancel={close} extra={existing && <button className="btn" onClick={() => { e.chain().focus().extendMarkRange('link').unsetLink().run(); close() }}>{t('dlg.removeLink')}</button>} />}>
      {empty && !existing && <Field label={t('dlg.textToDisplay')} wide><input value={text} onChange={(ev) => setText(ev.target.value)} /></Field>}
      <Field label={t('dlg.address')} wide><input value={url} placeholder="https://…" onChange={(ev) => setUrl(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') ok() }} /></Field>
    </Modal>
  )
}

function ImageUrlDlg({ api, close }: { api: AppApi; close: () => void }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const ok = async () => {
    try {
      const { data, type } = await platform.fetchImage(url.trim())
      if (!type.startsWith('image/')) throw new Error(t('dlg.notImage'))
      api.insertImageFiles([new File([data as BlobPart], url.split('/').pop() || 'image', { type })])
      close()
    } catch (e: any) {
      setErr(t('dlg.imageFetchFailed', { error: String(e?.message || e) }))
    }
  }
  return (
    <Modal title={t('dlg.imageUrl')} onClose={close} width={480} footer={<Footer onOk={ok} onCancel={close} okLabel={t('common.insert')} extra={err && <span className="err">{err}</span>} />}>
      <Field label={t('dlg.imageAddress')} wide><input value={url} placeholder={t('dlg.imageUrlPlaceholder')} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok() }} /></Field>
      <p className="muted small">{t('dlg.imageUrlNote')}</p>
    </Modal>
  )
}

function ListStartDlg({ api, close }: { api: AppApi; close: () => void }) {
  const [n, setN] = useState<number>(api.editor.getAttributes('orderedList').start || 1)
  const ok = () => {
    const c = api.editor.chain().focus()
    if (!api.editor.isActive('orderedList')) c.toggleOrderedList()
    c.updateAttributes('orderedList', { start: n }).run()
    close()
  }
  return (
    <Modal title={t('dlg.setNumbering')} onClose={close} width={320} footer={<Footer onOk={ok} onCancel={close} />}>
      <Field label={t('dlg.setValueTo')}><input type="number" min={0} value={n} onChange={(e) => setN(Number(e.target.value))} /></Field>
    </Modal>
  )
}

function GotoDlg({ api, close }: { api: AppApi; close: () => void }) {
  const [n, setN] = useState(1)
  const ok = () => {
    const el = document.querySelector('.canvas-scroll') as HTMLElement | null
    if (el) el.scrollTop = (n - 1) * (mmToPx(api.settings.height) + PAGE_GAP) * api.zoom
    // Put the caret at the first position on that page.
    requestAnimationFrame(() => {
      const pm = api.editor.view.dom.getBoundingClientRect()
      const sheet = document.querySelectorAll('.page-sheet')[n - 1]?.getBoundingClientRect()
      if (sheet) {
        const pos = api.editor.view.posAtCoords({ left: pm.left + 2, top: sheet.top + mmToPx(api.settings.margins.top) * api.zoom + 4 })
        if (pos) api.editor.chain().focus().setTextSelection(pos.pos).run()
      }
    })
    close()
  }
  return (
    <Modal title={t('dlg.goTo')} onClose={close} width={320} footer={<Footer onOk={ok} onCancel={close} okLabel={t('dlg.goTo')} />}>
      <Field label={t('dlg.goToPage', { n: layoutStore.pageCount })}><input type="number" min={1} max={layoutStore.pageCount} value={n} onChange={(e) => setN(Math.max(1, Math.min(layoutStore.pageCount, Number(e.target.value))))} onKeyDown={(e) => { if (e.key === 'Enter') ok() }} /></Field>
    </Modal>
  )
}

// ───────────── Symbols ─────────────
const SYMBOLS: [Key, string][] = [
  ['sym.common', '©®™§¶†‡•…–—‰€£¥¢°±×÷≈≠≤≥∞√∑∏∫∂µΩ'],
  ['sym.greek', 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρσςτυφχψωάέήίόύώϊϋΐΰ'],
  ['sym.quotes', '«»‹›“”‘’„‚'],
  ['sym.arrows', '←↑→↓↔↕⇐⇑⇒⇓⇔➢➔▶◀▲▼'],
  ['sym.math', '∀∃∅∈∉∩∪⊂⊃⊆⊇∧∨¬∴∵∠⊥∥≡∝½⅓¼¾²³¹'],
  ['sym.currency', '€$£¥₹₽₿¢₺₩'],
  ['sym.shapes', '■□▪▫●○◆◇★☆✓✔✗✘☐☑☒♠♣♥♦'],
]
function SymbolDlg({ api, close }: { api: AppApi; close: () => void }) {
  const [hover, setHover] = useState('')
  return (
    <Modal title={t('dlg.symbol')} onClose={close} width={560} footer={<><span className="muted small">{hover ? `U+${hover.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : t('dlg.clickToInsert')}</span><span className="grow" /><button className="btn" onClick={close}>{t('common.close')}</button></>}>
      {SYMBOLS.map(([title, chars]) => (
        <div key={title} className="sym-section">
          <div className="sym-title">{t(title)}</div>
          <div className="sym-grid">
            {[...chars].map((ch, i) => (
              <button key={title + i} className="sym" onMouseEnter={() => setHover(ch)} onClick={() => api.editor.chain().focus().insertContent(ch).run()}>{ch}</button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  )
}

// ───────────── Word count / shortcuts ─────────────
function WordCountDlg({ api, close }: { api: AppApi; close: () => void }) {
  const doc = api.editor.state.doc
  const { from, to, empty } = api.editor.state.selection
  const scope = empty ? doc.textBetween(0, doc.content.size, '\n', ' ') : doc.textBetween(from, to, '\n', ' ')
  let paragraphs = 0
  doc.nodesBetween(empty ? 0 : from, empty ? doc.content.size : to, (n) => { if (n.isTextblock && n.textContent.trim()) paragraphs++ })
  const rows: [Key, number][] = [
    ['wc.pages', layoutStore.pageCount],
    ['wc.words', countWords(scope)],
    ['wc.charsNoSpaces', scope.replace(/\s/g, '').length],
    ['wc.charsSpaces', scope.replace(/\n/g, '').length],
    ['wc.paragraphs', paragraphs],
  ]
  return (
    <Modal title={empty ? t('dlg.wordCount') : t('dlg.wordCountSel')} onClose={close} width={380} footer={<><span className="grow" /><button className="btn primary" onClick={close}>{t('common.close')}</button></>}>
      <table className="stats">
        <tbody>{rows.map(([k, v]) => <tr key={k}><td>{t(k)}</td><td>{fmtInt(v)}</td></tr>)}</tbody>
      </table>
    </Modal>
  )
}

function ShortcutsDlg({ close }: { close: () => void }) {
  const m = modKey
  const list: [string, Key][] = [
    [`${m}N`, 'sc.new'], [`${m}O`, 'sc.open'], [`${m}S`, 'sc.save'], [`${m}⇧S`, 'sc.saveAs'], [`${m}P`, 'sc.print'], [`${m}⇧E`, 'sc.exportPdf'],
    [`${m}Z / ${m}Y`, 'sc.undoRedo'], [`${m}F`, 'sc.find'], [`${m}H`, 'sc.replace'],
    [`${m}B / I / U`, 'sc.biu'], [`${m}= / ${m}⇧+`, 'sc.subSup'], [`${m}] / ${m}[`, 'sc.size1'], [`${m}⇧> / <`, 'sc.growShrink'],
    [`${m}L / E / R / J`, 'sc.align'], [`${m}1 / 2 / 5`, 'sc.lineSpacing'], [`${m}M / ${m}⇧M`, 'sc.indent'],
    [`${m}⌥1…6`, 'sc.headings'], [`${m}⇧N`, 'sc.normal'], [`${m}⇧L`, 'sc.bullets'], [`${m}↵`, 'sc.pageBreak'], ['⇧↵', 'sc.lineBreak'],
    [`${m}K`, 'sc.link'], [`${m}D`, 'sc.font'], ['⇧F3', 'sc.case'], [`${m}\\`, 'sc.clearChar'],
    ['Tab / ⇧Tab', 'sc.tab'], [`${m}⇧8`, 'sc.marks'], [t('sc.wheel', { mod: m.replace(/\+$/, '') }), 'sc.zoom'],
  ]
  return (
    <Modal title={t('dlg.shortcuts')} onClose={close} width={560} footer={<><span className="grow" /><button className="btn primary" onClick={close}>{t('common.close')}</button></>}>
      <table className="stats shortcuts"><tbody>{list.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{t(v)}</td></tr>)}</tbody></table>
    </Modal>
  )
}

