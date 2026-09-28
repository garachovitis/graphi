// The ribbon. Deliberately minimal: each tab shows the commands people use most in Word;
// everything else lives one click away in a "More" menu or a dialog.
// Contextual tabs (Table / Picture Format) appear right after Insert.
// Every label comes from src/i18n (Word's terminology in Greek and English).
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import {
  Undo2, Redo2, Save, Search, FileText,
} from 'lucide-react'
import { Btn, Group, Row, Col, Dropdown, MenuItem, MenuSep, MenuTitle, ColorGrid, Combo, NumField, Popover as PopoverList } from './controls'
import type { AppApi } from './App'
import { FONT_CHOICES, PARA_STYLES, STYLE_SETS, fontStack, applyStyleSet, currentStyleSet, styleName, type ParaStyle } from '../model/styles'
import { FONT_SIZES, currentFontFamily, currentFontSizePt, currentStyle, growFont, setFontSizePt, changeCase } from '../editor/format'
import { BULLET_FORMATS, NUMBER_FORMATS } from '../editor/lists'
import { MARGIN_PRESETS, PAPER_SIZES, withOrientation, withPaper, cmLabel, mmToPx } from '../model/settings'
import { modKey, isMac } from '../platform'
import { MobileRibbon } from './MobileRibbon'
import { IMG_ASPECTS, IMG_SHADOWS, IMG_SHAPES, SHADOW, DEFAULT_RADIUS, aspectValue, clampRadius, displaySize, formatRadius, radiusToSlider, sliderToRadius, shapeClipCss, type ImgAttrs } from '../editor/image'
import { Ill } from './illustrations'
import type { BreakKind } from '../editor/nodes'
import { insertTrainingImage } from './Training'
import { t, fmtNum, fmtDate, fmtLongDate, numText } from '../i18n'

type TabId = 'home' | 'insert' | 'design' | 'layout' | 'references' | 'review' | 'view' | 'table' | 'picture'

const I = 18 // small illustrated icon
const B = 30 // big illustrated icon
const ill = (n: string, s = I) => <Ill name={n} size={s} />
const BREAK_MENU: [BreakKind, string][] = [
  ['page', 'pageBreak'], ['column', 'brkColumn'],
  ['nextPage', 'brkNextPage'], ['continuous', 'brkContinuous'], ['evenPage', 'brkEvenPage'], ['oddPage', 'brkOddPage'],
]

