// Ribbon building blocks: buttons, split buttons, popovers, color picker, combo box.
import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Crosshair, Palette, Pipette } from 'lucide-react'
import { currentTheme, hexToHsv, hsvToHex, resolveColor, themeName, themeVar, tintShade, toHex, variantName, variantsOf, type Slot } from '../model/themes'
import { addRecentColor, canEyedrop, canScope, eyedrop, recentColors, scope } from './colorPick'
import { t, numText, type Key } from '../i18n'

export function Btn(p: {
  icon?: ReactNode; label?: string; title: string; onClick?: () => void; active?: boolean; disabled?: boolean
  big?: boolean; className?: string; style?: CSSProperties
}) {
  return (
    <button
      type="button"
      className={`rb-btn${p.big ? ' big' : ''}${p.active ? ' active' : ''} ${p.className || ''}`}
      title={p.title}
      aria-label={p.title}
      aria-pressed={p.active}
      disabled={p.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.onClick}
      style={p.style}
    >
      {p.icon}
      {p.label && <span className="rb-label">{p.label}</span>}
    </button>
  )
}

export function Group(p: { label: string; children: ReactNode; onLauncher?: () => void; className?: string }) {
  return (
    <div className={`rb-group ${p.className || ''}`} role="group" aria-label={p.label}>
      <div className="rb-group-body">{p.children}</div>
      <div className="rb-group-label">
        {p.label}
        {p.onLauncher && (
          <button className="rb-launcher" title={t('ctl.launcher', { label: p.label })} onMouseDown={(e) => e.preventDefault()} onClick={p.onLauncher}>
            ↘
          </button>
        )}
      </div>
    </div>
  )
}

export const Row = (p: { children: ReactNode }) => <div className="rb-row">{p.children}</div>
export const Col = (p: { children: ReactNode; className?: string }) => <div className={`rb-col${p.className ? ` ${p.className}` : ''}`}>{p.children}</div>
export const Sep = () => <div className="rb-sep" />

/** Popover anchored to a trigger; closes on outside click / Escape. */
export function Popover(p: { anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!p.open || !p.anchor) return
    const place = () => {
      const r = p.anchor!.getBoundingClientRect()
      const el = ref.current
      const w = el?.offsetWidth || 200
      const h = el?.offsetHeight || 200
      let left = r.left
      if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8)
      let top = r.bottom + 2
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 2)
      setPos((o) => (o && o.left === left && o.top === top ? o : { left, top }))
    }
    place()
    // Content that changes size (e.g. a colour menu switching to its full picker) stays on screen.
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [p.open, p.anchor])
  useEffect(() => {
    if (!p.open) return
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || p.anchor?.contains(e.target as Node)) return
      p.onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose() }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [p.open, p.anchor, p.onClose])
  if (!p.open) return null
  return createPortal(
    <div ref={ref} className={`popover ${p.className || ''}`} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input,textarea,select')) e.preventDefault() }}>
      {p.children}
    </div>,
    document.body,
  )
}

