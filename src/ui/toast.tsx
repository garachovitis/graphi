// Lightweight notifications (bottom-right).
import { useEffect, useState } from 'react'

interface T { id: number; text: string; kind: 'info' | 'warn' }
let items: T[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(text: string, kind: 'info' | 'warn' = 'info') {
  const id = nextId++
  items = [...items, { id, text, kind }]
  emit()
  setTimeout(() => { items = items.filter((t) => t.id !== id); emit() }, kind === 'warn' ? 7000 : 3500)
}

export function Toasts() {
  const [, set] = useState(0)
  useEffect(() => {
    const l = () => set((x) => x + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return (
    <div className="toasts no-print" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  )
}
