// Parse CSS lengths (as found in pasted Word/LibreOffice HTML) into points.

export function cssToPt(value: string | null | undefined, fontSizePt = 11): number | null {
  if (value == null) return null
  const v = String(value).trim()
  if (!v || v === 'auto' || v === 'normal') return null
  const m = /^(-?[\d.]+)\s*(pt|px|cm|mm|in|pc|em|rem|q)?$/i.exec(v)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  switch ((m[2] || 'px').toLowerCase()) {
    case 'pt': return n
    case 'px': return (n * 72) / 96
    case 'cm': return (n / 2.54) * 72
    case 'mm': return (n / 25.4) * 72
    case 'q': return (n / 101.6) * 72
    case 'in': return n * 72
    case 'pc': return n * 12
    case 'em':
    case 'rem': return n * fontSizePt
  }
  return null
}

/** Line-height as a unitless multiple. Accepts "1.5", "150%", "normal", or absolute lengths. */
export function parseLineHeight(value: string | null | undefined, fontSizePt = 11): string | null {
  if (!value) return null
  const v = value.trim()
  if (!v || v === 'normal') return null
  if (/^[\d.]+$/.test(v)) return v
  const pct = /^([\d.]+)%$/.exec(v)
  if (pct) return String(round2(parseFloat(pct[1]) / 100))
  const pt = cssToPt(v, fontSizePt)
  if (pt != null && fontSizePt > 0) return String(round2(pt / (fontSizePt * 1.2)))
  return null
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** Normalize a CSS font-size to "Npt". */
export function fontSizeToPt(value: string | null | undefined): number | null {
  if (!value) return null
  const keywords: Record<string, number> = {
    'xx-small': 7, 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24,
  }
  const k = keywords[value.trim().toLowerCase()]
  if (k) return k
  const pt = cssToPt(value)
  return pt == null ? null : round2(pt)
}

export function normalizeColor(c: string | null | undefined): string | null {
  if (!c) return null
  const v = c.trim().toLowerCase()
  if (!v || v === 'auto' || v === 'inherit' || v === 'initial' || v === 'transparent' || v === 'windowtext') return null
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(v)
  if (rgb) {
    if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return null
    return '#' + [rgb[1], rgb[2], rgb[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
  }
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v.slice(1).split('').map((x) => x + x).join('')
  return v
}
