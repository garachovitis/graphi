// UI language (Greek / English). Every user-visible string lives in ./el.ts and ./en.ts;
// components call t('key') and re-render on change because <App> subscribes via useLang().
import { useSyncExternalStore } from 'react'
import { el, type Key } from './el'
import { en } from './en'

export type Lang = 'el' | 'en'
export type { Key }

export const LANGS: { id: Lang; name: string; native: string }[] = [
  { id: 'el', name: 'Greek', native: 'Ελληνικά' },
  { id: 'en', name: 'English', native: 'English' },
]

const DICTS: Record<Lang, Record<Key, string>> = { el, en }
const STORE_KEY = 'grafi:lang'
const listeners = new Set<() => void>()

function read(): Lang {
  try {
    const v = localStorage.getItem(STORE_KEY)
    if (v === 'el' || v === 'en') return v
  } catch {}
  return 'el'
}

let lang: Lang = read()

function apply() {
  document.documentElement.lang = lang
  ;(window as any).grafiNative?.setLanguage?.(lang)
}

export function initLang() { apply() }
export const getLang = () => lang

export function setLang(l: Lang) {
  if (l === lang) return
  lang = l
  try { localStorage.setItem(STORE_KEY, l) } catch {}
  apply()
  listeners.forEach((f) => f())
}

export function onLangChange(f: () => void) {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

export function useLang(): Lang {
  return useSyncExternalStore((f) => onLangChange(f), () => lang)
}

type Params = Record<string, string | number>

/** Translated string; `{name}` placeholders are replaced only for the params given. */
export function t(key: Key, params?: Params): string {
  let s = DICTS[lang][key] ?? el[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(typeof v === 'number' ? fmtInt(v) : v)
  return s
}

/** The same key in every language (e.g. to recognise a name created before a language switch). */
export const tAll = (key: Key) => (Object.keys(DICTS) as Lang[]).map((l) => DICTS[l][key])

/** Plural: `${base}.one` for n = 1, `${base}.other` otherwise; `{n}` is the formatted count. */
export function tn(base: string, n: number, params?: Params): string {
  return t(`${base}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...params })
}

// ───────────── numbers & dates in the UI language ─────────────
export const locale = () => (lang === 'el' ? 'el-GR' : 'en-US')
export const fmtInt = (n: number) => n.toLocaleString(locale())
export const fmtNum = (n: number, maxDigits = 2) => n.toLocaleString(locale(), { maximumFractionDigits: maxDigits, useGrouping: false })
export const fmtDate = (d = new Date()) => d.toLocaleDateString(locale())
export const fmtLongDate = (d = new Date()) => d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
/** Decimal separator of the UI language (Greek "," · English "."). */
export const decSep = () => (lang === 'el' ? ',' : '.')
/** A number as text with the UI decimal separator, without grouping (for editable fields). */
export const numText = (n: number) => String(n).replace('.', decSep())
