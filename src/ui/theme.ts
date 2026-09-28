// App colour theme: follow the OS, or force light / dark. The CSS keys off :root[data-theme].
import { useSyncExternalStore } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

const KEY = 'grafi:theme'
const listeners = new Set<() => void>()
let mode: ThemeMode = read()

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'system'
}

function apply() {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

export function initTheme() { apply() }

export function setTheme(m: ThemeMode) {
  mode = m
  try { localStorage.setItem(KEY, m) } catch {}
  apply()
  listeners.forEach((l) => l())
}

export function useTheme(): ThemeMode {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => mode)
}
