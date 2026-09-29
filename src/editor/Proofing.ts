// Proofing: spelling, grammar, punctuation and style as you type (Review ▸ Editor in Word).
// Paragraphs are checked after a short pause; results are cached per paragraph text, so only
// edited paragraphs cost anything. Issues are underlined with decorations (never printed) and
// listed in the side panel (ui/ProofPanel.tsx).
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { checkText, type TextIssue, type IssueKind } from '../proofing/rules'
import { addUserWord, dictReady, loadEnglish, loadGreek, onUserDictChange } from '../proofing/dictionary'

export type { IssueKind }

export interface Issue extends Omit<TextIssue, 'start' | 'end'> {
  /** stable across edits elsewhere: rule | text | occurrence */
  id: string
  from: number
  to: number
  text: string
  /** paragraph text around the issue, for the panel's preview */
  before: string
  after: string
}

export interface ProofState {
  issues: Issue[]
  active: string | null
  hover: string | null
  status: 'idle' | 'loading' | 'ready'
  /** caret position right after the last edit — the word being typed is not flagged yet */
  typedAt: number
}

export const proofKey = new PluginKey<ProofState>('proofing')

// ───────────── settings (per device) & runtime switches ─────────────

export interface ProofConfig { live: boolean }
const CONFIG_KEY = 'grafi:proofing'
const readConfig = (): ProofConfig => {
  try { return { live: JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').live ?? true } } catch { return { live: true } }
}
let config = readConfig()
let panelOpen = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((f) => f())

export const proofConfig = () => config
export function setProofConfig(c: Partial<ProofConfig>) {
  config = { ...config, ...c }
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)) } catch { /* private mode */ }
  notify()
}
export function setProofPanelOpen(open: boolean) {
  if (open === panelOpen) return
  panelOpen = open
  notify()
}
const running = () => config.live || panelOpen

// Ignored for this session («Ignore all»): rule|text.
const ignored = new Set<string>()
const ignoreKey = (i: { rule: string; text: string }) => `${i.rule === 'spelling' || i.rule === 'mixed' ? 'spelling' : i.rule}|${i.text}`

// ───────────── collecting paragraphs ─────────────

interface Block { text: string; heading: boolean; skip: [number, number][]; segs: [number, number][] }

function collect(doc: PMNode): Block[] {
  const out: Block[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock' || node.type.name === 'tableOfContents') return false
    if (!node.isTextblock) return true
    let text = ''
    const segs: [number, number][] = []
    const skip: [number, number][] = []
    node.forEach((child, offset) => {
      segs.push([text.length, pos + 1 + offset])
      if (child.isText) {
        const s = child.text!
        if (child.marks.some((m) => m.type.name === 'code')) skip.push([text.length, text.length + s.length])
        text += s
      } else {
        text += child.type.name === 'hardBreak' ? '\n' : '￼'
      }
    })
    if (text.trim()) out.push({ text, heading: node.type.name === 'heading', skip, segs })
    return false
  })
  return out
}

function posOf(b: Block, off: number) {
  let seg = b.segs[0]
  for (const s of b.segs) { if (s[0] <= off) seg = s; else break }
  return seg[1] + (off - seg[0])
}

const localCache = new Map<string, TextIssue[]>()

function localIssues(b: Block): TextIssue[] {
  const key = `${b.heading ? 'h' : 'p'}${JSON.stringify(b.skip)}\u0001${b.text}`
  let hit = localCache.get(key)
  if (!hit) {
    hit = checkText(b.text, { heading: b.heading }, b.skip)
    if (localCache.size > 8000) localCache.clear()
    localCache.set(key, hit)
  }
  return hit
}

