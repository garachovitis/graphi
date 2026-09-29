// Optional deeper grammar check through the public LanguageTool API (opt-in: the text leaves
// the device). Results are cached per paragraph; spelling stays with the offline dictionaries.
import type { IssueKind, TextIssue } from './rules'
import { isGreek } from './dictionary'

const API = 'https://api.languagetool.org/v2/check'
const MAX_CHARS = 12000 // public API: 20 KB per request, 20 requests per minute

interface LtMatch {
  message: string
  shortMessage?: string
  offset: number
  length: number
  replacements: { value: string }[]
  rule: { id: string; issueType?: string; category: { id: string; name: string } }
}

const cache = new Map<string, TextIssue[]>()
let blockedUntil = 0

export const ltCached = (text: string) => cache.get(text)
export const ltClear = () => cache.clear()

function kindOf(m: LtMatch): IssueKind | null {
  const cat = m.rule.category.id
  const type = m.rule.issueType || ''
  if (type === 'misspelling' || cat === 'TYPOS') return null // the offline dictionaries own spelling
  if (cat === 'PUNCTUATION' || cat === 'TYPOGRAPHY' || type === 'typographical' || type === 'whitespace') return 'punct'
  if (cat === 'STYLE' || cat === 'REDUNDANCY' || cat === 'PLAIN_ENGLISH' || type === 'style' || type === 'locale-violation') return 'style'
  return 'grammar'
}

/**
 * Checks the paragraphs that are not cached yet (one request per language, batched).
 * Returns true when new results arrived.
 */
export async function ltCheck(paragraphs: string[], uiLang: 'el' | 'en'): Promise<boolean> {
  if (Date.now() < blockedUntil || !navigator.onLine) return false
  const todo = [...new Set(paragraphs)].filter((p) => !cache.has(p) && /\p{L}{2,}.*\s.*\p{L}{2,}/u.test(p))
  if (!todo.length) return false
  let changed = false
  for (const lang of ['el-GR', 'en-US'] as const) {
    const group = todo.filter((p) => (lang === 'el-GR') === isGreek(p))
    while (group.length) {
      const batch: string[] = []
      let size = 0
      while (group.length && size + group[0].length < MAX_CHARS) { size += group[0].length + 2; batch.push(group.shift()!) }
      if (!batch.length) { cache.set(group.shift()!, []); continue } // a single huge paragraph: skip
      const text = batch.join('\n\n')
      const body = new URLSearchParams({ text, language: lang, motherTongue: uiLang === 'el' ? 'el' : 'en', level: 'default' })
      let res: Response
      try {
        res = await fetch(API, { method: 'POST', body, headers: { Accept: 'application/json' } })
      } catch {
        return changed
      }
      if (res.status === 429) { blockedUntil = Date.now() + 60_000; return changed }
      if (!res.ok) return changed
      const data = (await res.json()) as { matches: LtMatch[] }
      // Split the matches back into their paragraphs.
      let start = 0
      for (const p of batch) {
        const end = start + p.length
        const own: TextIssue[] = []
        for (const m of data.matches) {
          if (m.offset < start || m.offset + m.length > end) continue
          const kind = kindOf(m)
          if (!kind) continue
          own.push({
            start: m.offset - start, end: m.offset - start + m.length, kind, rule: `lt:${m.rule.id}`,
            sugg: m.replacements.slice(0, 4).map((r) => r.value), msg: m.message, title: m.shortMessage || m.rule.category.name,
          })
        }
        cache.set(p, own)
        start = end + 2
      }
      changed = true
    }
  }
  return changed
}
