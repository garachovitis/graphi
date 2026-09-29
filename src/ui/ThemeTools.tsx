// Design ▸ Themes / Colors / Fonts, and the Theme Studio dialog.
//
// Interaction principles (beyond Word's Design tab):
//  • Live preview: resting on any theme, palette, font pair or style set shows it on the
//    document; nothing changes until a click (and every change can be undone from the toast).
//  • One small dialog for a custom theme: pick a ready palette, change any colour (also
//    straight off the screen with the eyedropper / scope), choose two fonts. The document
//    behind it shows the result as you go.
//  • Recognition over recall: every palette is shown as colours and every font pair in its
//    own fonts; the current choice is always marked.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil, Star, Trash2, Wand2 } from 'lucide-react'
import type { AppApi, DesignPreview } from './App'
import { MenuItem, MenuSep, MenuTitle, ColorPanel, Popover } from './controls'
import { Modal } from './dialogs'
import { toast } from './toast'
import {
  BUILTIN_THEMES, FONT_PAIRS, PALETTES, THEME_FONTS, cloneTheme, customThemes, deleteCustomTheme,
  fontPairName, onThemesChange, restoreCustomTheme, sameColors, sameFonts, sameTheme,
  saveCustomTheme, setUserDefaultDesign, themeName, type DocTheme, type Slot, type ThemeColors, type ThemeFonts,
} from '../model/themes'
import { STYLE_SETS, fontHint, fontLabel, fontStack, resolveSet, styleName } from '../model/styles'
import { t, type Key } from '../i18n'

// ───────────── shared bits ─────────────

/** Rest-to-preview with a short delay, so sweeping across a gallery doesn't thrash the layout. */
export function usePreview(api: AppApi) {
  const timer = useRef(0)
  useEffect(() => () => { clearTimeout(timer.current); api.previewDesign(null) }, [])
  return {
    enter: (p: DesignPreview) => { clearTimeout(timer.current); timer.current = window.setTimeout(() => api.previewDesign(p), 110) },
    leave: () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => api.previewDesign(null), 110) },
    stop: () => { clearTimeout(timer.current); api.previewDesign(null) },
  }
}

function useCustomThemes() {
  const [list, set] = useState(customThemes)
  useEffect(() => onThemesChange(() => set(customThemes())), [])
  return list
}

/** Commits a theme to the document; the toast can put the previous one back. */
export function applyTheme(api: AppApi, theme: DocTheme, what: 'theme' | 'colors' | 'fonts' = 'theme') {
  const prev = api.settings
  api.setSettings({ ...prev, theme: cloneTheme(theme) })
  const msg = what === 'colors' ? t('design.colorsApplied') : what === 'fonts' ? t('design.fontsApplied', { name: fontPairName(theme.fonts) }) : t('design.themeApplied', { name: themeName(theme) })
  toast(msg, 'info', { label: t('common.undo'), run: () => api.setSettings(prev) })
}

const ACCENTS: Slot[] = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']

/** Word-style theme thumbnail: "Aa" in the heading font over the background, and the six accents. */
export function ThemeThumb({ theme, size = 'md' }: { theme: DocTheme; size?: 'sm' | 'md' }) {
  const c = theme.colors
  return (
    <span className={`theme-thumb ${size}`} style={{ background: c.lt1 }} aria-hidden>
      <span className="tt-aa" style={{ fontFamily: fontStack(theme.fonts.major), color: c.dk2 }}>Aa</span>
      <span className="tt-bars">{ACCENTS.map((s) => <i key={s} style={{ background: c[s] }} />)}</span>
    </span>
  )
}

const PaletteStrip = ({ colors }: { colors: ThemeColors }) => (
  <span className="palette-strip" aria-hidden>
    {(['dk2', 'lt2', ...ACCENTS] as Slot[]).map((s) => <i key={s} style={{ background: colors[s] }} />)}
  </span>
)

