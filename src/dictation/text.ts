// Spoken text → document text. Engines hand over raw phrases ("γεια σου κόμμα τι κάνεις ερωτηματικό");
// this turns spoken punctuation commands into marks and joins the result to the text before the caret
// (spaces, no space before a full stop, capital at a sentence start) the way Word's Dictate does.
// Pure functions: no editor, no engine.

export type DictLang = 'el' | 'en'

/** One step to apply at the caret, in order. */
export type Op =
  | { type: 'text'; text: string; deleteBefore: number }
  | { type: 'line' }
  | { type: 'para' }
  | { type: 'stop' }

type Attach = 'left' | 'right' | 'both' | 'none'
type Cmd = { mark: string; attach: Attach } | { op: 'line' | 'para' | 'stop' }

// Phrases are matched on lower-cased words, longest first. Accents stay significant:
// «τελεία» is the full stop, «τέλεια» (perfectly) is a word.
const EL: [string, Cmd][] = [
  ['τελεία', { mark: '.', attach: 'left'}],
  ['κόμμα', { mark: ',', attach: 'left' }],
  ['ερωτηματικό', { mark: ';', attach: 'left'}],
  ['θαυμαστικό', { mark: '!', attach: 'left'}],
  ['άνω τελεία', { mark: '·', attach: 'left' }],
  ['άνω κάτω τελεία', { mark: ':', attach: 'left' }],
  ['άνω και κάτω τελεία', { mark: ':', attach: 'left' }],
  ['αποσιωπητικά', { mark: '…', attach: 'left' }],
  ['παύλα', { mark: '–', attach: 'none' }],
  ['ενωτικό', { mark: '-', attach: 'both' }],
  ['άνοιξε παρένθεση', { mark: '(', attach: 'right' }],
  ['άνοιγμα παρένθεσης', { mark: '(', attach: 'right' }],
  ['κλείσε παρένθεση', { mark: ')', attach: 'left' }],
  ['κλείσιμο παρένθεσης', { mark: ')', attach: 'left' }],
  ['άνοιξε εισαγωγικά', { mark: '«', attach: 'right' }],
  ['άνοιγμα εισαγωγικών', { mark: '«', attach: 'right' }],
  ['κλείσε εισαγωγικά', { mark: '»', attach: 'left' }],
  ['κλείσιμο εισαγωγικών', { mark: '»', attach: 'left' }],
  ['νέα γραμμή', { op: 'line' }],
  ['αλλαγή γραμμής', { op: 'line' }],
  ['νέα παράγραφος', { op: 'para' }],
  ['νέα παράγραφο', { op: 'para' }], // as the model often hears it
  ['αλλαγή παραγράφου', { op: 'para' }],
  ['τέλος υπαγόρευσης', { op: 'stop' }],
  ['διακοπή υπαγόρευσης', { op: 'stop' }],
  ['σταμάτα την υπαγόρευση', { op: 'stop' }],
]
const EN: [string, Cmd][] = [
  ['period', { mark: '.', attach: 'left'}],
  ['full stop', { mark: '.', attach: 'left'}],
  ['comma', { mark: ',', attach: 'left' }],
  ['question mark', { mark: '?', attach: 'left'}],
  ['exclamation mark', { mark: '!', attach: 'left'}],
  ['exclamation point', { mark: '!', attach: 'left'}],
  ['colon', { mark: ':', attach: 'left' }],
  ['semicolon', { mark: ';', attach: 'left' }],
  ['ellipsis', { mark: '…', attach: 'left' }],
  ['dash', { mark: '–', attach: 'none' }],
  ['hyphen', { mark: '-', attach: 'both' }],
  ['open parenthesis', { mark: '(', attach: 'right' }],
  ['close parenthesis', { mark: ')', attach: 'left' }],
  ['open quote', { mark: '“', attach: 'right' }],
  ['close quote', { mark: '”', attach: 'left' }],
  ['open quotes', { mark: '“', attach: 'right' }],
  ['close quotes', { mark: '”', attach: 'left' }],
  ['new line', { op: 'line' }],
  ['new paragraph', { op: 'para' }],
  ['stop dictation', { op: 'stop' }],
  ['stop dictating', { op: 'stop' }],
]

const bare = (w: string) => w.normalize('NFD').replace(/\p{M}/gu, '')
// An engine that drops an accent («ανοιξε») still gets the command, except where the bare form is a word too.
const EXACT_ONLY = new Set(['τελεία'])
const table = (list: [string, Cmd][]) => list
  .map(([p, c]) => ({ words: p.split(' '), bare: EXACT_ONLY.has(p) ? null : p.split(' ').map(bare), cmd: c }))
  .sort((a, b) => b.words.length - a.words.length)
const COMMANDS: Record<DictLang, ReturnType<typeof table>> = { el: table(EL), en: table(EN) }

/** Spoken forms for the help list (first form of each mark / action). */
export const COMMAND_HELP: Record<DictLang, [string, string][]> = {
  el: [['τελεία', '.'], ['κόμμα', ','], ['ερωτηματικό', ';'], ['θαυμαστικό', '!'], ['άνω τελεία', '·'], ['άνω κάτω τελεία', ':'],
    ['αποσιωπητικά', '…'], ['παύλα', '–'], ['άνοιξε / κλείσε παρένθεση', '( )'], ['άνοιξε / κλείσε εισαγωγικά', '« »'],
    ['νέα γραμμή', '↵'], ['νέα παράγραφος', '¶'], ['τέλος υπαγόρευσης', '■']],
  en: [['period', '.'], ['comma', ','], ['question mark', '?'], ['exclamation mark', '!'], ['colon', ':'], ['semicolon', ';'],
    ['ellipsis', '…'], ['dash', '–'], ['open / close parenthesis', '( )'], ['open / close quote', '“ ”'],
    ['new line', '↵'], ['new paragraph', '¶'], ['stop dictation', '■']],
}

