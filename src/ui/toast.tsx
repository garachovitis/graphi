// Lightweight notifications (bottom-right). A toast may carry one action (e.g. "Undo").
import { useEffect, useState } from 'react'

interface ToastAction { label: string; run: () => void }
interface T { id: number; text: string; kind: 'info' | 'warn'; action?: ToastAction }
let items: T[] = []
let nextId = 1
const MAX_VISIBLE = 3
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const dismiss = (id: number) => { items = items.filter((t) => t.id !== id); emit() }

export function toast(text: string, kind: 'info' | 'warn' = 'info', action?: ToastAction, ms?: number) {
  const id = nextId++
  // A repeated message replaces the older copy; at most three are on screen at once.
  items = [...items.filter((t) => t.text !== text), { id, text, kind, action }].slice(-MAX_VISIBLE)
  emit()
  // Toasts with an action stay long enough to reach the button.
  setTimeout(() => dismiss(id), ms ?? (kind === 'warn' || action ? 7000 : 3500))
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
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}${t.action ? ' has-action' : ''}`}>
          <span>{t.text}</span>
          {t.action && (
            <button type="button" className="toast-action" onMouseDown={(e) => e.preventDefault()} onClick={() => { dismiss(t.id); t.action!.run() }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
