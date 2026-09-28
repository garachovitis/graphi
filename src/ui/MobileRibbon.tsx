// Phone toolbar: the essentials of every tab, all visible at once (no hidden scrolling).
// Cut / copy / paste are left to the OS long-press menu.
import { useRef, useState, type ReactNode } from 'react'
import { Undo2, Redo2, Save, Menu } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import type { AppApi } from './App'
import { Popover, ColorGrid, MenuItem, MenuSep, MenuTitle } from './controls'
import { PARA_STYLES, STYLE_SETS, applyStyleSet, currentStyleSet, styleName } from '../model/styles'
import { currentStyle, currentFontSizePt, growFont } from '../editor/format'
import { MARGIN_PRESETS, PAPER_SIZES, withOrientation, withPaper, mmToPx } from '../model/settings'
import { IMG_ASPECTS, IMG_SHADOWS, IMG_SHAPES, displaySize, type ImgAttrs } from '../editor/image'
import { insertCaption } from './Ribbon'
import { Ill } from './illustrations'
import { t, numText } from '../i18n'

type MTab = 'home' | 'insert' | 'layout' | 'refs' | 'view' | 'table' | 'picture'
const S = 26

function MBtn(p: { icon: ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`m-btn${p.active ? ' active' : ''}`} disabled={p.disabled} aria-label={p.label} aria-pressed={p.active}
      onMouseDown={(e) => e.preventDefault()} onClick={p.onClick}>
      {p.icon}
      <span>{p.label}</span>
    </button>
  )
}

/** Button that opens a sheet-like popover. */
function MDrop(p: { icon: ReactNode; label: string; active?: boolean; disabled?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className="m-drop">
      <MBtn icon={p.icon} label={p.label} active={p.active || open} disabled={p.disabled} onClick={() => setOpen((o) => !o)} />
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} className="m-pop">{p.children(() => setOpen(false))}</Popover>
    </div>
  )
}

export function MobileRibbon({ api }: { api: AppApi }) {
  const { editor: e } = api
  const [tab, setTab] = useState<MTab>('home')
  const inTable = e.isActive('table')
  const onImage = e.isActive('image')
  const shown: MTab = (tab === 'table' && !inTable) || (tab === 'picture' && !onImage) ? 'home' : tab
  const tabs: [MTab, string][] = [['home', t('tab.home')], ['insert', t('tab.insert')]]
  if (inTable) tabs.push(['table', t('tab.table')])
  if (onImage) tabs.push(['picture', t('m.picture')])
  tabs.push(['layout', t('tab.layout')], ['refs', t('tab.references')], ['view', t('tab.view')])

  return (
    <header className="app-chrome ribbon-wrap m-ribbon">
      <div className="qat">
        <button className="m-file" aria-label={t('qat.file')} onClick={() => api.openBackstage('home')}><Menu size={17} /> {t('qat.file')}</button>
        <button className="m-icon" aria-label={t('qat.save')} onClick={() => api.save()}><Save size={19} /></button>
        <div className="qat-title">{api.file.name}</div>
        <button className="m-icon" aria-label={t('qat.undo')} disabled={!e.can().undo()} onClick={() => e.chain().focus().undo().run()}><Undo2 size={19} /></button>
        <button className="m-icon" aria-label={t('qat.redo')} disabled={!e.can().redo()} onClick={() => e.chain().focus().redo().run()}><Redo2 size={19} /></button>
      </div>
      <nav className="m-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={shown === id} className={`m-tab${shown === id ? ' active' : ''}${id === 'table' || id === 'picture' ? ' ctx' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <div className="m-tools" role="toolbar">
        {shown === 'home' && <Home api={api} />}
        {shown === 'insert' && <Insert api={api} />}
        {shown === 'layout' && <Layout api={api} />}
        {shown === 'refs' && <Refs api={api} />}
        {shown === 'view' && <View api={api} />}
        {shown === 'table' && <TableTools e={e} />}
        {shown === 'picture' && <PictureTools api={api} />}
      </div>
    </header>
  )
}

