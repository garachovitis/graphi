// Ribbon building blocks: buttons, split buttons, popovers, color picker, combo box.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
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
export const Col = (p: { children: ReactNode }) => <div className="rb-col">{p.children}</div>
export const Sep = () => <div className="rb-sep" />

/** Popover anchored to a trigger; closes on outside click / Escape. */
export function Popover(p: { anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!p.open || !p.anchor) return
    const r = p.anchor.getBoundingClientRect()
    const el = ref.current
    const w = el?.offsetWidth || 200
    const h = el?.offsetHeight || 200
    let left = r.left
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8)
    let top = r.bottom + 2
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 2)
    setPos({ left, top })
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
const THEME_BASE = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#0F766E', '#ED7D31', '#A5A5A5', '#FFC000', '#4472C4', '#70AD47']
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  if (f > 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f } else { r *= 1 + f; g *= 1 + f; b *= 1 + f }
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
}
const THEME_ROWS = [0, 0.8, 0.6, 0.4, -0.25, -0.5].map((f) => THEME_BASE.map((c, i) => (f === 0 ? c : shade(c, i === 0 ? -Math.abs(f) * 0.5 : i === 1 ? Math.abs(f) * 0.9 : f))))
const STANDARD = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0']
/** Word's highlight palette: colour + i18n key of its name. */
export const HIGHLIGHTS: [string, Key][] = [
  ['#ffff00', 'hl.yellow'], ['#00ff00', 'hl.brightGreen'], ['#00ffff', 'hl.turquoise'], ['#ff00ff', 'hl.pink'], ['#0000ff', 'hl.blue'],
  ['#ff0000', 'hl.red'], ['#000080', 'hl.darkBlue'], ['#008080', 'hl.teal'], ['#008000', 'hl.green'], ['#800080', 'hl.violet'],
  ['#800000', 'hl.darkRed'], ['#808000', 'hl.darkYellow'], ['#808080', 'hl.gray50'], ['#c0c0c0', 'hl.gray25'], ['#000000', 'hl.black'],
]

export function ColorGrid(p: { onPick: (c: string | null) => void; autoLabel?: string; highlight?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  if (p.highlight) {
    return (
      <div className="color-pop">
        <div className="swatches hl">
          {HIGHLIGHTS.map(([c, n]) => (
            <button key={c} className="swatch" title={t(n)} style={{ background: c }} onClick={() => p.onPick(c)} />
          ))}
        </div>
        <MenuItem label={t('color.none')} onClick={() => p.onPick(null)} />
      </div>
    )
  }
  return (
    <div className="color-pop">
      <MenuItem label={p.autoLabel || t('color.auto')} icon={<span className="swatch mini" style={{ background: '#000' }} />} onClick={() => p.onPick(null)} />
      <MenuTitle>{t('color.theme')}</MenuTitle>
      {THEME_ROWS.map((row, i) => (
        <div key={i} className={`swatches${i === 0 ? ' first' : ''}`}>
          {row.map((c) => <button key={c + i} className="swatch" title={c} style={{ background: c }} onClick={() => p.onPick(c)} />)}
        </div>
      ))}
      <MenuTitle>{t('color.standard')}</MenuTitle>
      <div className="swatches first">
        {STANDARD.map((c) => <button key={c} className="swatch" title={c} style={{ background: c }} onClick={() => p.onPick(c)} />)}
      </div>
      <MenuSep />
      <MenuItem label={t('color.more')} onClick={() => inputRef.current?.click()} />
      <input ref={inputRef} type="color" className="hidden-input" onChange={(e) => p.onPick(e.target.value)} />
    </div>
  )
}

/** Editable combo (font size): type a value and press Enter, or pick from the list. */
export function Combo(p: { value: string; options: string[]; onCommit: (v: string) => void; width: number; title: string; renderOption?: (o: string) => ReactNode; editable?: boolean }) {
  const [text, setText] = useState(p.value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setText(p.value), [p.value])
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
          if (e.key === 'Escape') { setText(p.value); setOpen(false) }
          if (e.key === 'ArrowDown') setOpen(true)
        }}
        onMouseDown={() => { if (p.editable === false) setOpen((o) => !o) }}
        onBlur={() => setText(p.value)}
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
