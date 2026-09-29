// Spelling dictionaries: Greek (LibreOffice el_GR, 828k inflected forms) and English (Hunspell
// en_US via nspell), plus the user's own dictionary. Everything runs offline, on every platform.
//
// The Greek list is one sorted string + an offset table (≈20 MB) instead of a Set of 828k strings
// (≈70 MB); a lookup is a binary search without allocations. Suggestions are generated from the
// kinds of mistakes Greek writers actually make — accent placement, vowels that sound alike
// (ι/η/υ/ει/οι, ο/ω, ε/αι), double consonants — then ordinary one-letter edits.
import type { NSpell } from 'nspell'

// ───────────── loading ─────────────

async function gunzip(b64: string): Promise<string> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

class WordList {
  private off: Uint32Array
  readonly size: number
  constructor(private s: string) {
    let n = 1
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
    this.off = new Uint32Array(n + 1)
    let k = 1
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) this.off[k++] = i + 1
    this.off[n] = s.length + 1
    this.size = n
  }
  has(w: string): boolean {
    const s = this.s
    let lo = 0
    let hi = this.size - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const a = this.off[mid]
      const len = this.off[mid + 1] - 1 - a
      const m = Math.min(len, w.length)
      let d = 0
      for (let i = 0; i < m && !d; i++) d = w.charCodeAt(i) - s.charCodeAt(a + i)
      if (!d) d = w.length - len
      if (d === 0) return true
      if (d < 0) hi = mid - 1
      else lo = mid + 1
    }
    return false
  }
}

let el: WordList | null = null
let en: NSpell | null = null
let elLoading: Promise<void> | null = null
let enLoading: Promise<void> | null = null

export const dictReady = { el: () => !!el, en: () => !!en }

export function loadGreek(): Promise<void> {
  return (elLoading ??= import('virtual:dict/el').then(async (m) => { el = new WordList(await gunzip(m.default)) }))
}

export function loadEnglish(): Promise<void> {
  return (enLoading ??= Promise.all([import('virtual:dict/en'), import('nspell')]).then(async ([d, ns]) => {
    const [aff, dic] = await Promise.all([gunzip(d.aff), gunzip(d.dic)])
    en = ns.default(aff, dic)
  }))
}

// ───────────── user dictionary (per device) ─────────────

const USER_KEY = 'grafi:dictionary'
let user = new Set<string>(readUser())
const userListeners = new Set<() => void>()

function readUser(): string[] {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || '[]') } catch { return [] }
}
function saveUser() {
  try { localStorage.setItem(USER_KEY, JSON.stringify([...user])) } catch { /* private mode */ }
  userListeners.forEach((f) => f())
}
export const userWords = () => [...user].sort((a, b) => a.localeCompare(b))
export function addUserWord(w: string) { user.add(w); saveUser() }
export function removeUserWord(w: string) { user.delete(w); saveUser() }
export function onUserDictChange(f: () => void) { userListeners.add(f); return () => { userListeners.delete(f) } }
const inUser = (w: string) => user.has(w) || user.has(w.toLowerCase())

// ───────────── Greek helpers ─────────────

const GREEK = /[Ͱ-Ͽἀ-῿]/
const LATIN = /[A-Za-zÀ-ɏ]/
export const isGreek = (w: string) => GREEK.test(w)
export const isLatin = (w: string) => LATIN.test(w)

const TONOS: Record<string, string> = { α: 'ά', ε: 'έ', η: 'ή', ι: 'ί', ο: 'ό', υ: 'ύ', ω: 'ώ', ϊ: 'ΐ', ϋ: 'ΰ' }
/** Remove the tonos (keep the diaeresis): «καλημέρα» → «καλημερα». */
export const stripTonos = (w: string) => w.normalize('NFD').replace(/́/g, '').normalize('NFC')

/** The word unaccented and with a tonos on each vowel in turn. */
function accentVariants(base: string): string[] {
  const out = [base]
  for (let i = 0; i < base.length; i++) {
    const a = TONOS[base[i]]
    if (a) out.push(base.slice(0, i) + a + base.slice(i + 1))
  }
  return out
}

const syllables = (w: string) => {
  // vowel groups ≈ syllables (αι, ει, οι, ου, αυ, ευ, υι count once)
  // «ι» before another vowel is glided: «μια», «πιο», «γεια» are one syllable
  const m = stripTonos(w.toLowerCase()).match(/(ει[αοεω]|[ιυ]ου|[ιυ][αοεω]|αι|ει|οι|ου|αυ|ευ|υι|[αεηιουωϊϋ])/g)
  return m ? m.length : 0
}