function Home({ api }: { api: AppApi }) {
  const e = api.editor
  const c = () => e.chain().focus()
  const st = currentStyle(e)
  const align = ['left', 'center', 'right', 'justify'].find((a) => e.isActive({ textAlign: a })) || 'left'
  return (
    <>
      <MDrop icon={<Ill name="styles" size={S} />} label={styleName(st)}>
        {(close) => (
          <>
            <MenuTitle>{t('g.styles')}</MenuTitle>
            {PARA_STYLES.filter((s) => ['Normal', 'Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Quote', 'Caption'].includes(s.id)).map((s) => (
              <MenuItem key={s.id} active={st.id === s.id} label={<span style={{ color: s.color, fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? 'italic' : 'normal', fontSize: Math.min(20, Math.max(13, s.sizePt)) }}>{styleName(s)}</span>}
                onClick={() => { c().setParaStyle(s.id).run(); close() }} />
            ))}
          </>
        )}
      </MDrop>
      <MBtn icon={<Ill name="bold" size={S} />} label={t('m.bold')} active={e.isActive('bold')} onClick={() => c().toggleBold().run()} />
      <MBtn icon={<Ill name="italic" size={S} />} label={t('m.italic')} active={e.isActive('italic')} onClick={() => c().toggleItalic().run()} />
      <MBtn icon={<Ill name="underline" size={S} />} label={t('m.underline')} active={e.isActive('underline')} onClick={() => c().toggleUnderline().run()} />
      <MBtn icon={<Ill name="shrink" size={S} />} label={t('m.sizeDown', { size: numText(currentFontSizePt(e)) })} onClick={() => growFont(e, -1)} />
      <MBtn icon={<Ill name="grow" size={S} />} label={t('m.sizeUp')} onClick={() => growFont(e, 1)} />
      <MDrop icon={<Ill name="color" size={S} />} label={t('m.color')}>
        {(close) => <ColorGrid onPick={(col) => { if (col) c().setColor(col).run(); else c().unsetColor().run(); close() }} />}
      </MDrop>
      <MDrop icon={<Ill name="highlight" size={S} />} label={t('m.highlight')} active={e.isActive('highlight')}>
        {(close) => <ColorGrid highlight onPick={(col) => { if (col) c().setHighlight({ color: col }).run(); else c().unsetHighlight().run(); close() }} />}
      </MDrop>
      <MBtn icon={<Ill name="bullets" size={S} />} label={t('para.bullets')} active={e.isActive('bulletList')} onClick={() => c().toggleBulletList().run()} />
      <MBtn icon={<Ill name="numbering" size={S} />} label={t('para.numbering')} active={e.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()} />
      <MDrop icon={<Ill name="lineSpacing" size={S} />} label={t('dlg.lineSpacing')}>
        {(close) => <>{['1', '1.15', '1.5', '2'].map((v) => <MenuItem key={v} label={numText(Number(v))} onClick={() => { c().setParagraphAttrs({ lineHeight: v }).run(); close() }} />)}</>}
      </MDrop>
      <MBtn icon={<Ill name="indentLess" size={S} />} label={t('m.indentLess')} onClick={() => c().outdent().run()} />
      <MBtn icon={<Ill name="indentMore" size={S} />} label={t('m.indentMore')} onClick={() => c().indent().run()} />
      <MDrop icon={<Ill name={{ left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'justify' }[align]!} size={S} />} label={t('m.align')}>
        {(close) => (
          <>
            {([['left', 'common.left', 'alignLeft'], ['center', 'm.center', 'alignCenter'], ['right', 'common.right', 'alignRight'], ['justify', 'common.justify', 'justify']] as const).map(([a, l, ic]) => (
              <MenuItem key={a} icon={<Ill name={ic} size={18} />} label={t(l)} active={align === a} onClick={() => { c().setTextAlign(a).run(); close() }} />
            ))}
          </>
        )}
      </MDrop>
    </>
  )
}

function Insert({ api }: { api: AppApi }) {
  const e = api.editor
  const c = () => e.chain().focus()
  const setFooter = (text: string) => api.setSettings({ ...api.settings, hf: { ...api.settings.hf, footerText: text, footerAlign: 'center' } })
  return (
    <>
      <MBtn icon={<Ill name="image" size={S} />} label={t('m.picture')} onClick={api.pickImage} />
      <MBtn icon={<Ill name="signature" size={S} />} label={t('ins.signature')} onClick={() => api.openDialog({ type: 'signature' })} />
      <MDrop icon={<Ill name="table" size={S} />} label={t('ins.table')}>
        {(close) => (
          <>
            <MenuTitle>{t('ins.tableTitle')}</MenuTitle>
            {[[2, 2], [3, 2], [3, 3], [4, 3], [5, 4]].map(([r, col]) => (
              <MenuItem key={`${r}${col}`} label={t('m.tableSize', { cols: col, rows: r })} onClick={() => { c().insertTable({ rows: r, cols: col, withHeaderRow: true }).run(); close() }} />
            ))}
            <MenuSep />
            <MenuItem label={t('m.otherSize')} onClick={() => { close(); api.openDialog({ type: 'table' }) }} />
          </>
        )}
      </MDrop>
      <MBtn icon={<Ill name="link" size={S} />} label={t('m.link')} active={e.isActive('link')} onClick={() => api.openDialog({ type: 'link' })} />
      <MBtn icon={<Ill name="pageBreak" size={S} />} label={t('m.pageBreak')} onClick={() => c().setPageBreak().run()} />
      <MBtn icon={<Ill name="quote" size={S} />} label={t('ins.quote')} active={e.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()} />
      <MBtn icon={<Ill name="symbol" size={S} />} label={t('dlg.symbol')} onClick={() => api.openDialog({ type: 'symbol' })} />
      <MDrop icon={<Ill name="pageNumber" size={S} />} label={t('m.pageNumber')}>
        {(close) => (
          <>
            <MenuItem label={t('m.plainNumber')} onClick={() => { setFooter('{page}'); close() }} />
            <MenuItem label={t('pn.xOfY')} onClick={() => { setFooter(t('pn.xOfYField')); close() }} />
            <MenuItem label={t('m.removeNumbers')} onClick={() => { setFooter(''); close() }} />
            <MenuSep />
            <MenuItem label={t('m.headerFooter')} onClick={() => { close(); api.openDialog({ type: 'headerFooter' }) }} />
          </>
        )}
      </MDrop>
    </>
  )
}