// ───────────── Themes gallery ─────────────
export function ThemesMenu({ api, close }: { api: AppApi; close: () => void }) {
  const pv = usePreview(api)
  const custom = useCustomThemes()
  const cur = api.settings.theme
  const pick = (th: DocTheme) => { pv.stop(); applyTheme(api, th); close() }
  const card = (th: DocTheme, own = false) => (
    <div key={th.id} className={`theme-card-wrap${own ? ' own' : ''}`}>
      <button type="button" className={`theme-card${sameTheme(th, cur) ? ' active' : ''}`} title={`${themeName(th)} · ${fontPairName(th.fonts)}`}
        aria-pressed={sameTheme(th, cur)}
        onMouseEnter={() => pv.enter({ theme: th })} onMouseLeave={pv.leave} onFocus={() => pv.enter({ theme: th })} onBlur={pv.leave}
        onClick={() => pick(th)}>
        <ThemeThumb theme={th} />
        <span className="tc-name">{themeName(th)}</span>
        {sameTheme(th, cur) && <Check size={13} className="tc-check" />}
      </button>
      {own && (
        <span className="tc-tools">
          <button type="button" title={t('design.editTheme')} aria-label={t('design.editTheme')} onClick={() => { pv.stop(); close(); api.openDialog({ type: 'theme', theme: th }) }}><Pencil size={12} /></button>
          <button type="button" title={t('design.deleteTheme')} aria-label={t('design.deleteTheme')} onClick={() => {
            const at = custom.findIndex((x) => x.id === th.id)
            deleteCustomTheme(th.id)
            toast(t('design.themeDeleted', { name: th.name }), 'info', { label: t('common.undo'), run: () => restoreCustomTheme(th, at) })
          }}><Trash2 size={12} /></button>
        </span>
      )}
    </div>
  )
  return (
    <div className="themes-menu" onMouseLeave={pv.leave}>
      {custom.length > 0 && (
        <>
          <MenuTitle>{t('design.custom')}</MenuTitle>
          <div className="theme-cards">{custom.map((th) => card(th, true))}</div>
        </>
      )}
      <MenuTitle>{t('design.builtin')}</MenuTitle>
      <div className="theme-cards">{BUILTIN_THEMES.map((th) => card(th))}</div>
      <MenuSep />
      <MenuItem icon={<Wand2 size={15} />} label={t('design.customizeTheme')} onClick={() => { pv.stop(); close(); api.openDialog({ type: 'theme' }) }} />
      <MenuItem icon={<Star size={15} />} label={t('design.setDefault')} onClick={() => { pv.stop(); setAsDefault(api); close() }} />
    </div>
  )
}

// ───────────── Colors / Fonts menus ─────────────
export function ColorsMenu({ api, close }: { api: AppApi; close: () => void }) {
  const pv = usePreview(api)
  const cur = api.settings.theme
  const custom = useCustomThemes().filter((c, i, a) => !PALETTES.some((p) => sameColors(p.colors, c.colors)) && a.findIndex((x) => sameColors(x.colors, c.colors)) === i)
  const row = (key: string, name: string, colors: ThemeColors) => {
    const th = { ...cur, colors }
    const on = sameColors(colors, cur.colors)
    return (
      <button key={key} type="button" className={`menu-item palette-row${on ? ' active' : ''}`} aria-pressed={on}
        onMouseEnter={() => pv.enter({ theme: th })} onMouseLeave={pv.leave} onFocus={() => pv.enter({ theme: th })} onBlur={pv.leave}
        onClick={() => { pv.stop(); applyTheme(api, { ...th, id: 'custom', name: `${name}` }, 'colors'); close() }}>
        <PaletteStrip colors={colors} />
        <span className="menu-text">{name}</span>
        {on && <Check size={13} />}
      </button>
    )
  }
  return (
    <div className="palette-menu" onMouseLeave={pv.leave}>
      {custom.length > 0 && <><MenuTitle>{t('design.custom')}</MenuTitle>{custom.map((c) => row(c.id, c.name, c.colors))}</>}
      <MenuTitle>{t('design.builtin')}</MenuTitle>
      {PALETTES.map((p) => row(p.id, p.name, p.colors))}
      <MenuSep />
      <MenuItem icon={<Wand2 size={15} />} label={t('design.customizeColors')} onClick={() => { pv.stop(); close(); api.openDialog({ type: 'theme' }) }} />
    </div>
  )
}

