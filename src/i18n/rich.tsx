// Translations with light inline markup, rendered as React elements (never as raw HTML):
//   <b>bold</b>  <g>green bold</g>  <k>keyboard key</k>
import { Fragment, type ReactNode } from 'react'
import { t, type Key } from './index'

const TAGS = /<(b|g|k)>(.*?)<\/\1>/g

export function richText(s: string): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  TAGS.lastIndex = 0
  while ((m = TAGS.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const [, tag, inner] = m
    const k = out.length
    if (tag === 'b') out.push(<b key={k}>{inner}</b>)
    else if (tag === 'g') out.push(<b key={k} className="tr-green">{inner}</b>)
    else out.push(<kbd key={k} className="tr-key">{inner}</kbd>)
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return <Fragment>{out}</Fragment>
}

/** t() + inline markup. */
export const rich = (key: Key, params?: Record<string, string | number>) => richText(t(key, params))
