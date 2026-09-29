// Checks one paragraph of plain text: spelling (via the dictionaries) and a set of grammar,
// punctuation and style rules for Greek and English. Offsets are UTF-16 indices into the text.
// Every rule is local and deterministic, so results can be cached per paragraph text.
import { checkWord, isGreek, isLatin, knownGreek, stripTonos } from './dictionary'

export type IssueKind = 'spelling' | 'grammar' | 'punct' | 'style'

export interface TextIssue {
  start: number
  end: number
  kind: IssueKind
  /** rule id → i18n keys `pf.r.<rule>` (title) and `pf.r.<rule>.d` (explanation) */
  rule: string
  sugg: string[]
  /** mechanical, unambiguous fix — included in "Fix all" */
  safe?: boolean
  /** free-text explanation instead of the i18n one */
  msg?: string
  title?: string
}

export interface CheckOptions { heading?: boolean }

const L = '\\p{L}\\p{M}'
const WORD = new RegExp(`[${L}]+(?:['’][${L}]+)*['’]?`, 'gu')
const URLISH = /\b(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\b[\w-]+\.(?:com|gr|org|net|eu|io|edu|gov)\b\S*/gi

interface Tok { w: string; s: number; e: number }

function tokens(text: string): Tok[] {
  const out: Tok[] = []
  WORD.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD.exec(text))) out.push({ w: m[0], s: m.index, e: m.index + m[0].length })
  return out
}

const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase()
const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase()

// ───────────── spelling ─────────────

