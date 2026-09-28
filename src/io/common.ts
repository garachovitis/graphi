// Shared helpers for exporters working on ProseMirror JSON.
import type { JSONContent } from '@tiptap/core'
import { headingNumberer } from '../model/styles'
import { t } from '../i18n'

const LEAF = new Set(['text', 'image', 'hardBreak', 'horizontalRule', 'pageBreak', 'tableOfContents'])

/** Size of a JSON node in ProseMirror position units. */
export function nodeSize(n: JSONContent): number {
  if (n.type === 'text') return n.text?.length || 0
  if (LEAF.has(n.type || '')) return 1
  return 2 + (n.content || []).reduce((s, c) => s + nodeSize(c), 0)
}

export function textOf(n: JSONContent): string {
  if (n.type === 'text') return n.text || ''
  if (n.type === 'hardBreak') return '\n'
  return (n.content || []).map(textOf).join('')
}

/** Headings with the same positions ProseMirror would assign (matches the pagination map). */
export function collectHeadingsJson(doc: JSONContent): { level: number; text: string; pos: number; num: string }[] {
  const out: { level: number; text: string; pos: number; num: string }[] = []
  const number = headingNumberer()
  const walk = (n: JSONContent, pos: number) => {
    if (n.type === 'heading') {
      const t = textOf(n).trim()
      const num = number(n.attrs?.level || 1)
      if (t) out.push({ level: n.attrs?.level || 1, text: t, pos, num })
      ;(n as any).__pos = pos
      return
    }
    if (!n.content || n.type === 'text' || LEAF.has(n.type || '')) return
    let p = pos + 1
    for (const c of n.content) {
      walk(c, p)
      p += nodeSize(c)
    }
  }
  let p = 0
  for (const c of doc.content || []) {
    walk(c, p)
    p += nodeSize(c)
  }
  return out
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Caption numbers in document order: figure/table counters, keyed by the caption's JSON node. */
export function captionNumbers(doc: JSONContent): Map<JSONContent, string> {
  const m = new Map<JSONContent, string>()
  let fig = 0, tab = 0
  const walk = (n: JSONContent) => {
    if (n.type === 'paragraph' && n.attrs?.captionKind === 'figure') m.set(n, `${t('caption.figure')} ${++fig}: `)
    else if (n.type === 'paragraph' && n.attrs?.captionKind === 'table') m.set(n, `${t('caption.table')} ${++tab}: `)
    n.content?.forEach(walk)
  }
  walk(doc)
  return m
}