/** Button with a dropdown. If `onClick` is given it's a split button (main action + arrow). */
export function Dropdown(p: {
  icon?: ReactNode; label?: string; title: string; onClick?: () => void; active?: boolean; big?: boolean
  children: (close: () => void) => ReactNode; className?: string; popClass?: string; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  return (
    <div ref={ref} className={`rb-split${p.big ? ' big' : ''}${p.active ? ' active' : ''} ${p.className || ''}`}>
      {p.onClick ? (
        <>
          <button type="button" className="rb-btn rb-split-main" title={p.title} disabled={p.disabled} onMouseDown={(e) => e.preventDefault()} onClick={p.onClick}>
            {p.icon}
            {p.label && <span className="rb-label">{p.label}</span>}
          </button>
          <button type="button" className="rb-btn rb-split-arrow" title={t('ctl.options', { title: p.title })} disabled={p.disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={11} />
          </button>
        </>
      ) : (
        <button type="button" className="rb-btn" title={p.title} disabled={p.disabled} aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
          {p.icon}
          {p.label && <span className="rb-label">{p.label}</span>}
          <ChevronDown size={11} className="rb-caret" />
        </button>
      )}
      <Popover anchor={ref.current} open={open} onClose={close} className={p.popClass}>
        {p.children(close)}
      </Popover>
    </div>
  )
}

export function MenuItem(p: { icon?: ReactNode; label: ReactNode; onClick: () => void; active?: boolean; hint?: string; style?: CSSProperties }) {
  return (
    <button type="button" className={`menu-item${p.active ? ' active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={p.onClick} style={p.style}>
      <span className="menu-icon">{p.icon}</span>
      <span className="menu-text">{p.label}</span>
      {p.hint && <span className="menu-hint">{p.hint}</span>}
    </button>
  )
}
export const MenuSep = () => <div className="menu-sep" />
export const MenuTitle = (p: { children: ReactNode }) => <div className="menu-title">{p.children}</div>

// ───────────── colors ─────────────
const STANDARD = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0']
/** Word's highlight palette: colour + i18n key of its name. */
export const HIGHLIGHTS: [string, Key][] = [
  ['#ffff00', 'hl.yellow'], ['#00ff00', 'hl.brightGreen'], ['#00ffff', 'hl.turquoise'], ['#ff00ff', 'hl.pink'], ['#0000ff', 'hl.blue'],
  ['#ff0000', 'hl.red'], ['#000080', 'hl.darkBlue'], ['#008080', 'hl.teal'], ['#008000', 'hl.green'], ['#800080', 'hl.violet'],
  ['#800000', 'hl.darkRed'], ['#808000', 'hl.darkYellow'], ['#808080', 'hl.gray50'], ['#c0c0c0', 'hl.gray25'], ['#000000', 'hl.black'],
]
/** Column order of Word's theme colour grid. */
const GRID_SLOTS: Slot[] = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']

/** Arrow keys move between swatches (rows of `cols`). */
function swatchKeys(e: React.KeyboardEvent<HTMLDivElement>) {
  const el = e.target as HTMLElement
  if (!el.classList.contains('swatch')) return
  const row = el.parentElement!
  const cols = getComputedStyle(row).gridTemplateColumns.split(' ').length || 10
  const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.swatch')]
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.swatches')]
  const r = rows.indexOf(row), c = [...row.children].indexOf(el)
  let target: Element | undefined
  if (e.key === 'ArrowLeft') target = all[all.indexOf(el as HTMLButtonElement) - 1]
  else if (e.key === 'ArrowRight') target = all[all.indexOf(el as HTMLButtonElement) + 1]
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const nr = rows[r + (e.key === 'ArrowUp' ? -1 : 1)]
    target = nr?.children[Math.min(c, nr.children.length - 1, cols - 1)]
  } else return
  e.preventDefault()
  ;(target as HTMLElement | undefined)?.focus()
}

/** The swatch whose colour is `value` (theme reference or hex) gets a ring. */
const sameColor = (a: string | null | undefined, b: string) => !!a && (a === b || (!a.startsWith('var(') && !b.startsWith('var(') && a.toLowerCase() === b.toLowerCase()) || (a.startsWith('var(') && b.startsWith('var(') && a.split(',')[0] === b.split(',')[0]))

/**
 * Word's colour menu, improved: theme colours come from the document's theme (and, with
 * `linkTheme`, stay linked to it), the colours used last are one click away, and "More
 * colours" opens a full picker in place — with a system eyedropper and a magnifying scope
 * for taking a colour from anything on screen.
 */
export function ColorGrid(p: { onPick: (c: string | null) => void; autoLabel?: string; highlight?: boolean; linkTheme?: boolean; value?: string | null; noAuto?: boolean }) {
  const [view, setView] = useState<'grid' | 'custom'>('grid')
  const pick = (c: string | null) => { if (c && !c.startsWith('var(')) addRecentColor(c); p.onPick(c) }
  const pickScreen = async (how: 'eye' | 'scope') => {
    const c = how === 'eye' ? await eyedrop() : await scope()
    if (c) pick(c)
  }
  if (p.highlight) {
    return (
      <div className="color-pop" onKeyDown={swatchKeys}>
        <div className="swatches hl">
          {HIGHLIGHTS.map(([c, n]) => (
            <button key={c} className={`swatch${sameColor(p.value, c) ? ' on' : ''}`} title={t(n)} aria-label={t(n)} style={{ background: c }} onClick={() => p.onPick(c)} />
          ))}
        </div>
        <MenuItem label={t('color.none')} onClick={() => p.onPick(null)} />
      </div>
    )
  }
  if (view === 'custom') {
    const start = p.value ? resolveColor(p.value) : '#1ab3ac'
    return <ColorPanel initial={/^#[0-9a-f]{6}$/i.test(start) ? start : '#1ab3ac'} onPick={pick} onCancel={() => setView('grid')} />
  }
  const th = currentTheme
  const recent = recentColors()
  return (
    <div className="color-pop" onKeyDown={swatchKeys}>
      {!p.noAuto && <MenuItem label={p.autoLabel || t('color.auto')} icon={<span className="swatch mini" style={{ background: p.autoLabel ? 'transparent' : '#000' }} />} onClick={() => p.onPick(null)} />}
      <MenuTitle>{t('color.theme')}<span className="menu-title-note">{themeName(th)}</span></MenuTitle>
      <div className="theme-grid">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className={`swatches${row === 0 ? ' first' : ''}`}>
            {GRID_SLOTS.map((slot) => {
              const base = th.colors[slot]
              const pct = row === 0 ? 0 : variantsOf(base)[row - 1]
              const hex = tintShade(base, pct)
              const out = p.linkTheme ? themeVar(slot, pct) : hex
              const name = variantName(slot, pct)
              return <button key={slot} className={`swatch${sameColor(p.value, out) ? ' on' : ''}`} title={name} aria-label={name} style={{ background: hex }} onClick={() => pick(out)} />
            })}
          </div>
        ))}
      </div>
      <MenuTitle>{t('color.standard')}</MenuTitle>
      <div className="swatches first">
        {STANDARD.map((c) => <button key={c} className={`swatch${sameColor(p.value, c) ? ' on' : ''}`} title={c} aria-label={c} style={{ background: c }} onClick={() => pick(c)} />)}
      </div>
      {recent.length > 0 && (
        <>
          <MenuTitle>{t('color.recent')}</MenuTitle>
          <div className="swatches first">
            {recent.map((c) => <button key={c} className={`swatch${sameColor(p.value, c) ? ' on' : ''}`} title={c.toUpperCase()} aria-label={c} style={{ background: c }} onClick={() => pick(c)} />)}
          </div>
        </>
      )}
      <MenuSep />
      <MenuItem icon={<Palette size={15} />} label={t('color.more')} onClick={() => setView('custom')} />
      <ScreenPickers onPick={(how) => pickScreen(how)} />
    </div>
  )
}

/** "Pick from screen" (system eyedropper) and "Scope" (magnifier) — whichever this platform has. */
function ScreenPickers(p: { onPick: (how: 'eye' | 'scope') => void; compact?: boolean }) {
  const eye = canEyedrop(), sc = canScope()
  if (!eye && !sc) return null
  return (
    <div className={`pick-row${p.compact ? ' compact' : ''}`}>
      {eye && (
        <button type="button" className="pick-btn" title={t('pick.eyeTitle')} onMouseDown={(e) => e.preventDefault()} onClick={() => p.onPick('eye')}>
          <Pipette size={15} /><span>{t('pick.eye')}</span>
        </button>
      )}
      {sc && (
        <button type="button" className="pick-btn" title={t('pick.scopeTitle')} onMouseDown={(e) => e.preventDefault()} onClick={() => p.onPick('scope')}>
          <Crosshair size={15} /><span>{t('pick.scope')}</span>
        </button>
      )}
    </div>
  )
}

/** Colour picker: saturation/brightness field, hue strip, HEX, eyedropper and scope. */
export function ColorPanel(p: { initial: string; onPick: (hex: string) => void; onCancel?: () => void; okLabel?: string; live?: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(p.initial))
  const hex = hsvToHex(hsv[0], hsv[1], hsv[2])
  const [text, setText] = useState(hex.toUpperCase())
  useEffect(() => { setText(hex.toUpperCase()); p.live?.(hex) }, [hex])
  const setHex = (h: string) => { const v = toHex(h); if (v) setHsv(hexToHsv(v)) }
  const drag = (el: HTMLElement, e: React.PointerEvent, f: (x: number, y: number) => void) => {
    el.setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    const at = (ev: { clientX: number; clientY: number }) => f(Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)))
    at(e)
    const move = (ev: PointerEvent) => at(ev)
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const svKeys = (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.01
    const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }
    const v = m[e.key]; if (!v) return
    e.preventDefault()
    setHsv(([h, s, vv]) => [h, Math.min(1, Math.max(0, s + v[0])), Math.min(1, Math.max(0, vv + v[1]))])
  }
  const hueKeys = (e: React.KeyboardEvent) => {
    const d = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0)
    if (!d) return
    e.preventDefault()
    setHsv(([h, s, v]) => [(h + d + 360) % 360, s, v])
  }
  const screen = async (how: 'eye' | 'scope') => { const c = how === 'eye' ? await eyedrop() : await scope(); if (c) setHex(c) }
  return (
    <div className="color-panel">
      <div className="cp-sv" role="slider" tabIndex={0} aria-label={t('cp.field')} aria-valuetext={hex.toUpperCase()}
        style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${hsvToHex(hsv[0], 1, 1)})` }}
        onKeyDown={svKeys}
        onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => setHsv(([h]) => [h, x, 1 - y]))}>
        <i style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: hex }} />
      </div>
      <div className="cp-hue" role="slider" tabIndex={0} aria-label={t('cp.hue')} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv[0])}
        onKeyDown={hueKeys}
        onPointerDown={(e) => drag(e.currentTarget, e, (x) => setHsv(([, s, v]) => [x * 359.9, s, v]))}>
        <i style={{ left: `${(hsv[0] / 360) * 100}%`, background: hsvToHex(hsv[0], 1, 1) }} />
      </div>
      <div className="cp-row">
        <div className="cp-compare" title={t('cp.compare')}>
          <span style={{ background: hex }}>{t('cp.new')}</span>
          <span style={{ background: p.initial }} onClick={() => setHex(p.initial)}>{t('cp.current')}</span>
        </div>
        <label className="cp-hex"><span>HEX</span>
          <input value={text} spellCheck={false} maxLength={7} aria-label="HEX"
            onChange={(e) => { setText(e.target.value); if (toHex(e.target.value)) setHex(e.target.value) }}
            onBlur={() => setText(hex.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); p.onPick(hex) } }} />
        </label>
      </div>
      <ScreenPickers compact onPick={screen} />
      <div className="cp-actions">
        {p.onCancel && <button type="button" className="btn" onClick={p.onCancel}>{t('common.cancel')}</button>}
        <button type="button" className="btn primary" onClick={() => p.onPick(hex)}>{p.okLabel || t('common.ok')}</button>
      </div>
    </div>
  )
}