function spelling(text: string, toks: Tok[], skip: (s: number, e: number) => boolean, out: TextIssue[]) {
  for (const t of toks) {
    let { w, s, e } = t
    if (skip(s, e)) continue
    const before = text[s - 1] ?? ''
    const after = text[e] ?? ''
    // numbers, paths, handles, identifiers: «10ος», «a/b», «@name», «file_name»
    if (/[\d_/\\@#]/.test(before) || /[\d_/\\@#]/.test(after)) continue
    // abbreviations and initials: «π.χ.», «κ.λπ.», «σελ.», «Γ. Παπαδόπουλος», «e.g.»
    if (after === '.' && (before === '.' || /\p{L}/u.test(text[e + 1] ?? '') || w.length <= 2 || ABBR.has(w.toLowerCase()))) continue
    if (/^[οό]$/i.test(w) && /^,\s?τι/i.test(text.slice(e, e + 4))) continue // «ό,τι»
    if (after === '-' && /\p{L}/u.test(text[e + 1] ?? '') && w.length <= 5) continue // prefixes: «υπο-», «αντι-», «non-»
    // elision «σ’», «γι’», «απ’» — check the word without the apostrophe
    if (/['’]$/.test(w)) { w = w.slice(0, -1); e-- }
    const latin = isLatin(w) && !isGreek(w)
    if (latin) {
      if (w.length < 2) continue
      // acronyms, Roman numerals, camelCase / brand names («iPhone»)
      if ((w === w.toUpperCase() && w.length <= 6) || /[a-z][A-Z]/.test(w)) continue
    } else if (isGreek(w) && !isLatin(w)) {
      if (w === w.toUpperCase() && w.length <= 5 && w.length > 1) continue // ΔΕΗ, ΟΤΕ, ΑΕ
    }
    // Greek elision inside a token («σ'αγαπώ»): check each part.
    const parts = isGreek(w) && /['’]/.test(w) ? splitParts(w, s) : [{ w, s, e }]
    for (const p of parts) {
      const r = checkWord(p.w)
      if (!r || r.ok) continue
      const rule = r.reason === 'mixed' ? 'mixed' : r.reason === 'monoAccent' ? 'monoAccent' : 'spelling'
      out.push({ start: p.s, end: p.e, kind: 'spelling', rule, sugg: r.suggestions, safe: r.reason === 'monoAccent' || (r.reason === 'mixed' && r.suggestions.length === 1) })
    }
  }
}

function splitParts(w: string, s: number) {
  const out: Tok[] = []
  let off = 0
  for (const part of w.split(/['’]/)) {
    if (part) out.push({ w: part, s: s + off, e: s + off + part.length })
    off += part.length + 1
  }
  return out
}

// ───────────── grammar, punctuation, style ─────────────

type Push = (i: TextIssue) => void

/** Regex rule helper: every match becomes an issue; `fix` returns the replacement (or null to skip). */
function each(text: string, re: RegExp, fn: (m: RegExpExecArray) => void) {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    fn(m)
    if (m[0].length === 0) re.lastIndex++
  }
}

const B = `(?<![${L}])`
const E = `(?![${L}])`
const matchCase = (src: string, repl: string) => (src && isUpper(src[0]) ? repl.charAt(0).toUpperCase() + repl.slice(1) : repl)

// Final -ν (Γραμματική Τριανταφυλλίδη): kept before a vowel and κ π τ ξ ψ γκ μπ ντ τσ τζ.
function keepsN(next: string) {
  const w = stripTonos(next.toLowerCase())
  return /^[αεηιουωϊϋ]/.test(w) || /^[κπτξψ]/.test(w) || /^(γκ|μπ|ντ|τσ|τζ)/.test(w)
}

function finalN(text: string, toks: Tok[], push: Push) {
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i]
    const b = toks[i + 1]
    if (!/^ +$/.test(text.slice(a.e, b.s)) || !isGreek(b.w)) continue
    const w = a.w.toLowerCase()
    const keep = keepsN(b.w)
    if ((w === 'την' || w === 'στην') && !keep) {
      push({ start: a.s, end: a.e, kind: 'grammar', rule: 'finalNDrop', sugg: [a.w.slice(0, -1)], safe: true })
    } else if ((w === 'τη' || w === 'στη' || w === 'δε') && keep) {
      push({ start: a.s, end: a.e, kind: 'grammar', rule: 'finalNAdd', sugg: [a.w + (isUpper(a.w.slice(-1)) ? 'Ν' : 'ν')], safe: true })
    }
  }
}

const GR_FUNCTION = new Set(('ο η το οι τα τον την τη του της των τους τις ένας μια μία ένα και κι να θα σε στο στη στην στον στα στις στους με για από ως ' +
  'που πού ότι δεν δε μη μην ή αν ενώ αλλά όμως μου σου μας σας τον τους είναι ήταν').split(' '))
const EN_REPEAT_OK = new Set(['that', 'had', 'is', 'very', 'bye', 'no', 'so', 'ha', 'la'])

function repeated(text: string, toks: Tok[], push: Push) {
  for (let i = 1; i < toks.length; i++) {
    const a = toks[i - 1]
    const b = toks[i]
    if (a.w.toLowerCase() !== b.w.toLowerCase() || !/^\s+$/.test(text.slice(a.e, b.s))) continue
    const lw = a.w.toLowerCase()
    const flag = isGreek(lw) ? GR_FUNCTION.has(lw) : isLatin(lw) && !EN_REPEAT_OK.has(lw)
    if (flag) push({ start: a.e, end: b.e, kind: 'grammar', rule: 'repeated', sugg: [''], safe: true })
  }
}

const ABBR = new Set(('δηλ κτλ λπ βλ πρβλ σελ σσ αρ αριθ παρ κεφ τηλ οδ κα κκ χλμ εκατ δισ εκδ μτφ επιμ συγγρ τομ περ σημ υπ υπουργ καθ ηθοπ ' +
  'etc vs approx dept fig no mr mrs ms dr st jr sr prof inc ltd co corp jan feb mar apr jun jul aug sep sept oct nov dec').split(' '))

/** Abbreviation right before a full stop («π.χ.», «κ.λπ.», «e.g.», «Dr.») — the next word may be lowercase. */
function abbrevBefore(text: string, dot: number) {
  const m = /([\p{L}.]+)\.$/u.exec(text.slice(Math.max(0, dot - 12), dot + 1))
  if (!m) return false
  const w = m[1]
  return w.includes('.') || ABBR.has(w.toLowerCase()) || (w.length <= 3 && isGreek(w) && !knownGreek(w)) || (w.length === 1 && isUpper(w))
}

function punctuation(text: string, toks: Tok[], opt: CheckOptions, push: Push) {
  const greekText = toks.filter((t) => isGreek(t.w)).length >= Math.max(1, toks.length / 3)

  // two or more spaces between words
  each(text, /(?<=\S) {2,}(?=\S)/g, (m) => /^[\d.]+$/.test(text.slice(0, m.index)) || push({ start: m.index, end: m.index + m[0].length, kind: 'punct', rule: 'doubleSpace', sugg: [' '], safe: true }))

  // space before , . ; : ! ? · (not before an ellipsis)
  each(text, new RegExp(`(?<=[${L}\\p{N}»)\\]]) +(?=[,.;:!?](?!\\.\\.)|·(?! ))`, 'gu'), (m) =>
    push({ start: m.index, end: m.index + m[0].length, kind: 'punct', rule: 'spaceBefore', sugg: [''], safe: true }))

  // missing space after , ; : ! ? ·   and after a full stop between two sentences
  each(text, new RegExp(`(?<=[${L}])([,;:!?·])(?=[${L}])`, 'gu'), (m) => {
    if (m[1] === ',' && /^[οό],τι/i.test(text.slice(m.index - 1, m.index + 3))) return // «ό,τι»
    push({ start: m.index, end: m.index + 1, kind: 'punct', rule: 'spaceAfter', sugg: [`${m[1]} `], safe: true })
  })
  each(text, new RegExp(`(?<=[\\p{Ll}]{3})\\.(?=\\p{Lu}\\p{Ll})`, 'gu'), (m) =>
    push({ start: m.index, end: m.index + 1, kind: 'punct', rule: 'spaceAfter', sugg: ['. '], safe: true }))

  // doubled punctuation ,,  ;;  ::  ..  (an ellipsis is fine)
  each(text, /([,;:])\1+|(?<!\.)\.\.(?!\.)/g, (m) =>
    push({ start: m.index, end: m.index + m[0].length, kind: 'punct', rule: 'doublePunct', sugg: [m[0][0]], safe: true }))

  // spaces just inside brackets / guillemets
  each(text, /([(\[«]) +/g, (m) => push({ start: m.index + 1, end: m.index + m[0].length, kind: 'punct', rule: 'spaceInside', sugg: [''], safe: true }))
  each(text, new RegExp(`(?<=[${L}\\p{N}.!?;]) +([)\\]»])`, 'gu'), (m) =>
    push({ start: m.index, end: m.index + m[0].length - 1, kind: 'punct', rule: 'spaceInside', sugg: [''], safe: true }))

  // unbalanced brackets / guillemets
  for (const [o, c] of [['(', ')'], ['«', '»']] as const) {
    const stack: number[] = []
    const orphans: number[] = []
    for (let i = 0; i < text.length; i++) {
      if (text[i] === o) stack.push(i)
      else if (text[i] === c) {
        if (stack.length) stack.pop()
        // list labels «α)» «1)» and smileys «:)» are not missing a bracket
        else if (!(c === ')' && (/^\s*[\p{L}\p{N}]{1,2}\)$/u.test(text.slice(0, i + 1)) || /[:;]-?$/.test(text.slice(Math.max(0, i - 2), i))))) orphans.push(i)
      }
    }
    for (const i of [...stack, ...orphans]) push({ start: i, end: i + 1, kind: 'punct', rule: 'unbalanced', sugg: [] })
  }

  if (greekText) {
    // Greek question mark is «;»
    each(text, new RegExp(`(?<=[\\u0370-\\u03ff\\u1f00-\\u1fff][${L}]*\\s?)\\?`, 'gu'), (m) => {
      const q = m.index + m[0].length - 1
      push({ start: q, end: q + 1, kind: 'punct', rule: 'greekQuestion', sugg: [';'], safe: true })
    })
    // "…" → «…» in Greek text
    each(text, /(["“”„])([^"“”„«»]{1,200}?)(["“”])/g, (m) => {
      if (!isGreek(m[2])) return
      push({ start: m.index, end: m.index + m[0].length, kind: 'style', rule: 'greekQuotes', sugg: [`«${m[2]}»`], safe: true })
    })
    // elision needs a space: «σ'αυτό» → «σ’ αυτό»
    each(text, new RegExp(`${B}(σ|μ|τ|ν|θ|γι|απ|κατ|μετ|παρ|υπ|επ|αφ|εφ|καθ|μεθ|υφ)(['’΄])(?=[\\u0370-\\u03ff\\u1f00-\\u1fff])`, 'giu'), (m) =>
      push({ start: m.index, end: m.index + m[0].length, kind: 'punct', rule: 'elisionSpace', sugg: [`${m[1]}’ `], safe: true }))
  }

  // sentence starts with a capital
  if (!opt.heading) {
    const enders = greekText ? /[.!;?…]/ : /[.!?…]/
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (!isLower(t.w[0])) continue
      const gap = text.slice(i ? toks[i - 1].e : 0, t.s)
      let start = false
      if (i === 0) {
        // a whole sentence written as a paragraph («εδώ είναι το κείμενο.»)
        start = !gap.trim() && toks.length >= 4 && /[.!;?]["»”')]*\s*$/.test(text)
      } else {
        const m = /([.!;?…]+)["»”')\]]*\s+$/.exec(gap)
        if (m && enders.test(m[1]) && !(m[1] === '.' && abbrevBefore(text, text.lastIndexOf('.', t.s))) && m[1] !== '…' && m[1] !== '...') start = true
      }
      if (start) {
        const cap = t.w.charAt(0).toUpperCase() + t.w.slice(1)
        push({ start: t.s, end: t.e, kind: 'grammar', rule: 'capital', sugg: [cap], safe: true })
      }
    }
  }
}

interface Phrase { re: RegExp; kind: IssueKind; rule: string; fix: (m: RegExpExecArray) => string; safe?: boolean; lang: 'el' | 'en' }
const ph = (lang: 'el' | 'en', src: string, kind: IssueKind, rule: string, fix: Phrase['fix'], safe = false): Phrase =>
  ({ re: new RegExp(`${B}${src}${E}`, 'giu'), kind, rule, fix, safe, lang })

const PHRASES: Phrase[] = [
  // Greek
  ph('el', `(απ)(['’΄]\\s?)ότι`, 'grammar', 'otiComma', (m) => matchCase(m[1], 'απ’ ό,τι'), true),
  ph('el', `ότι (και να|κι αν|και αν|κι αν)`, 'grammar', 'otiComma', (m) => matchCase(m[0], `ό,τι ${m[1]}`), true),
  ph('el', `κάθε (ένας|ενός|έναν|ένα|μία|μια|μιας)`, 'grammar', 'kathenas', (m) => matchCase(m[0], { ένας: 'καθένας', ενός: 'καθενός', έναν: 'καθέναν', ένα: 'καθένα', μία: 'καθεμία', μια: 'καθεμιά', μιας: 'καθεμιάς' }[m[1].toLowerCase()]!), true),
  ph('el', `παρόλα (αυτά)`, 'grammar', 'parola', (m) => matchCase(m[0], `παρ’ όλα ${m[1]}`), true),
  ph('el', `εν τάξει`, 'spelling', 'phrase', (m) => matchCase(m[0], 'εντάξει'), true),
  ph('el', `γιαυτό`, 'spelling', 'phrase', (m) => matchCase(m[0], 'γι’ αυτό'), true),
  ph('el', `(?:κ\\.λ\\.π\\.?|κλπ\\.?|κ\\.λπ(?!\\.))`, 'style', 'klp', () => 'κ.λπ.', true),
  ph('el', `πιο (καλύτερ|χειρότερ|μεγαλύτερ|μικρότερ|ανώτερ|κατώτερ|ψηλότερ)([${L}]*)`, 'grammar', 'pleonasmComparative', (m) => m[1] + m[2]),
  ph('el', `(ανεβ[${L}]*) (πάνω)`, 'style', 'pleonasm', (m) => m[1]),
  ph('el', `(κατεβ[${L}]*) (κάτω)`, 'style', 'pleonasm', (m) => m[1]),
  ph('el', `(επαναλ[${L}]*) (ξανά)`, 'style', 'pleonasm', (m) => m[1]),
  ph('el', `(προχωρ[${L}]*) (μπροστά)`, 'style', 'pleonasm', (m) => m[1]),
  // English
  ph('en', `(could|should|would|must|might) of`, 'grammar', 'couldOf', (m) => `${m[1]} have`, true),
  ph('en', `(more|less|better|worse|rather|other|greater|larger|smaller|higher|lower|faster|older|younger) then`, 'grammar', 'thenThan', (m) => `${m[1]} than`, true),
  ph('en', `your welcome`, 'grammar', 'yourWelcome', (m) => matchCase(m[0], 'you’re welcome'), true),
  ph('en', `its (a|an|the|not|been|going|time)`, 'grammar', 'itsIts', (m) => matchCase(m[0], `it’s ${m[1]}`)),
  ph('en', `alot`, 'spelling', 'phrase', (m) => matchCase(m[0], 'a lot'), true),
  ph('en', `i`, 'grammar', 'englishI', () => 'I', true),
]

function phrases(text: string, push: Push, hasGreek: boolean, hasLatin: boolean) {
  for (const p of PHRASES) {
    if ((p.lang === 'el' && !hasGreek) || (p.lang === 'en' && !hasLatin)) continue
    each(text, p.re, (m) => {
      if (p.rule === 'englishI' && (m[0] !== 'i' || !/[A-Za-z]{2}/.test(text.slice(Math.max(0, m.index - 20), m.index + 20)) || /['’.]/.test(text[m.index + 1] ?? '') || /['’.]/.test(text[m.index - 1] ?? ''))) return
      const r = p.fix(m)
      if (r == null || r === m[0]) return
      push({ start: m.index, end: m.index + m[0].length, kind: p.kind, rule: p.rule, sugg: [r], safe: p.safe })
    })
  }
}

function articles(text: string, toks: Tok[], push: Push) {
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i]
    const b = toks[i + 1]
    const w = a.w.toLowerCase()
    if ((w !== 'a' && w !== 'an') || text.slice(a.e, b.s) !== ' ' || !isLatin(b.w)) continue
    const n = b.w.toLowerCase()
    if (/^[A-Z]{2,}/.test(b.w)) continue // acronyms: «an FBI agent», «a NATO»
    const vowelSound = /^(hour|honest|honou?r|heir)/.test(n) || (/^[aeiou]/.test(n) && !/^(one|once|uni|use|usu|uti|ura|ure|uro|eu|ewe|ubiq)/.test(n))
    if (w === 'a' && vowelSound) push({ start: a.s, end: a.e, kind: 'grammar', rule: 'aAn', sugg: [matchCase(a.w, 'an')] })
    if (w === 'an' && !vowelSound) push({ start: a.s, end: a.e, kind: 'grammar', rule: 'aAn', sugg: [matchCase(a.w, 'a')] })
  }
}

function longSentences(text: string, push: Push) {
  const re = /[^.!;?…]+[.!;?…]*/g
  each(text, re, (m) => {
    const words = m[0].match(/[\p{L}\p{N}]+/gu)?.length ?? 0
    if (words > 45) {
      const lead = m[0].length - m[0].trimStart().length
      push({ start: m.index + lead, end: m.index + m[0].trimEnd().length, kind: 'style', rule: 'longSentence', sugg: [] })
    }
  })
}

/** All issues of one paragraph, sorted, without overlaps (the more important one wins). */
export function checkText(text: string, opt: CheckOptions = {}, skipRanges: [number, number][] = []): TextIssue[] {
  if (!/[\p{L}]/u.test(text)) return []
  const urls: [number, number][] = [...skipRanges]
  each(text, URLISH, (m) => urls.push([m.index, m.index + m[0].length]))
  const skip = (s: number, e: number) => urls.some(([a, b]) => s < b && e > a)

  const out: TextIssue[] = []
  const push: Push = (i) => { if (!skip(i.start, i.end)) out.push(i) }
  const toks = tokens(text)
  const hasGreek = isGreek(text)
  const hasLatin = /[A-Za-z]/.test(text)

  spelling(text, toks, skip, out)
  phrases(text, push, hasGreek, hasLatin)
  if (hasGreek) finalN(text, toks, push)
  if (hasLatin) articles(text, toks, push)
  repeated(text, toks, push)
  punctuation(text, toks, opt, push)
  if (!opt.heading) longSentences(text, push)

  const rank: Record<IssueKind, number> = { spelling: 0, grammar: 1, punct: 2, style: 3 }
  out.sort((a, b) => a.start - b.start || rank[a.kind] - rank[b.kind] || (b.end - b.start) - (a.end - a.start))
  const kept: TextIssue[] = []
  for (const i of out) {
    // a long-sentence hint may contain other issues; everything else must not overlap
    const clash = kept.find((k) => k.rule !== 'longSentence' && i.rule !== 'longSentence' && i.start < k.end && i.end > k.start)
    if (clash) {
      // a phrase rule beats a plain unknown-word flag on the same span («εν τάξει», «alot»)
      if (clash.rule === 'spelling' && i.rule !== 'spelling' && i.start <= clash.start && i.end >= clash.end) kept.splice(kept.indexOf(clash), 1, i)
      continue
    }
    kept.push(i)
  }
  return kept.sort((a, b) => a.start - b.start)
}