function computeIssues(doc: PMNode): Issue[] {
  const issues: Issue[] = []
  const seen = new Map<string, number>()
  const blocks = collect(doc)
  for (const b of blocks) {
    const list = localIssues(b)
    for (const i of list) {
      const text = b.text.slice(i.start, i.end)
      if (ignored.has(ignoreKey({ rule: i.rule, text }))) continue
      const base = `${i.rule}|${text}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      issues.push({
        ...i, id: `${base}|${n}`, from: posOf(b, i.start), to: posOf(b, i.end), text,
        before: b.text.slice(Math.max(0, i.start - 40), i.start), after: b.text.slice(i.end, i.end + 40),
      })
    }
  }
  return issues
}

// ───────────── plugin ─────────────

type Meta = Partial<Pick<ProofState, 'issues' | 'active' | 'hover' | 'status'>> & { fix?: boolean }

/** Document ranges touched by the transaction, in the new document's coordinates. */
function changedRanges(tr: Transaction): [number, number][] {
  const maps = tr.mapping.maps
  const out: [number, number][] = []
  maps.forEach((m, i) => m.forEach((_a, _b, start, end) => {
    let s = start
    let e = end
    for (let j = i + 1; j < maps.length; j++) { s = maps[j].map(s, -1); e = maps[j].map(e, 1) }
    out.push([s, e])
  }))
  return out
}

let decoCache: { key: string; issues: Issue[]; doc: PMNode; set: DecorationSet } | null = null

function decorations(state: EditorState): DecorationSet {
  const st = proofKey.getState(state)
  if (!st || !running() || !st.issues.length) return DecorationSet.empty
  const head = state.selection.empty ? state.selection.head : -1
  const hidden = st.typedAt === head ? head : -1
  const key = `${st.active}|${st.hover}|${hidden}|${config.live}|${panelOpen}`
  if (decoCache && decoCache.key === key && decoCache.issues === st.issues && decoCache.doc === state.doc) return decoCache.set
  const decos: Decoration[] = []
  for (const i of st.issues) {
    if (i.to <= i.from) continue
    if (hidden >= 0 && i.kind === 'spelling' && i.to === hidden) continue
    // With underlines off, only the issue selected in the panel is shown.
    if (!config.live && i.id !== st.active) continue
    const cls = `pf pf-${i.kind}${i.id === st.active ? ' pf-on' : ''}${i.id === st.hover ? ' pf-hl' : ''}${/^\s+$/.test(i.text) ? ' pf-ws' : ''}`
    decos.push(Decoration.inline(i.from, i.to, { class: cls, 'data-pf': i.id }, { id: i.id }))
  }
  const set = DecorationSet.create(state.doc, decos)
  decoCache = { key, issues: st.issues, doc: state.doc, set }
  return set
}

export const Proofing = Extension.create({
  name: 'proofing',
  addProseMirrorPlugins() {
    return [
      new Plugin<ProofState>({
        key: proofKey,
        state: {
          init: () => ({ issues: [], active: null, hover: null, status: 'idle', typedAt: -1 }),
          apply(tr, prev) {
            const meta = tr.getMeta(proofKey) as Meta | undefined
            let next = prev
            if (tr.docChanged) {
              const touched = changedRanges(tr)
              const issues: Issue[] = []
              for (const i of prev.issues) {
                const from = tr.mapping.map(i.from, 1)
                const to = tr.mapping.map(i.to, -1)
                if (to <= from || touched.some(([a, b]) => from <= b && to >= a)) continue
                issues.push(from === i.from && to === i.to ? i : { ...i, from, to })
              }
              next = { ...prev, issues, typedAt: meta?.fix ? -1 : tr.selection.head }
            }
            if (meta) {
              const { fix: _f, ...rest } = meta
              next = { ...next, ...rest }
              if (next.active && !next.issues.some((i) => i.id === next.active)) next = { ...next, active: null }
            }
            return next
          },
        },
        props: { decorations },
        view(view) {
          let timer = 0
          let seq = 0
          const set = (m: Meta) => { if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(proofKey, m).setMeta('addToHistory', false)) }
          const run = async () => {
            const my = ++seq
            if (!running() || view.isDestroyed) return
            const st = proofKey.getState(view.state)!
            // An empty document never pays for loading the dictionaries.
            if (!/\p{L}/u.test(view.state.doc.textContent)) { if (st.issues.length || st.status !== 'ready') set({ issues: [], status: 'ready' }); return }
            if (!dictReady.el()) {
              if (st.status !== 'loading') set({ status: 'loading' })
              await loadGreek()
            }
            if (!dictReady.en() && /[A-Za-z]{2}/.test(view.state.doc.textContent)) await loadEnglish()
            if (my !== seq || view.isDestroyed) return
            set({ issues: computeIssues(view.state.doc), status: 'ready' })
          }
          const schedule = (ms: number) => { clearTimeout(timer); timer = window.setTimeout(run, ms) }
          const refresh = () => {
            if (!running()) { clearTimeout(timer); if (proofKey.getState(view.state)?.issues.length) set({ issues: [], active: null, hover: null }); return }
            schedule(0)
          }
          const offCfg = (listeners.add(refresh), () => listeners.delete(refresh))
          const offDict = onUserDictChange(() => { localCache.clear(); schedule(0) })
          schedule(300)
          return {
            update(v, prevState) {
              if (v.state.doc !== prevState.doc) schedule(proofKey.getState(v.state)?.typedAt === -1 ? 60 : 450)
            },
            destroy() { clearTimeout(timer); offCfg(); offDict() },
          }
        },
      }),
    ]
  },
})

// ───────────── actions (panel, popover) ─────────────

export const getProof = (state: EditorState) => proofKey.getState(state)!

export function setActiveIssue(view: EditorView, id: string | null, reveal = false) {
  view.dispatch(view.state.tr.setMeta(proofKey, { active: id } as Meta).setMeta('addToHistory', false))
  if (reveal && id) {
    const i = getProof(view.state).issues.find((x) => x.id === id)
    if (i) revealPos(view, i.from)
  }
}

export function setHoverIssue(view: EditorView, id: string | null) {
  if (getProof(view.state).hover === id) return
  view.dispatch(view.state.tr.setMeta(proofKey, { hover: id } as Meta).setMeta('addToHistory', false))
}

/** Scrolls the page canvas so the position is comfortably visible (without moving the caret). */
export function revealPos(view: EditorView, pos: number) {
  try {
    const c = view.coordsAtPos(pos)
    const sc = view.dom.closest('.canvas-scroll') as HTMLElement | null
    if (!sc) return
    const r = sc.getBoundingClientRect()
    // on phones the panel is a bottom sheet over the page: only the part above it is visible
    const sheet = document.querySelector('.proof-panel') as HTMLElement | null
    const bottom = sheet && getComputedStyle(sheet).position === 'fixed' ? Math.min(r.bottom, sheet.getBoundingClientRect().top) : r.bottom
    if (c.top < r.top + 60 || c.bottom > bottom - 60) sc.scrollBy({ top: c.top - r.top - (bottom - r.top) / 3, behavior: 'smooth' })
  } catch { /* position not rendered */ }
}

/** Replaces the flagged text; returns false when the document no longer matches. */
export function applyIssue(view: EditorView, issue: Issue, replacement: string): boolean {
  const { state } = view
  if (state.doc.textBetween(issue.from, issue.to, '\n', '￼') !== issue.text) return false
  const tr = state.tr
  if (replacement) tr.insertText(replacement, issue.from, issue.to)
  else tr.delete(issue.from, issue.to)
  view.dispatch(tr.setMeta(proofKey, { fix: true } as Meta))
  return true
}

/** Applies every safe fix (of one kind, or all) in a single undo step. */
export function applyAllSafe(view: EditorView, kind?: IssueKind): number {
  const { state } = view
  const list = getProof(state).issues
    .filter((i) => i.safe && i.sugg.length && (!kind || i.kind === kind))
    .filter((i) => state.doc.textBetween(i.from, i.to, '\n', '￼') === i.text)
    .sort((a, b) => b.from - a.from)
  if (!list.length) return 0
  const tr = state.tr
  let last = Infinity
  let n = 0
  for (const i of list) {
    if (i.to > last) continue // overlapping (should not happen)
    if (i.sugg[0]) tr.insertText(i.sugg[0], i.from, i.to)
    else tr.delete(i.from, i.to)
    last = i.from
    n++
  }
  view.dispatch(tr.setMeta(proofKey, { fix: true } as Meta))
  return n
}

export function ignoreIssue(view: EditorView, issue: Issue) {
  ignored.add(ignoreKey(issue))
  const st = getProof(view.state)
  const issues = st.issues.filter((i) => ignoreKey(i) !== ignoreKey(issue))
  view.dispatch(view.state.tr.setMeta(proofKey, { issues } as Meta).setMeta('addToHistory', false))
}

export function addIssueToDictionary(view: EditorView, issue: Issue) {
  addUserWord(issue.text)
  ignoreIssue(view, issue)
}

/** The next issue after `id` in document order (wrapping), for keyboard flow. */
export function neighbour(issues: Issue[], id: string | null, dir: 1 | -1): Issue | null {
  if (!issues.length) return null
  const k = issues.findIndex((i) => i.id === id)
  if (k < 0) return dir > 0 ? issues[0] : issues[issues.length - 1]
  return issues[(k + dir + issues.length) % issues.length]
}