/** A colour well for dialogs: swatch button that opens the colour menu. */
export function ColorWell(p: { value: string | null; onChange: (c: string | null) => void; label: string; linkTheme?: boolean; autoLabel?: string; noAuto?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const shown = p.value ? resolveColor(p.value) : null
  return (
    <>
      <button ref={ref} type="button" className="color-well" aria-label={p.label} title={shown ? `${p.label}: ${shown.toUpperCase()}` : p.label}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <i style={{ background: shown || 'transparent' }} className={shown ? '' : 'none'} />
        <span>{shown ? shown.toUpperCase() : p.autoLabel || t('color.auto')}</span>
        <ChevronDown size={11} />
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)}>
        <ColorGrid value={p.value} linkTheme={p.linkTheme} autoLabel={p.autoLabel} noAuto={p.noAuto} onPick={(c) => { p.onChange(c); setOpen(false) }} />
      </Popover>
    </>
  )
}

/** Editable combo (font size): type a value and press Enter, or pick from the list. */
export function Combo(p: { value: string; options: string[]; onCommit: (v: string) => void; width: number; title: string; renderOption?: (o: string) => ReactNode; editable?: boolean; label?: (v: string) => string }) {
  // label: display name for a read-only combo (editable ones commit what is typed)
  const shown = p.label ? p.label(p.value) : p.value
  const [text, setText] = useState(shown)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setText(shown), [shown])
  return (
    <div ref={ref} className="combo" style={{ width: p.width }} title={p.title}>
      <input
        value={text}
        aria-label={p.title}
        readOnly={p.editable === false}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { p.onCommit(text); setOpen(false) }
          if (e.key === 'Escape') { setText(shown); setOpen(false) }
          if (e.key === 'ArrowDown') setOpen(true)
        }}
        onMouseDown={() => { if (p.editable === false) setOpen((o) => !o) }}
        onBlur={() => setText(shown)}
      />
      <button type="button" className="combo-arrow" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={11} />
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} className="combo-list">
        {p.options.map((o) => (
          <button key={o} type="button" className={`menu-item${o === p.value ? ' active' : ''}`} onClick={() => { p.onCommit(o); setOpen(false) }}>
            <span className="menu-text">{p.renderOption ? p.renderOption(o) : o}</span>
          </button>
        ))}
      </Popover>
    </div>
  )
}

export function NumField(p: { label: string; value: number; step: number; min?: number; max?: number; unit: string; onChange: (v: number) => void; width?: number }) {
  const [text, setText] = useState(String(p.value))
  useEffect(() => setText(fmt(p.value)), [p.value])
  const commit = (v: number) => {
    const c = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, Math.round(v * 100) / 100))
    p.onChange(c)
    setText(fmt(c))
  }
  return (
    <label className="numfield">
      <span className="numfield-label">{p.label}</span>
      <span className="numfield-box" style={{ width: p.width || 78 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(parseLocale(text) ?? p.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(parseLocale(text) ?? p.value)
            if (e.key === 'ArrowUp') { e.preventDefault(); commit(p.value + p.step) }
            if (e.key === 'ArrowDown') { e.preventDefault(); commit(p.value - p.step) }
          }}
        />
        <span className="numfield-unit">{p.unit}</span>
        <span className="numfield-spin">
          <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(p.value + p.step)}>▴</button>
          <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(p.value - p.step)}>▾</button>
        </span>
      </span>
    </label>
  )
}
const fmt = (n: number) => numText(Math.round(n * 100) / 100)
export const parseLocale = (s: string) => {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