function Layout({ api }: { api: AppApi }) {
  const s = api.settings
  return (
    <>
      <MDrop icon={<Ill name="margins" size={S} />} label={t('lay.margins')}>
        {(close) => (
          <>
            {MARGIN_PRESETS.map((m) => <MenuItem key={m.id} label={m.label} active={JSON.stringify(m.m) === JSON.stringify(s.margins)} onClick={() => { api.setSettings({ ...s, margins: { ...m.m } }); close() }} />)}
            <MenuSep />
            <MenuItem label={t('m.customMargins')} onClick={() => { close(); api.openDialog({ type: 'pageSetup' }) }} />
          </>
        )}
      </MDrop>
      <MBtn icon={<Ill name="orientation" size={S} />} label={s.orientation === 'portrait' ? t('m.portrait') : t('m.landscape')}
        onClick={() => api.setSettings(withOrientation(s, s.orientation === 'portrait' ? 'landscape' : 'portrait'))} />
      <MDrop icon={<Ill name="size" size={S} />} label={PAPER_SIZES.find((p) => p.id === s.paper)?.label || t('lay.size')}>
        {(close) => <>{PAPER_SIZES.map((p) => <MenuItem key={p.id} label={p.label} active={s.paper === p.id} onClick={() => { api.setSettings(withPaper(s, p.id)); close() }} />)}</>}
      </MDrop>
      <MDrop icon={<Ill name="styleSets" size={S} />} label={t('m.styleSets')}>
        {(close) => <>{STYLE_SETS.map((set) => <MenuItem key={set.id} label={set.name} active={currentStyleSet === set.id} onClick={() => { applyStyleSet(set.id); api.setSettings({ ...s, styleSet: set.id }); close() }} />)}</>}
      </MDrop>
    </>
  )
}

function Refs({ api }: { api: AppApi }) {
  const e = api.editor
  return (
    <>
      <MBtn icon={<Ill name="toc" size={S} />} label={t('m.toc')} onClick={() => e.chain().focus().insertTableOfContents().run()} />
      <MBtn icon={<Ill name="headingNumbers" size={S} />} label={t('m.headingNumbers')} active={api.settings.headingNumbers} onClick={() => api.setSettings({ ...api.settings, headingNumbers: !api.settings.headingNumbers })} />
      <MBtn icon={<Ill name="captionImage" size={S} />} label={t('m.capFig')} onClick={() => insertCaption(api, 'figure')} />
      <MBtn icon={<Ill name="captionTable" size={S} />} label={t('m.capTab')} onClick={() => insertCaption(api, 'table')} />
    </>
  )
}

function View({ api }: { api: AppApi }) {
  const fitWidth = () => {
    const el = document.querySelector('.canvas-scroll') as HTMLElement | null
    if (el) api.setZoom((el.clientWidth - 12) / mmToPx(api.settings.width))
  }
  return (
    <>
      <MBtn icon={<Ill name="find" size={S} />} label={t('edit.find')} onClick={() => api.openFind('find')} />
      <MBtn icon={<Ill name="replace" size={S} />} label={t('m.replace')} onClick={() => api.openFind('replace')} />
      <MBtn icon={<Ill name="fitWidth" size={S} />} label={t('m.fitWidth')} onClick={fitWidth} />
      <MBtn icon={<Ill name={api.view === 'print' ? 'webLayout' : 'printLayout'} size={S} />} label={api.view === 'print' ? t('m.web') : t('m.pages')} onClick={() => api.setView(api.view === 'print' ? 'web' : 'print')} />
      <MBtn icon={<Ill name="wordCount" size={S} />} label={t('m.words')} onClick={() => api.openDialog({ type: 'wordCount' })} />
      <MBtn icon={<Ill name="pdf" size={S} />} label="PDF" onClick={api.exportPdf} />
      <MBtn icon={<Ill name="print" size={S} />} label={t('m.print')} onClick={api.print} />
    </>
  )
}