const upperFirst = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
type CaseStyle = 'lower' | 'cap' | 'upper'
function caseOf(w: string): CaseStyle {
  if (w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase()) return 'upper'
  if (w[0] !== w[0].toLowerCase()) return 'cap'
  return 'lower'
}
function withCase(w: string, c: CaseStyle) {
  if (c === 'upper') return stripTonos(w).toUpperCase()
  if (c === 'cap') return upperFirst(w)
  return w
}

function greekHas(w: string): boolean {
  return !!el && (el.has(w) || inUser(w))
}

function greekKnown(word: string): boolean {
  if (greekHas(word)) return true
  const lower = word.toLowerCase()
  if (lower !== word && greekHas(lower)) return true
  // Capitals drop the accents («ΕΛΛΑΔΑ»): any accent placement that is a word counts.
  if (caseOf(word) === 'upper') {
    for (const v of accentVariants(stripTonos(lower))) if (greekHas(v) || greekHas(upperFirst(v))) return true
  }
  return false
}

// Vowel spellings with the same sound, and doubled consonants.
const SOUNDS: string[][] = [['ει', 'οι', 'υι', 'ι', 'η', 'υ'], ['αι', 'ε'], ['ο', 'ω'], ['γγ', 'γκ']]
const DOUBLE = 'βγκλμνπρστ'
const LETTERS = 'αβγδεζηθικλμνξοπρστυφχψωςϊϋ'

/** Spellings of the word that sound the same (bounded; the most useful for Greek typists). */
function phoneticVariants(base: string, limit = 1500): string[] {
  // Split into segments: a sound group, a doubled consonant, or a single letter.
  const segs: string[][] = []
  for (let i = 0; i < base.length;) {
    const two = base.slice(i, i + 2)
    const group = SOUNDS.find((g) => g.includes(two)) ?? (two.length === 2 && two[0] === two[1] && DOUBLE.includes(two[0]) ? [two, two[0]] : null)
    if (group && two.length === 2) { segs.push(group); i += 2; continue }
    const one = base[i]
    const g1 = SOUNDS.find((g) => g.includes(one))
    segs.push(g1 ?? [one]) // doubling a single consonant is left to edits1 (one insertion)
    i++
  }
  const out: string[] = []
  const walk = (k: number, acc: string) => {
    if (out.length >= limit) return
    if (k === segs.length) { out.push(acc); return }
    for (const s of segs[k]) walk(k + 1, acc + s)
  }
  walk(0, '')
  // final sigma only at the end
  return out.map((v) => v.replace(/σ$/, 'ς').replace(/ς(?=.)/g, 'σ'))
}

function edits1(w: string): string[] {
  const out: string[] = []
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i)
    const b = w.slice(i)
    if (b) out.push(a + b.slice(1))
    if (b.length > 1) out.push(a + b[1] + b[0] + b.slice(2))
    for (const c of LETTERS) {
      if (b) out.push(a + c + b.slice(1))
      out.push(a + c + b)
    }
  }
  return out
}

/** Levenshtein distance (small words only). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]
}

/** Most Greek words stress the penultimate syllable, then the last, then the antepenultimate. */
function stressPenalty(w: string): number {
  const groups = w.match(/(αι|ει|οι|ου|αυ|ευ|υι|άι|έι|όι|ού|αύ|εύ|υί|[αεηιουωάέήίόύώϊϋΐΰ])/g)
  if (!groups) return 0
  const k = groups.findIndex((g) => /[άέήίόύώΐΰ]/.test(g))
  if (k < 0) return 0.04
  const fromEnd = groups.length - 1 - k
  return fromEnd === 1 ? 0 : fromEnd === 0 ? 0.02 : 0.03
}

const SPLIT_COMMON = new Set('και το τα να θα σε με για από η ο οι τη την τον του της των στο στη στην στον στα δεν μη μην που ότι'.split(' '))

const suggestCache = new Map<string, string[]>()

function greekSuggest(word: string, max = 5): string[] {
  let hit = suggestCache.get(word)
  if (!hit) {
    hit = computeGreekSuggest(word, max)
    if (suggestCache.size > 2000) suggestCache.clear()
    suggestCache.set(word, hit)
  }
  return hit
}