export const norm = (w: string) =>
  w.normalize('NFC').toLocaleLowerCase('el').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/σ$/, 'ς')

type Piece = { kind: 'word'; text: string } | { kind: 'cmd'; cmd: Cmd }

function parse(raw: string, lang: DictLang): Piece[] {
  const toks = raw.replace(/;/g, ';').split(/\s+/).filter(Boolean)
  const keys = toks.map(norm)
  const out: Piece[] = []
  for (let i = 0; i < toks.length;) {
    const hit = COMMANDS[lang].find((c) => c.words.every((w, k) => keys[i + k] === w))
      ?? COMMANDS[lang].find((c) => c.bare?.every((w, k) => keys[i + k] != null && bare(keys[i + k]) === w))
    if (hit) {
      out.push({ kind: 'cmd', cmd: hit.cmd })
      i += hit.words.length
    } else {
      out.push({ kind: 'word', text: toks[i] })
      i++
    }
  }
  // A command word the engine punctuated itself ("κόμμα," / "τελεία.") must not leave its own mark behind.
  return out.map((p, i) => (p.kind === 'word' && i > 0 && out[i - 1].kind === 'cmd' && /^[.,;:!?·…]+$/.test(p.text) ? null : p)).filter(Boolean) as Piece[]
}

const OPENERS = /[\s([{«“‘"'\-/–]$/
const SENTENCE_END = (lang: DictLang) => (lang === 'el' ? /[.!;…?]["»”’)]*\s*$/ : /[.!?…]["»”’)]*\s*$/)

const capFirst = (s: string) => s.replace(/^([^\p{L}]*)(\p{Ll})/u, (_, a: string, b: string) => a + b.toLocaleUpperCase())
const stripPunct = (s: string) => s.replace(/[.,;:!?·…]+(?=\s|$)/g, '')

export interface RenderOpts {
  lang: DictLang
  /** false: drop the engine's own punctuation, keep only spoken commands (Word: "Auto-punctuation" off). */
  autoPunct: boolean
}

/**
 * Turn one recognised phrase into caret operations, given the paragraph text before the caret.
 * `deleteBefore` removes spaces the caret sits after when a mark must hug the previous word.
 */
export function render(raw: string, before: string, o: RenderOpts): Op[] {
  const ops: Op[] = []
  let ctx = before // text before the caret in the current paragraph, as it will be
  let buf = ''
  let del = 0
  const flush = () => { if (buf || del) ops.push({ type: 'text', text: buf, deleteBefore: del }); buf = ''; del = 0 }
  const tail = () => ctx + buf
  const atStart = () => !tail().trim() || SENTENCE_END(o.lang).test(tail())
  const addWord = (w: string, attach: Attach) => {
    const t = tail()
    const needSpace = t.length > 0 && !OPENERS.test(t) && attach !== 'left' && attach !== 'both'
    if ((attach === 'left' || attach === 'both') && /\s$/.test(t)) {
      const sp = t.length - t.trimEnd().length
      const own = Math.min(sp, buf.length - buf.trimEnd().length)
      buf = buf.slice(0, buf.length - own)
      if (sp > own) { del += sp - own; ctx = ctx.slice(0, ctx.length - (sp - own)) }
    }
    buf += (needSpace ? ' ' : '') + w
  }
  for (const p of parse(raw, o.lang)) {
    if (p.kind === 'word') {
      let w = o.autoPunct ? p.text : stripPunct(p.text)
      if (!w) continue
      if (atStart()) w = capFirst(w)
      // Engine punctuation that belongs to the previous word ("γεια , σου") hugs it.
      addWord(w, /^[.,;:!?·…)»”]/.test(w) ? 'left' : 'none')
    } else if ('mark' in p.cmd) {
      addWord(p.cmd.mark, p.cmd.attach)
    } else if (p.cmd.op === 'stop') {
      flush(); ops.push({ type: 'stop' }); break
    } else {
      buf = buf.trimEnd()
      flush()
      ops.push({ type: p.cmd.op })
      ctx = ''
    }
  }
  flush()
  return ops
}

/** Plain-text preview of what `render` would insert (for the grey in-progress text). */
export function preview(raw: string, before: string, o: RenderOpts): string {
  return render(raw, before, o).map((op) => (op.type === 'text' ? op.text : op.type === 'stop' ? '' : ' ¶ ')).join('')
}

// Phrases Whisper is known to invent on silence or noise (subtitle credits it was trained on).
const HALLUCINATIONS = [
  /υπ[οό]τιτλ/i, /ευχαριστ[ωώ] (πολ[υύ] )?(για την παρακολο[υύ]θηση|που (με )?παρακολο[υύ]θησατε)/i, /ευχαριστο[υύ]με (πολ[υύ] )?για την παρακολο[υύ]θηση/i,
  /thank(s| you) (so much )?for watching/i, /subtitles by/i, /amara\.org/i, /^\W*(\[|\()[^\])]*(\]|\))\W*$/,
]

/** Drop invented or degenerate engine output (on-device models only). */
export function cleanTranscript(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim()
  if (!t || HALLUCINATIONS.some((r) => r.test(t))) return ''
  // "λέξη λέξη λέξη λέξη…" loops: keep one copy of any run of up to six words repeated 4+ times.
  t = t.replace(/((?:\S+\s+){0,5}\S+)(?:\s+\1){3,}/gu, '$1')
  return t
}