function TableTools({ e }: { e: Editor }) {
  const c = () => e.chain().focus()
  return (
    <>
      <MBtn icon={<Ill name="rowBelow" size={S} />} label={t('m.addRow')} onClick={() => c().addRowAfter().run()} />
      <MBtn icon={<Ill name="colRight" size={S} />} label={t('m.addCol')} onClick={() => c().addColumnAfter().run()} />
      <MBtn icon={<Ill name="delRow" size={S} />} label={t('m.delRow')} onClick={() => c().deleteRow().run()} />
      <MBtn icon={<Ill name="delCol" size={S} />} label={t('m.delCol')} onClick={() => c().deleteColumn().run()} />
      <MBtn icon={<Ill name="merge" size={S} />} label={t('m.merge')} disabled={!e.can().mergeCells()} onClick={() => c().mergeCells().run()} />
      <MDrop icon={<Ill name="shading" size={S} />} label={t('tbl.shading')}>
        {(close) => <ColorGrid autoLabel={t('color.none')} onPick={(col) => { c().setCellAttribute('backgroundColor', col).run(); close() }} />}
      </MDrop>
      <MBtn icon={<Ill name="headerRow" size={S} />} label={t('m.headerRow')} onClick={() => c().toggleHeaderRow().run()} />
      <MBtn icon={<Ill name="delete" size={S} />} label={t('tbl.delTable')} onClick={() => c().deleteTable().run()} />
    </>
  )
}

function PictureTools({ api }: { api: AppApi }) {
  const e = api.editor
  const a = e.getAttributes('image') as ImgAttrs
  const set = (patch: Partial<ImgAttrs>) => e.chain().focus().updateAttributes('image', patch).run()
  const box = displaySize(a)
  const colW = mmToPx(api.settings.width - api.settings.margins.left - api.settings.margins.right)
  const resize = (k: number) => {
    const w = Math.max(24, Math.min(colW, Math.round(box.w * k)))
    set({ width: w, height: Math.round((w * box.h) / box.w) })
  }
  return (
    <>
      <MBtn icon={<Ill name="wrapTopBottom" size={S} />} label={t('m.topBottom')} active={a.wrap === 'topBottom'} onClick={() => set({ wrap: 'topBottom', align: a.align || 'center' })} />
      <MBtn icon={<Ill name="wrapSquare" size={S} />} label={t('wrap.square')} active={a.wrap === 'square'} onClick={() => set({ wrap: 'square', align: a.align === 'right' ? 'right' : 'left' })} />
      <MDrop icon={<Ill name={a.align === 'right' ? 'alignRight' : a.align === 'left' ? 'alignLeft' : 'alignCenter'} size={S} />} label={t('g.position')}>
        {(close) => (
          <>
            <MenuItem label={t('common.left')} active={a.x == null && a.align === 'left'} onClick={() => { set({ align: 'left', x: null }); close() }} />
            {a.wrap !== 'square' && <MenuItem label={t('m.center')} active={a.x == null && a.align === 'center'} onClick={() => { set({ align: 'center', x: null }); close() }} />}
            <MenuItem label={t('common.right')} active={a.x == null && a.align === 'right'} onClick={() => { set({ align: 'right', x: null }); close() }} />
          </>
        )}
      </MDrop>
      <MDrop icon={<Ill name="shape" size={S} />} label={t('m.shape')}>
        {(close) => (
          <>
            <MenuTitle>{t('g.cropShape')}</MenuTitle>
            {IMG_SHAPES.map((s) => <MenuItem key={s.id} label={s.label} active={a.shape === s.id} onClick={() => { set({ shape: s.id }); close() }} />)}
            <MenuSep />
            <MenuTitle>{t('m.aspect')}</MenuTitle>
            {IMG_ASPECTS.map((x) => <MenuItem key={x.label} label={x.label} active={(a.aspect || null) === x.id} onClick={() => { set({ aspect: x.id, focusX: 50, focusY: 50 }); close() }} />)}
          </>
        )}
      </MDrop>
      <MDrop icon={<Ill name="shadow" size={S} />} label={t('g.shadow')} active={!!a.shadow && a.shadow !== 'none'}>
        {(close) => <>{IMG_SHADOWS.map((s) => <MenuItem key={s.id} label={s.label} active={(a.shadow || 'none') === s.id} onClick={() => { set({ shadow: s.id }); close() }} />)}</>}
      </MDrop>
      <MBtn icon={<Ill name="smaller" size={S} />} label={t('m.smaller')} onClick={() => resize(0.9)} />
      <MBtn icon={<Ill name="bigger" size={S} />} label={t('m.bigger')} onClick={() => resize(1.1)} />
      <MBtn icon={<Ill name="delete" size={S} />} label={t('common.delete')} onClick={() => e.chain().focus().deleteSelection().run()} />
    </>
  )
}