export function FontsMenu({ api, close }: { api: AppApi; close: () => void }) {
  const pv = usePreview(api)
  const cur = api.settings.theme
  const custom = useCustomThemes().map((c) => c.fonts).filter((f, i, a) => !FONT_PAIRS.some((p) => sameFonts(p.fonts, f)) && a.findIndex((x) => sameFonts(x, f)) === i)
  const row = (fonts: ThemeFonts) => {
    const th = { ...cur, fonts }
    const on = sameFonts(fonts, cur.fonts)
    return (
      <button key={`${fonts.major}|${fonts.minor}`} type="button" className={`menu-item font-row${on ? ' active' : ''}`} aria-pressed={on}
        onMouseEnter={() => pv.enter({ theme: th })} onMouseLeave={pv.leave} onFocus={() => pv.enter({ theme: th })} onBlur={pv.leave}
        onClick={() => { pv.stop(); applyTheme(api, th, 'fonts'); close() }}>
        <span className="fr-aa" style={{ fontFamily: fontStack(fonts.major) }}>Aa</span>
        <span className="fr-names">
          <b style={{ fontFamily: fontStack(fonts.major) }} title={fontHint(fonts.major) || undefined}>{fontLabel(fonts.major)}</b>
          <span style={{ fontFamily: fontStack(fonts.minor) }} title={fontHint(fonts.minor) || undefined}>{fontLabel(fonts.minor)}</span>
        </span>
        {on && <Check size={13} />}
      </button>
    )
  }
  return (
    <div className="fonts-menu" onMouseLeave={pv.leave}>
      {custom.length > 0 && <><MenuTitle>{t('design.custom')}</MenuTitle>{custom.map(row)}</>}
      <MenuTitle>{t('design.builtinFonts')}</MenuTitle>
      {FONT_PAIRS.map((p) => row(p.fonts))}
      <MenuSep />
      <MenuItem icon={<Wand2 size={15} />} label={t('design.customizeFonts')} onClick={() => { pv.stop(); close(); api.openDialog({ type: 'theme' }) }} />
    </div>
  )
}