const narrowQuery = '(max-width: 820px)'
function useNarrow() {
  const [n, setN] = useState(() => window.matchMedia(narrowQuery).matches)
  useEffect(() => {
    const m = window.matchMedia(narrowQuery)
    const h = () => setN(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  return n
}

export function Ribbon({ api }: { api: AppApi }) {
  // Phones get a purpose-built toolbar with every tab's essentials visible.
  return useNarrow() ? <MobileRibbon api={api} /> : <DesktopRibbon api={api} />
}

function DesktopRibbon({ api }: { api: AppApi }) {
  const { editor } = api
  const [tab, setTab] = useState<TabId>('home')
  const inTable = editor.isActive('table')
  const onImage = editor.isActive('image')

  useEffect(() => {
    if ((tab === 'table' && !inTable) || (tab === 'picture' && !onImage)) setTab('home')
  }, [inTable, onImage, tab])

  const tabs: [TabId, string, boolean?][] = [['home', t('tab.home')], ['insert', t('tab.insert')]]
  if (inTable) tabs.push(['table', t('tab.table'), true])
  if (onImage) tabs.push(['picture', t('tab.picture'), true])
  tabs.push(['design', t('tab.design')], ['layout', t('tab.layout')], ['references', t('tab.references')], ['review', t('tab.review')], ['view', t('tab.view')])

  return (
    <header className="app-chrome ribbon-wrap">
      <div className="qat">
        <div className="qat-left">
          <button className="qat-file" onClick={() => api.openBackstage('home')} title={t('qat.fileTitle')}>
            <FileText size={14} /> {t('qat.file')}
          </button>
          <Btn icon={<Save size={15} />} title={`${t('qat.save')} (${modKey}S)`} onClick={() => api.save()} className="qat-btn" />
          <Btn icon={<Undo2 size={15} />} title={`${t('qat.undo')} (${modKey}Z)`} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} className="qat-btn" />
          <Btn icon={<Redo2 size={15} />} title={`${t('qat.redo')} (${modKey}${isMac ? '⇧Z' : 'Y'})`} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} className="qat-btn" />
        </div>
        <div className="qat-title">
          {api.file.name}
          <span className="qat-state">{api.dirty ? ` • ${t('qat.unsaved')}` : api.file.path ? ` • ${t('qat.saved')}` : ''}</span>
        </div>
        <span className="app-mark" aria-hidden>G</span>
      </div>
      <nav className="tabs" role="tablist">
        {tabs.map(([id, label, ctx]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' active' : ''}${ctx ? ' contextual' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
        <button className="qat-search" onClick={() => api.openFind('find')} title={`${t('qat.search')} (${modKey}F)`}>
          <Search size={14} /> <span>{t('qat.search')}</span>
        </button>
      </nav>
      <div className="ribbon" role="toolbar" aria-label={t('ribbon.aria')}>
        {tab === 'home' && <HomeTab api={api} />}
        {tab === 'insert' && <InsertTab api={api} />}
        {tab === 'design' && <DesignTab api={api} />}
        {tab === 'layout' && <LayoutTab api={api} />}
        {tab === 'references' && <ReferencesTab api={api} />}
        {tab === 'review' && <ReviewTab api={api} />}
        {tab === 'view' && <ViewTab api={api} />}
        {tab === 'table' && inTable && <TableTab api={api} />}
        {tab === 'picture' && onImage && <PictureTab api={api} />}
      </div>
    </header>
  )
}

// ───────────────────────── Home ─────────────────────────
function HomeTab({ api }: { api: AppApi }) {
  const { editor: e } = api
  const [fontColor, setFontColor] = useState('#C00000')
  const [hlColor, setHlColor] = useState('#ffff00')
  const c = () => e.chain().focus()
  const size = currentFontSizePt(e)
  const family = currentFontFamily(e)
  const align = (a: string) => e.isActive({ textAlign: a })
  const lh = (e.state.selection.$from.parent.attrs.lineHeight as string | null) ?? String(currentStyle(e).lineHeight)

  return (
    <>
      <Group label={t('g.font')} onLauncher={() => api.openDialog({ type: 'font' })}>
        <Col>
          <Row>
            <Combo title={t('font.family')} width={118} value={family} options={FONT_CHOICES} editable={false}
              renderOption={(o) => <span style={{ fontFamily: fontStack(o) }}>{o}</span>}
              onCommit={(v) => c().setFontFamily(fontStack(v)).run()} />
            <Combo title={t('font.size')} width={54} value={numText(size)} options={FONT_SIZES.map((s) => numText(s))}
              onCommit={(v) => { const n = parseFloat(v.replace(',', '.')); if (n > 0) setFontSizePt(e, n) }} />
            <Btn icon={ill('grow')} title={`${t('font.grow')} (${modKey}⇧>)`} onClick={() => growFont(e, 1)} />
            <Btn icon={ill('shrink')} title={`${t('font.shrink')} (${modKey}⇧<)`} onClick={() => growFont(e, -1)} />
          </Row>
          <Row>
            <Btn icon={ill('bold')} title={`${t('font.bold')} (${modKey}B)`} active={e.isActive('bold')} onClick={() => c().toggleBold().run()} />
            <Btn icon={ill('italic')} title={`${t('font.italic')} (${modKey}I)`} active={e.isActive('italic')} onClick={() => c().toggleItalic().run()} />
            <Btn icon={ill('underline')} title={`${t('font.underline')} (${modKey}U)`} active={e.isActive('underline')} onClick={() => c().toggleUnderline().run()} />
            <Dropdown icon={<span className="color-ill">{ill('color')}<i style={{ background: fontColor }} /></span>} title={t('font.color')} onClick={() => c().setColor(fontColor).run()}>
              {(close) => <ColorGrid onPick={(col) => { if (col) { setFontColor(col); c().setColor(col).run() } else c().unsetColor().run(); close() }} />}
            </Dropdown>
            <Dropdown icon={ill('highlight')} title={t('font.highlight')} onClick={() => c().toggleHighlight({ color: hlColor }).run()}>
              {(close) => <ColorGrid highlight onPick={(col) => { if (col) { setHlColor(col); c().setHighlight({ color: col }).run() } else c().unsetHighlight().run(); close() }} />}
            </Dropdown>
            <Dropdown icon={ill('more')} title={t('font.more')}>
              {(close) => (
                <>
                  <MenuItem label={t('font.strike')} active={e.isActive('strike')} onClick={() => { c().toggleStrike().run(); close() }} />
                  <MenuItem label={`${t('font.sub')}  x₂`} hint={`${modKey}=`} active={e.isActive('subscript')} onClick={() => { c().unsetSuperscript().toggleSubscript().run(); close() }} />
                  <MenuItem label={`${t('font.sup')}  x²`} hint={`${modKey}⇧+`} active={e.isActive('superscript')} onClick={() => { c().unsetSubscript().toggleSuperscript().run(); close() }} />
                  <MenuSep />
                  <MenuTitle>{t('case.menu')}</MenuTitle>
                  <MenuItem label={t('case.sentence')} onClick={() => { changeCase(e, 'sentence'); close() }} />
                  <MenuItem label={t('case.lower')} onClick={() => { changeCase(e, 'lower'); close() }} />
                  <MenuItem label={t('case.upper')} onClick={() => { changeCase(e, 'upper'); close() }} />
                  <MenuItem label={t('case.title')} onClick={() => { changeCase(e, 'title'); close() }} />
                  <MenuSep />
                  <MenuItem icon={ill('painter', 16)} label={t('font.painter')} onClick={() => { api.startPainter(); close() }} />
                  <MenuItem icon={ill('clear', 16)} label={t('font.clear')} onClick={() => { c().unsetAllMarks().clearParagraphFormat().setParaStyle('Normal').run(); close() }} />
                  <MenuItem label={t('font.dialog')} hint={`${modKey}D`} onClick={() => { close(); api.openDialog({ type: 'font' }) }} />
                </>
              )}
            </Dropdown>
          </Row>
        </Col>
      </Group>

      <Group label={t('g.paragraph')} onLauncher={() => api.openDialog({ type: 'paragraph' })}>
        <Col>
          <Row>
            <Dropdown icon={ill('bullets')} title={t('para.bullets')} active={e.isActive('bulletList')} onClick={() => c().toggleBulletList().run()} popClass="lib-pop">
              {(close) => (
                <>
                  <MenuTitle>{t('para.bulletLib')}</MenuTitle>
                  <div className="lib-grid">
                    {BULLET_FORMATS.map((b) => (
                      <button key={b.id} className="lib-cell" title={b.id} onClick={() => { e.commands.setListStyle(b.id); close() }}>
                        <span className="lib-bullet">{b.label}</span><span className="lib-lines" />
                      </button>
                    ))}
                  </div>
                  <MenuSep />
                  <MenuItem icon={ill('checklist', 16)} label={t('para.checklist')} onClick={() => { c().toggleTaskList().run(); close() }} />
                </>
              )}
            </Dropdown>
            <Dropdown icon={ill('numbering')} title={t('para.numbering')} active={e.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()} popClass="lib-pop">
              {(close) => (
                <>
                  <MenuTitle>{t('para.numberLib')}</MenuTitle>
                  <div className="lib-grid">
                    {NUMBER_FORMATS.map((n) => (
                      <button key={n.id} className="lib-cell num" title={n.id} onClick={() => { e.commands.setListStyle(n.id); close() }}>
                        {n.label.split(' ').map((x) => <span key={x} className="lib-numline">{x}<i /></span>)}
                      </button>
                    ))}
                  </div>
                  <MenuSep />
                  <MenuItem label={t('para.setValue')} onClick={() => { close(); api.openDialog({ type: 'listStart' }) }} />
                  <MenuItem icon={ill('headingNumbers', 16)} label={t('para.headingNumbers')} active={api.settings.headingNumbers}
                    onClick={() => { api.setSettings({ ...api.settings, headingNumbers: !api.settings.headingNumbers }); close() }} />
                </>
              )}
            </Dropdown>
            <Btn icon={ill('indentLess')} title={`${t('para.outdent')} (${modKey}⇧M)`} onClick={() => c().outdent().run()} />
            <Btn icon={ill('indentMore')} title={`${t('para.indent')} (${modKey}M)`} onClick={() => c().indent().run()} />
          </Row>
          <Row>
            <Btn icon={ill('alignLeft')} title={`${t('para.alignLeft')} (${modKey}L)`} active={align('left') || (!align('center') && !align('right') && !align('justify'))} onClick={() => c().setTextAlign('left').run()} />
            <Btn icon={ill('alignCenter')} title={`${t('para.center')} (${modKey}E)`} active={align('center')} onClick={() => c().setTextAlign('center').run()} />
            <Btn icon={ill('alignRight')} title={`${t('para.alignRight')} (${modKey}R)`} active={align('right')} onClick={() => c().setTextAlign('right').run()} />
            <Btn icon={ill('justify')} title={`${t('para.justify')} (${modKey}J)`} active={align('justify')} onClick={() => c().setTextAlign('justify').run()} />
            <Dropdown icon={ill('lineSpacing')} title={t('para.spacing')}>
              {(close) => (
                <>
                  {['1', '1.15', '1.5', '2'].map((v) => (
                    <MenuItem key={v} label={numText(Number(v))} active={String(lh) === v} onClick={() => { c().setParagraphAttrs({ lineHeight: v }).run(); close() }} />
                  ))}
                  <MenuSep />
                  <MenuItem label={t('para.spacingOptions')} onClick={() => { close(); api.openDialog({ type: 'paragraph' }) }} />
                </>
              )}
            </Dropdown>
          </Row>
        </Col>
      </Group>

      <Group label={t('g.styles')} className="styles-group">
        <StyleGallery editor={e} />
      </Group>

      <Group label={t('g.editing')}>
        <Btn big icon={ill('find', B)} label={t('edit.find')} title={`${t('edit.find')} (${modKey}F)`} onClick={() => api.openFind('find')} />
        <Btn big icon={ill('replace', B)} label={t('edit.replace')} title={`${t('edit.replace')} (${modKey}H)`} onClick={() => api.openFind('replace')} />
      </Group>
    </>
  )
}

function stylePreview(s: ParaStyle): React.CSSProperties {
  return {
    fontFamily: fontStack(s.font || PARA_STYLES[0].font || 'Calibri'),
    fontSize: Math.min(19, Math.max(11, s.sizePt * 0.95)),
    color: s.color || '#000',
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    letterSpacing: s.letterSpacingPt ? `${s.letterSpacingPt}pt` : undefined,
  }
}

/** The three styles people use most, visible; every other style in the dropdown. */
function StyleGallery({ editor }: { editor: Editor }) {
  const cur = currentStyle(editor)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const main = ['Normal', 'Heading1', 'Heading2'].map((id) => PARA_STYLES.find((s) => s.id === id)!)
  const apply = (id: string) => editor.chain().focus().setParaStyle(id).run()
  return (
    <div className="style-gallery" ref={ref}>
      <div className="style-cards">
        {main.map((s) => (
          <button key={s.id} className={`style-card${cur.id === s.id ? ' active' : ''}`} title={styleName(s)}
            onMouseDown={(ev) => ev.preventDefault()} onClick={() => apply(s.id)}>
            <span className="style-sample" style={stylePreview(s)}>{t('styles.sample')}</span>
            <span className="style-name">{styleName(s)}</span>
          </button>
        ))}
      </div>
      <button className="style-more" title={t('styles.all')} aria-haspopup="menu" aria-expanded={open} onMouseDown={(ev) => ev.preventDefault()} onClick={() => setOpen((x) => !x)}>▾</button>
      <PopoverList anchor={ref.current} open={open} onClose={() => setOpen(false)}>
        {PARA_STYLES.map((s) => (
          <MenuItem key={s.id} active={cur.id === s.id} label={<span style={{ ...stylePreview(s), fontSize: Math.min(18, Math.max(12, s.sizePt * 0.9)) }}>{styleName(s)}</span>}
            onClick={() => { apply(s.id); setOpen(false) }} />
        ))}
      </PopoverList>
    </div>
  )
}


// ───────────────────────── Insert ─────────────────────────
function TableGrid({ onPick }: { onPick: (r: number, c: number) => void }) {
  const [h, setH] = useState<[number, number]>([0, 0])
  return (
    <div className="tgrid-wrap">
      <div className="menu-title">{h[0] ? t('ins.tableSize', { cols: h[1], rows: h[0] }) : t('ins.tableTitle')}</div>
      <div className="tgrid" onMouseLeave={() => setH([0, 0])}>
        {Array.from({ length: 8 }, (_, r) => (
          <div key={r} className="tgrid-row">
            {Array.from({ length: 10 }, (_, c) => (
              <span key={c} className={`tgrid-cell${r < h[0] && c < h[1] ? ' on' : ''}`} onMouseEnter={() => setH([r + 1, c + 1])} onClick={() => onPick(r + 1, c + 1)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function InsertTab({ api }: { api: AppApi }) {
  const { editor: e } = api
  const c = () => e.chain().focus()
  const setFooter = (text: string, align: 'left' | 'center' | 'right' = 'center') =>
    api.setSettings({ ...api.settings, hf: { ...api.settings.hf, footerText: text, footerAlign: align } })
  return (
    <>
      <Group label={t('g.content')}>
        <Dropdown big icon={ill('table', B)} label={t('ins.table')} title={t('ins.tableTitle')}>
          {(close) => (
            <>
              <TableGrid onPick={(r, col) => { c().insertTable({ rows: r, cols: col, withHeaderRow: false }).run(); close() }} />
              <MenuSep />
              <MenuItem label={t('ins.tableDialog')} onClick={() => { close(); api.openDialog({ type: 'table' }) }} />
            </>
          )}
        </Dropdown>
        <Dropdown big icon={ill('image', B)} label={t('ins.pictures')} title={t('ins.picturesTitle')}>
          {(close) => (
            <>
              {api.training && <MenuItem icon={ill('image', 16)} label={t('ins.trainingPicture')} onClick={() => { close(); insertTrainingImage(e) }} />}
              <MenuItem icon={ill('image', 16)} label={t('ins.thisDevice')} onClick={() => { close(); api.pickImage() }} />
              <MenuItem icon={ill('link', 16)} label={t('ins.fromUrl')} onClick={() => { close(); api.openDialog({ type: 'imageUrl' }) }} />
            </>
          )}
        </Dropdown>
        <Btn big icon={ill('signature', B)} label={t('ins.signature')} title={t('ins.signatureTitle')} onClick={() => api.openDialog({ type: 'signature' })} />
        <Btn big icon={ill('link', B)} label={t('ins.link')} title={`${t('ins.link')} (${modKey}K)`} active={e.isActive('link')} onClick={() => api.openDialog({ type: 'link' })} />
      </Group>
      <Group label={t('g.pages')}>
        <Btn big icon={ill('pageBreak', B)} label={t('ins.pageBreak')} title={`${t('ins.pageBreak')} (${modKey}↵)`} onClick={() => c().setPageBreak().run()} />
        <Btn big icon={ill('header', B)} label={t('ins.header')} title={t('ins.headerFooter')} onClick={() => api.openDialog({ type: 'headerFooter' })} />
        <Dropdown big icon={ill('pageNumber', B)} label={t('ins.pageNumber')} title={t('ins.pageNumber')}>
          {(close) => (
            <>
              <MenuItem label={t('pn.plainCenter')} onClick={() => { setFooter('{page}'); close() }} />
              <MenuItem label={t('pn.plainRight')} onClick={() => { setFooter('{page}', 'right'); close() }} />
              <MenuItem label={t('pn.xOfY')} onClick={() => { setFooter(t('pn.xOfYField')); close() }} />
              <MenuSep />
              <MenuItem label={t('pn.remove')} onClick={() => { setFooter(''); close() }} />
            </>
          )}
        </Dropdown>
      </Group>
      <Group label={t('g.other')}>
        <Dropdown big icon={ill('more', B)} label={t('ins.more')} title={t('ins.moreTitle')}>
          {(close) => {
            const d = new Date()
            return (
              <>
                <MenuItem icon={ill('symbol', 16)} label={t('ins.symbol')} onClick={() => { close(); api.openDialog({ type: 'symbol' }) }} />
                <MenuItem icon={ill('date', 16)} label={t('ins.today', { date: fmtDate(d) })} onClick={() => { c().insertContent(fmtLongDate(d)).run(); close() }} />
                <MenuItem icon={ill('line', 16)} label={t('ins.hr')} onClick={() => { c().setHorizontalRule().run(); close() }} />
                <MenuItem icon={ill('quote', 16)} label={t('ins.quote')} onClick={() => { c().toggleBlockquote().run(); close() }} />
                <MenuItem icon={ill('code', 16)} label={t('ins.code')} onClick={() => { c().toggleCodeBlock().run(); close() }} />
                <MenuItem icon={ill('blankPage', 16)} label={t('ins.blankPage')} onClick={() => { c().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }, { type: 'pageBreak' }, { type: 'paragraph' }]).run(); close() }} />
              </>
            )
          }}
        </Dropdown>
      </Group>
    </>
  )
}

// ───────────────────────── Design (style sets) ─────────────────────────
function DesignTab({ api }: { api: AppApi }) {
  return (
    <Group label={t('g.docFormatting')} className="sets-group">
      <div className="style-sets">
        {STYLE_SETS.map((set) => {
          const pick = () => { applyStyleSet(set.id); api.setSettings({ ...api.settings, styleSet: set.id }) }
          return (
            <button key={set.id} className={`set-card${currentStyleSet === set.id ? ' active' : ''}`} title={set.name} onMouseDown={(ev) => ev.preventDefault()} onClick={pick}>
              <span className="set-title" style={{ fontFamily: fontStack(set.headingFont), color: set.titleColor, fontWeight: set.headingBold ? 700 : 400, textAlign: set.titleAlign || 'left' }}>{styleName('Title')}</span>
              <span className="set-h1" style={{ fontFamily: fontStack(set.headingFont), color: set.h1, fontWeight: set.headingBold ? 700 : 400 }}>{styleName('Heading1')}</span>
              <span className="set-body" style={{ fontFamily: fontStack(set.bodyFont) }}>{t('design.body')}</span>
              <span className="set-name">{set.name}</span>
            </button>
          )
        })}
      </div>
    </Group>
  )
}

// ───────────────────────── Layout ─────────────────────────
function LayoutTab({ api }: { api: AppApi }) {
  const { settings: s, editor: e } = api
  const para = e.state.selection.$from.parent
  const breakItem = (kind: BreakKind, icon: string, close: () => void) => (
    <MenuItem key={kind} icon={ill(icon, 28)}
      label={<span className="menu-desc"><b>{t(`brk.${kind}`)}</b><small>{t(`brk.${kind}.desc`)}</small></span>}
      hint={kind === 'page' ? `${modKey}↵` : undefined}
      onClick={() => { e.chain().focus().setBreak(kind).run(); close() }} />
  )
  return (
    <Group label={t('g.pageSetup')} onLauncher={() => api.openDialog({ type: 'pageSetup' })}>
      <Dropdown big icon={ill('margins', B)} label={t('lay.margins')} title={t('lay.margins')}>
        {(close) => (
          <>
            {MARGIN_PRESETS.map((m) => (
              <MenuItem key={m.id} label={<span><b>{m.label}</b><br /><small>{t('lay.marginsDetail', { top: cmLabel(m.m.top), bottom: cmLabel(m.m.bottom), left: cmLabel(m.m.left), right: cmLabel(m.m.right) })}</small></span>}
                active={JSON.stringify(m.m) === JSON.stringify(s.margins)} onClick={() => { api.setSettings({ ...s, margins: { ...m.m } }); close() }} />
            ))}
            <MenuSep />
            <MenuItem label={t('lay.customMargins')} onClick={() => { close(); api.openDialog({ type: 'pageSetup' }) }} />
          </>
        )}
      </Dropdown>
      <Dropdown big icon={ill('orientation', B)} label={t('lay.orientation')} title={t('lay.orientation')}>
        {(close) => (
          <>
            <MenuItem icon={ill('printLayout', 16)} label={t('lay.portrait')} active={s.orientation === 'portrait'} onClick={() => { api.setSettings(withOrientation(s, 'portrait')); close() }} />
            <MenuItem icon={ill('webLayout', 16)} label={t('lay.landscape')} active={s.orientation === 'landscape'} onClick={() => { api.setSettings(withOrientation(s, 'landscape')); close() }} />
          </>
        )}
      </Dropdown>
      <Dropdown big icon={ill('size', B)} label={t('lay.size')} title={t('lay.paperSize')}>
        {(close) => (
          <>
            {PAPER_SIZES.map((p) => (
              <MenuItem key={p.id} label={<span><b>{p.label}</b> <small>{fmtNum(p.w / 10)} × {fmtNum(p.h / 10)} {t('unit.cm')}</small></span>}
                active={s.paper === p.id} onClick={() => { api.setSettings(withPaper(s, p.id)); close() }} />
            ))}
          </>
        )}
      </Dropdown>
      <Dropdown big icon={ill('breaks', B)} label={t('lay.breaks')} title={t('lay.breaksTitle')}>
        {(close) => (
          <>
            <MenuTitle>{t('brk.pageBreaks')}</MenuTitle>
            {BREAK_MENU.slice(0, 2).map(([kind, icon]) => breakItem(kind, icon, close))}
            <MenuSep />
            <MenuTitle>{t('brk.sectionBreaks')}</MenuTitle>
            {BREAK_MENU.slice(2).map(([kind, icon]) => breakItem(kind, icon, close))}
            <MenuSep />
            <MenuItem label={t('lay.breakBefore')} active={!!para.attrs.pageBreakBefore}
              onClick={() => { e.chain().focus().setParagraphAttrs({ pageBreakBefore: !para.attrs.pageBreakBefore }).run(); close() }} />
          </>
        )}
      </Dropdown>
    </Group>
  )
}

// ───────────────────────── References / Review / View ─────────────────────────
export function insertCaption(api: AppApi, kind: 'figure' | 'table') {
  const e = api.editor
  const { $from } = e.state.selection
  let tableDepth = -1
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') { tableDepth = d; break }
  if (kind === 'table' && tableDepth > 0) {
    const pos = $from.before(tableDepth)
    e.chain().focus().insertContentAt(pos, { type: 'paragraph', attrs: { styleId: 'Caption', captionKind: 'table', keepNext: true } })
      .setTextSelection(pos + 1).run()
    return
  }
  let d = $from.depth
  while (d > 0 && !$from.node(d).isTextblock) d--
  const paraPos = d > 0 ? $from.before(d) : null
  const after = d > 0 ? $from.after(d) : e.state.selection.to
  let chain = e.chain().focus()
  if (paraPos != null) chain = chain.command(({ tr }) => {
    const n = tr.doc.nodeAt(paraPos)
    if (n && (n.type.name === 'paragraph' || n.type.name === 'heading')) tr.setNodeMarkup(paraPos, undefined, { ...n.attrs, keepNext: true })
    return true
  })
  chain.insertContentAt(after, { type: 'paragraph', attrs: { styleId: 'Caption', captionKind: kind } }).setTextSelection(after + 1).run()
}

function ReferencesTab({ api }: { api: AppApi }) {
  const { editor: e, settings: s } = api
  return (
    <>
      <Group label={t('g.toc')}>
        <Dropdown big icon={ill('toc', B)} label={t('refs.toc')} title={t('refs.tocTitle')}>
          {(close) => (
            <>
              {[2, 3, 4].map((l) => (
                <MenuItem key={l} label={t('refs.tocAuto', { n: l })} onClick={() => { e.chain().focus().insertContent([{ type: 'tableOfContents', attrs: { maxLevel: l } }, { type: 'paragraph' }]).run(); close() }} />
              ))}
            </>
          )}
        </Dropdown>
        <Btn big icon={ill('headingNumbers', B)} label={t('refs.headingNumbers')} title={t('refs.headingNumbersTitle')} active={s.headingNumbers}
          onClick={() => api.setSettings({ ...s, headingNumbers: !s.headingNumbers })} />
      </Group>
      <Group label={t('g.captions')}>
        <Btn big icon={ill('captionImage', B)} label={t('refs.capFig')} title={t('refs.capFigTitle')} onClick={() => insertCaption(api, 'figure')} />
        <Btn big icon={ill('captionTable', B)} label={t('refs.capTab')} title={t('refs.capTabTitle')} onClick={() => insertCaption(api, 'table')} />
      </Group>
    </>
  )
}

function ReviewTab({ api }: { api: AppApi }) {
  return (
    <Group label={t('g.proofing')}>
      <Btn big icon={ill('spelling', B)} label={t('rev.spelling')} title={t('rev.spellingTitle')} active={api.spellcheck} onClick={() => api.setSpellcheck(!api.spellcheck)} />
      <Btn big icon={ill('wordCount', B)} label={t('rev.wordCount')} title={t('rev.wordCount')} onClick={() => api.openDialog({ type: 'wordCount' })} />
    </Group>
  )
}

function ViewTab({ api }: { api: AppApi }) {
  const fit = (mode: 'width' | 'page') => {
    const el = document.querySelector('.canvas-scroll') as HTMLElement | null
    if (!el) return
    const pw = mmToPx(api.settings.width)
    const ph = mmToPx(api.settings.height)
    api.setZoom(mode === 'width' ? (el.clientWidth - 48) / pw : Math.min((el.clientHeight - 48) / ph, (el.clientWidth - 48) / pw))
  }
  return (
    <>
      <Group label={t('g.views')}>
        <Btn big icon={ill('printLayout', B)} label={t('view.print')} title={t('view.print')} active={api.view === 'print'} onClick={() => api.setView('print')} />
        <Btn big icon={ill('webLayout', B)} label={t('view.web')} title={t('view.webTitle')} active={api.view === 'web'} onClick={() => api.setView('web')} />
      </Group>
      <Group label={t('g.zoom')}>
        <Btn big icon={ill('zoom100', B)} label="100%" title={t('view.zoom100')} onClick={() => api.setZoom(1)} />
        <Btn big icon={ill('onePage', B)} label={t('view.onePage')} title={t('view.onePage')} onClick={() => fit('page')} />
        <Btn big icon={ill('fitWidth', B)} label={t('view.pageWidth')} title={t('view.pageWidth')} onClick={() => fit('width')} />
      </Group>
      <Group label={t('g.show')}>
        <Btn big icon={ill('ruler', B)} label={t('view.ruler')} title={t('view.ruler')} active={api.showRuler} onClick={() => api.setShowRuler(!api.showRuler)} />
        <Btn big icon={ill('marks', B)} label={t('view.marks')} title={`${t('view.marksTitle')} (${modKey}⇧8)`} active={api.showMarks} onClick={() => api.setShowMarks(!api.showMarks)} />
      </Group>
    </>
  )
}

// ───────────────────────── Contextual: Table ─────────────────────────
function TableTab({ api }: { api: AppApi }) {
  const { editor: e } = api
  const c = () => e.chain().focus()
  const cell = e.getAttributes('tableCell').backgroundColor !== undefined ? e.getAttributes('tableCell') : e.getAttributes('tableHeader')
  const setCell = (attrs: Record<string, unknown>) => c().setCellAttribute(Object.keys(attrs)[0], Object.values(attrs)[0]).run()
  return (
    <>
      <Group label={t('g.rowsCols')}>
        <Btn big icon={ill('rowAbove', B)} label={t('tbl.above')} title={t('tbl.aboveTitle')} onClick={() => c().addRowBefore().run()} />
        <Btn big icon={ill('rowBelow', B)} label={t('tbl.below')} title={t('tbl.belowTitle')} onClick={() => c().addRowAfter().run()} />
        <Btn big icon={ill('colLeft', B)} label={t('tbl.left')} title={t('tbl.leftTitle')} onClick={() => c().addColumnBefore().run()} />
        <Btn big icon={ill('colRight', B)} label={t('tbl.right')} title={t('tbl.rightTitle')} onClick={() => c().addColumnAfter().run()} />
        <Dropdown big icon={ill('delete', B)} label={t('common.delete')} title={t('common.delete')}>
          {(close) => (
            <>
              <MenuItem icon={ill('delRow', 16)} label={t('tbl.delRows')} onClick={() => { c().deleteRow().run(); close() }} />
              <MenuItem icon={ill('delCol', 16)} label={t('tbl.delCols')} onClick={() => { c().deleteColumn().run(); close() }} />
              <MenuItem icon={ill('deleteTable', 16)} label={t('tbl.delTable')} onClick={() => { c().deleteTable().run(); close() }} />
            </>
          )}
        </Dropdown>
      </Group>
      <Group label={t('g.cells')}>
        <Btn big icon={ill('merge', B)} label={t('tbl.merge')} title={t('tbl.merge')} disabled={!e.can().mergeCells()} onClick={() => c().mergeCells().run()} />
        <Btn big icon={ill('split', B)} label={t('tbl.split')} title={t('tbl.split')} disabled={!e.can().splitCell()} onClick={() => c().splitCell().run()} />
        <Btn big icon={ill('headerRow', B)} label={t('tbl.headerRow')} title={t('tbl.headerRow')} onClick={() => c().toggleHeaderRow().run()} />
        <Dropdown big icon={ill('shading', B)} label={t('tbl.shading')} title={t('tbl.shadingTitle')}>
          {(close) => <ColorGrid autoLabel={t('color.none')} onPick={(col) => { setCell({ backgroundColor: col }); close() }} />}
        </Dropdown>
        <Dropdown big icon={ill('valign', B)} label={t('tbl.valign')} title={t('tbl.valignTitle')}>
          {(close) => (
            <>
              <MenuItem label={t('common.top')} active={!cell.verticalAlign || cell.verticalAlign === 'top'} onClick={() => { setCell({ verticalAlign: null }); close() }} />
              <MenuItem label={t('tbl.vMiddle')} active={cell.verticalAlign === 'middle'} onClick={() => { setCell({ verticalAlign: 'middle' }); close() }} />
              <MenuItem label={t('common.bottom')} active={cell.verticalAlign === 'bottom'} onClick={() => { setCell({ verticalAlign: 'bottom' }); close() }} />
            </>
          )}
        </Dropdown>
      </Group>
    </>
  )
}

// ───────────────────────── Contextual: Picture ─────────────────────────
function WrapArt({ kind, align }: { kind: 'topBottom' | 'square'; align: string }) {
  const lines = [4, 12, 20, 28, 36]
  if (kind === 'topBottom') {
    return (
      <span className="wc-art">
        <i style={{ top: 2 }} /><i style={{ top: 36 }} />
        <b style={{ top: 9, height: 22, width: 34, left: align === 'left' ? 0 : align === 'right' ? 'auto' : 'calc(50% - 17px)', right: align === 'right' ? 0 : 'auto' }} />
      </span>
    )
  }
  return (
    <span className="wc-art">
      {lines.map((t) => <i key={t} style={{ top: t, left: t > 2 && t < 30 && align !== 'right' ? 34 : 0, right: t > 2 && t < 30 && align === 'right' ? 34 : 0 }} />)}
      <b style={{ top: 6, height: 22, width: 30, left: align === 'right' ? 'auto' : 0, right: align === 'right' ? 0 : 'auto' }} />
    </span>
  )
}

function PictureTab({ api }: { api: AppApi }) {
  const { editor: e } = api
  const a = e.getAttributes('image') as ImgAttrs
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!a.src) return
    const img = new window.Image()
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = a.src
  }, [a.src])
  const box = displaySize(a, natural || undefined)
  const pxToCm = (px: number) => Math.round((px / 96) * 2.54 * 100) / 100
  const cmToPx = (cm: number) => Math.round((cm / 2.54) * 96)
  const colW = mmToPx(api.settings.width - api.settings.margins.left - api.settings.margins.right)
  const natRatio = natural ? natural.h / natural.w : box.h / box.w
  const set = (patch: Partial<ImgAttrs>) => e.chain().focus().updateAttributes('image', patch).run()
  const setWidth = (nw: number) => {
    const w = Math.max(12, Math.min(colW, Math.round(nw)))
    set({ width: w, height: Math.round(w * natRatio) })
  }
  const boxRatio = box.h / box.w
  const replaceRef = useRef<HTMLInputElement>(null)
  const wrap = a.wrap
  const pan = () => (document.querySelector('.wpic.selected') as HTMLElement | null)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  // The radius slider takes focus from the editor, so remember where the picture is and keep it selected.
  const picPos = useRef<number | null>(null)
  if (e.state.selection instanceof NodeSelection) picPos.current = e.state.selection.from
  const setRadius = (v: number) => {
    const pos = picPos.current
    if (pos == null || e.state.doc.nodeAt(pos)?.type.name !== 'image') return
    const tr = e.state.tr.setNodeMarkup(pos, undefined, { ...e.state.doc.nodeAt(pos)!.attrs, radius: clampRadius(v) })
    e.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
  }
  return (
    <>
      <Group label={t('g.wrap')}>
        <div className="wrap-cards">
          <button className={`wrap-card${wrap === 'topBottom' ? ' active' : ''}`} title={t('wrap.topBottomTitle')}
            onMouseDown={(ev) => ev.preventDefault()} onClick={() => set({ wrap: 'topBottom', align: a.align || 'center' })}>
            <WrapArt kind="topBottom" align={wrap === 'topBottom' ? a.align : 'center'} /><span>{t('wrap.topBottom')}</span>
          </button>
          <button className={`wrap-card${wrap === 'square' ? ' active' : ''}`} title={t('wrap.squareTitle')}
            onMouseDown={(ev) => ev.preventDefault()} onClick={() => set({ wrap: 'square', align: a.align === 'right' ? 'right' : 'left' })}>
            <WrapArt kind="square" align={wrap === 'square' ? a.align : 'left'} /><span>{t('wrap.square')}</span>
          </button>
        </div>
      </Group>
      <Group label={t('g.position')}>
        <Col>
          <Row>
            <Btn icon={ill('picLeft', 22)} title={t('common.left')} active={a.x == null && a.align === 'left'} onClick={() => set({ align: 'left', x: null, wrap: wrap || 'topBottom' })} />
            <Btn icon={ill('picCenter', 22)} title={wrap === 'square' ? t('pos.centerTopBottomOnly') : t('common.center')} disabled={wrap === 'square'} active={a.x == null && a.align === 'center' && wrap !== 'square'} onClick={() => set({ align: 'center', x: null, wrap: wrap || 'topBottom' })} />
            <Btn icon={ill('picRight', 22)} title={t('common.right')} active={a.x == null && a.align === 'right'} onClick={() => set({ align: 'right', x: null, wrap: wrap || 'topBottom' })} />
          </Row>
          <span className="muted small" style={{ maxWidth: 120, whiteSpace: 'normal' }}>{t('pos.dragHint')}</span>
        </Col>
      </Group>
      <Group label={t('g.cropShape')}>
        <Col>
          <div className="pic-gallery">
            {IMG_SHAPES.map((sh) => (
              <button key={sh.id} className={`pic-cell${a.shape === sh.id ? ' active' : ''}`} title={sh.label} onMouseDown={(ev) => ev.preventDefault()} onClick={() => set({ shape: sh.id })}>
                <span className="shape" style={{ clipPath: shapeClipCss(sh.id, sh.id === 'rounded' ? { w: 22, h: 16 } : undefined, sh.id === 'rounded' && a.shape === 'rounded' ? a.radius : DEFAULT_RADIUS), width: sh.id === 'circle' ? 16 : 22 }}>
                  <Ill name="photoFull" size={22} />
                </span>
              </button>
            ))}
          </div>
          {a.shape === 'rounded' && (
            <label className="radius-field" title={t('pic.radius')}>
              {ill('cornerRadius', 18)}
              <input type="range" min={0} max={100} step={0.1} value={radiusToSlider(a.radius)}
                onChange={(ev) => setRadius(sliderToRadius(Number(ev.target.value)))} onPointerUp={() => e.commands.focus()} />
              <span className="val">{formatRadius(a.radius)}</span>
            </label>
          )}
        </Col>
      </Group>
      <Group label={t('g.cropAspect')}>
        <Col>
          <div className="pic-gallery wide">
            {IMG_ASPECTS.map((as) => (
              <button key={as.label} className={`pic-cell aspect${(a.aspect || null) === as.id ? ' active' : ''}`} title={t('pic.aspectTitle', { ratio: as.label })} disabled={a.shape === 'circle'}
                onMouseDown={(ev) => ev.preventDefault()} onClick={() => set({ aspect: as.id, focusX: 50, focusY: 50 })}>
                {(() => {
                  const r = aspectValue(as.id) ?? (natural ? natural.w / natural.h : 1.5)
                  return <span className="ratio" style={r >= 1 ? { width: 16, height: Math.round(16 / r) } : { width: Math.round(16 * r), height: 16 }} />
                })()}
                {as.label}
              </button>
            ))}
          </div>
          <Row>
            <Btn icon={ill("pan")} label={t('pic.pan')} title={t('pic.panTitle')}
              disabled={a.shape === 'rect' && !a.aspect} onClick={pan} />
          </Row>
        </Col>
      </Group>
      <Group label={t('g.shadow')}>
        <div className="pic-gallery">
          {IMG_SHADOWS.map((sh) => {
            const p = SHADOW[sh.id]
            return (
              <button key={sh.id} className={`pic-cell${(a.shadow || 'none') === sh.id ? ' active' : ''}`} title={t('pic.shadowTitle', { name: sh.label })} onMouseDown={(ev) => ev.preventDefault()} onClick={() => set({ shadow: sh.id })}>
                <span className="shadow-cell" style={{ boxShadow: p ? `0 ${p.y / 2}px ${p.blur / 2}px rgba(0,0,0,${p.alpha + 0.1})` : 'inset 0 0 0 1px #c6d2d2' }} />
              </button>
            )
          })}
        </div>
      </Group>
      <Group label={t('g.size')}>
        <Col>
          <Row>{ill('widthArrows', 20)}<NumField label={t('common.width')} unit={t('unit.cm')} step={0.5} min={0.3} value={pxToCm(box.w)} onChange={(v) => setWidth(cmToPx(v))} /></Row>
          <Row>{ill('heightArrows', 20)}<NumField label={t('common.height')} unit={t('unit.cm')} step={0.5} min={0.3} value={pxToCm(box.h)} onChange={(v) => setWidth(cmToPx(v) / boxRatio)} /></Row>
        </Col>
        <Col>
          <Row>
            <Btn icon={ill('smaller', 22)} title={t('pic.smallerTitle')} onClick={() => setWidth(box.w * 0.9)} />
            <Btn icon={ill('bigger', 22)} title={t('pic.biggerTitle')} onClick={() => setWidth(box.w * 1.1)} />
          </Row>
          <Btn icon={ill("resetSize")} label={t('pic.resetSize')} title={t('pic.resetSizeTitle')} onClick={() => natural && setWidth(natural.w)} />
          <Btn icon={ill("fitWidth")} label={t('pic.fitText')} title={t('pic.fitTextTitle')} onClick={() => setWidth(colW)} />
        </Col>
      </Group>
      <Group label={t('g.accessibility')}>
        <label className="alt-field">
          <span className="alt-title">{ill('altText', 20)}{t('pic.alt')}</span>
          <input defaultValue={a.alt || ''} key={a.src?.slice(-32)} placeholder={t('pic.altPlaceholder')}
            onBlur={(ev) => e.chain().updateAttributes('image', { alt: ev.target.value || null }).run()}
            onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }} />
        </label>
      </Group>
      <Group label={t('g.actions')}>
        <Col>
          <Btn icon={ill("replaceImage")} label={t('pic.change')} title={t('pic.changeTitle')} onClick={() => replaceRef.current?.click()} />
          <Btn icon={ill("resetStyle")} label={t('pic.reset')} title={t('pic.resetTitle')} onClick={() => set({ shape: 'rect', aspect: null, focusX: 50, focusY: 50, shadow: 'none', radius: DEFAULT_RADIUS })} />
          <Btn icon={ill("delete")} label={t('common.delete')} title={t('pic.deleteTitle')} onClick={() => e.chain().focus().deleteSelection().run()} />
        </Col>
        <input ref={replaceRef} type="file" accept="image/*" className="hidden-input" onChange={async (ev) => {
          const f = ev.target.files?.[0]
          if (!f) return
          const r = new FileReader()
          r.onload = () => {
            const src = r.result as string
            const img = new window.Image()
            img.onload = () => set({ src, height: Math.round(box.w * (img.naturalHeight / img.naturalWidth)) })
            img.src = src
          }
          r.readAsDataURL(f)
          ev.target.value = ''
        }} />
      </Group>
    </>
  )
}