function computeGreekSuggest(word: string, max: number): string[] {
  const style = caseOf(word)
  const lower = word.toLowerCase()
  const base = stripTonos(lower)
  const accentAt = lower.search(/[άέήίόύώΐΰ]/)
  const found = new Map<string, number>()
  const tryWord = (w: string, score: number) => {
    const cand = greekHas(w) ? w : style !== 'lower' && greekHas(upperFirst(w)) ? upperFirst(w) : null
    if (!cand || cand === lower) return
    // Proper names only when the user wrote a capital.
    if (style === 'lower' && cand !== w) return
    let s = score + distance(lower, cand) * 0.05 + stressPenalty(cand)
    if (accentAt >= 0 && cand.search(/[άέήίόύώΐΰ]/) === accentAt) s -= 0.05
    if (cand[0] !== lower[0] && stripTonos(cand[0]) !== base[0]) s += 0.3
    const prev = found.get(cand)
    if (prev == null || s < prev) found.set(cand, s)
  }
  const tryAccents = (w: string, score: number) => { for (const v of accentVariants(w)) tryWord(v, score) }

  // 1. only the accent is wrong / missing / superfluous
  tryAccents(base, 0)
  // 2. same sound, different spelling
  const ph = phoneticVariants(base)
  for (const v of ph) if (v !== base) tryAccents(v, 0.5)
  // 3. one letter missing, extra, swapped or wrong
  if (found.size < max) for (const v of edits1(base)) tryAccents(v, 1)
  // 4. two words run together («καιτο» → «και το»)
  for (let i = 1; i < lower.length; i++) {
    const a = lower.slice(0, i)
    const b = lower.slice(i)
    if ((a.length > 1 || 'οηήσ'.includes(a)) && b.length > 1 && greekKnown(a) && greekKnown(b)) found.set(`${a} ${b}`, SPLIT_COMMON.has(a) || SPLIT_COMMON.has(b) ? 0.8 : 1.1)
  }
  return [...found.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length)
    .slice(0, max)
    .map(([w]) => withCase(w, style === 'cap' && w[0] !== w[0].toLowerCase() ? 'lower' : style))
}

// Latin letters that look Greek (typed with the wrong keyboard layout mid-word).
const HOMOGLYPH: Record<string, string> = {
  A: 'Α', B: 'Β', E: 'Ε', Z: 'Ζ', H: 'Η', I: 'Ι', K: 'Κ', M: 'Μ', N: 'Ν', O: 'Ο', P: 'Ρ', T: 'Τ', Y: 'Υ', X: 'Χ',
  a: 'α', o: 'ο', i: 'ι', k: 'κ', x: 'χ', u: 'υ', p: 'ρ', v: 'ν', t: 'τ', n: 'η', y: 'γ',
}

// ───────────── public API ─────────────

export type SpellResult = { ok: true } | { ok: false; suggestions: string[]; reason: 'unknown' | 'mixed' | 'monoAccent' }

/** null = cannot tell yet (dictionary still loading) or not a checkable word. */
export function checkWord(word: string): SpellResult | null {
  if (inUser(word)) return { ok: true }
  const g = isGreek(word)
  const l = isLatin(word)
  if (g && l) {
    const fixed = [...word].map((c) => (LATIN.test(c) ? HOMOGLYPH[c] ?? c : c)).join('')
    if (el && !LATIN.test(fixed)) return { ok: false, suggestions: greekKnown(fixed) ? [fixed] : greekSuggest(fixed), reason: 'mixed' }
    return { ok: false, suggestions: [], reason: 'mixed' }
  }
  if (g) {
    if (!el) return null
    if (greekKnown(word)) return { ok: true }
    // Monosyllables take no accent («μιά», «πιό», «γιά»).
    const bare = stripTonos(word)
    if (bare !== word && syllables(word) === 1 && greekKnown(bare)) return { ok: false, suggestions: [bare], reason: 'monoAccent' }
    return { ok: false, suggestions: greekSuggest(word), reason: 'unknown' }
  }
  if (l) {
    if (!en) return null
    if (en.correct(word)) return { ok: true }
    return { ok: false, suggestions: en.suggest(word).slice(0, 5), reason: 'unknown' }
  }
  return null
}

/** Whether a Greek word is in the dictionary (for rules; false while loading). */
export const knownGreek = (w: string) => !!el && greekKnown(w)