/** Style-set cards (Document Formatting), drawn in the current theme. */
export function StyleSetGallery({ api }: { api: AppApi }) {
  const pv = usePreview(api)
  return (
    <div className="style-sets" onMouseLeave={pv.leave}>
      {STYLE_SETS.map((set) => {
        const r = resolveSet(set, api.settings.theme)
        const on = api.settings.styleSet === set.id
        const pick = () => {
          pv.stop()
          const prev = api.settings
          api.setSettings({ ...prev, styleSet: set.id })
          toast(t('design.setApplied', { name: set.name }), 'info', { label: t('common.undo'), run: () => api.setSettings(prev) })
        }
        return (
          <button key={set.id} className={`set-card${on ? ' active' : ''}`} title={set.name} aria-pressed={on}
            onMouseDown={(ev) => ev.preventDefault()} onClick={pick}
            onMouseEnter={() => pv.enter({ styleSet: set.id })} onMouseLeave={pv.leave}
            onFocus={() => pv.enter({ styleSet: set.id })} onBlur={pv.leave}
            style={{ background: api.settings.theme.colors.lt1 }}>
            <span className="set-title" style={{ fontFamily: fontStack(r.headingFont), color: r.title, fontWeight: r.titleBold ? 700 : 400, textAlign: set.titleAlign || 'left' }}>{styleName('Title')}</span>
            <span className="set-h1" style={{ fontFamily: fontStack(r.headingFont), color: r.h1, fontWeight: r.headingBold ? 700 : 400 }}>{styleName('Heading1')}</span>
            <span className="set-body" style={{ fontFamily: fontStack(r.bodyFont) }}>{t('design.body')}</span>
            <span className="set-name">{set.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Word's "Set as Default": new blank documents start with this style set and theme. */
export function setAsDefault(api: AppApi) {
  setUserDefaultDesign({ theme: api.settings.theme, styleSet: api.settings.styleSet })
  toast(t('design.defaultSet', { name: themeName(api.settings.theme) }), 'info', { label: t('common.undo'), run: () => setUserDefaultDesign(null) })
}

// ───────────── "My theme" dialog ─────────────
// Deliberately small: start from a ready palette, change any colour, choose two fonts.
const WELLS: Slot[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']

export function ThemeStudio({ api, close, initial }: { api: AppApi; close: () => void; initial?: DocTheme }) {
  const start = useMemo(() => {
    const base = initial || api.settings.theme
    // A theme from the user's library is edited in place; anything else becomes a new theme.
    if (base.id.startsWith('u-') && customThemes().some((x) => x.id === base.id)) return cloneTheme(base)
    return cloneTheme(base, { id: 'new', name: t('design.newThemeName', { n: String(customThemes().length + 1) }) })
  }, [])
  const [draft, setDraft] = useState<DocTheme>(start)
  const setColor = (slot: Slot, hex: string) => setDraft((d) => ({ ...d, colors: { ...d.colors, [slot]: hex } }))

  // The document shows the theme while it is being made (debounced: dragging stays smooth).
  useEffect(() => {
    const id = window.setTimeout(() => api.previewDesign({ theme: draft }), 120)
    return () => clearTimeout(id)
  }, [draft])
  useEffect(() => () => api.previewDesign(null), [])

  const valid = draft.name.trim().length > 0
  const save = () => { applyTheme(api, saveCustomTheme(draft)); close() }
  const fontSel = (which: 'major' | 'minor', label: Key) => (
    <label className="field"><span>{t(label)}</span>
      <select value={draft.fonts[which]} style={{ fontFamily: fontStack(draft.fonts[which]) }}
        onChange={(e) => setDraft({ ...draft, fonts: { ...draft.fonts, [which]: e.target.value } })}>
        {[...new Set([draft.fonts[which], ...THEME_FONTS])].map((n) => <option key={n} value={n} style={{ fontFamily: fontStack(n) }}>{n}</option>)}
      </select>
    </label>
  )
  return (
    <Modal title={t('studio.title')} onClose={close} width={560}
      footer={<><span className="grow" /><button className="btn" onClick={close}>{t('common.cancel')}</button><button className="btn primary" disabled={!valid} onClick={save}>{t('studio.save')}</button></>}>
      <label className="field"><span>{t('studio.name')}</span>
        <input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <div className="studio-block">
        <div className="studio-label">{t('studio.palettes')}</div>
        <div className="preset-grid">
          {PALETTES.map((p) => {
            const on = sameColors(p.colors, draft.colors)
            return (
              <button key={p.id} type="button" className={`preset${on ? ' active' : ''}`} title={p.name} aria-pressed={on}
                onClick={() => setDraft({ ...draft, colors: { ...p.colors } })}>
                <PaletteStrip colors={p.colors} />
                <span>{p.name}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="studio-block">
        <div className="studio-label">{t('studio.yourColors')}</div>
        <div className="wells">
          {WELLS.map((s) => <SlotWell key={s} value={draft.colors[s]} label={t(`slotShort.${s}` as Key)} onChange={(hex) => setColor(s, hex)} />)}
        </div>
      </div>
      <div className="studio-fonts">{fontSel('major', 'studio.headingFont')}{fontSel('minor', 'studio.bodyFont')}</div>
    </Modal>
  )
}

/** A colour with its name; opens the colour picker (with eyedropper and scope). */
function SlotWell({ value, label, onChange }: { value: string; label: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <div className="well">
      <button ref={ref} type="button" className="slot-well" style={{ background: value }} aria-label={t('studio.changeColor', { name: label })} title={`${label} · ${value.toUpperCase()}`}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      <span>{label}</span>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)}>
        <ColorPanel initial={value} onPick={(hex) => { onChange(hex); setOpen(false) }} onCancel={() => setOpen(false)} />
      </Popover>
    </div>
  )
}
