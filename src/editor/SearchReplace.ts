// Find & Replace with match highlighting (Word's Navigation pane / Replace dialog).
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface SearchOptions { query: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean; diacritics: boolean }
export interface SearchState extends SearchOptions { matches: { from: number; to: number }[]; index: number }

export const searchKey = new PluginKey<SearchState>('search')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      setSearch: (o: Partial<SearchOptions>) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      replaceCurrent: (replacement: string) => ReturnType
      replaceAll: (replacement: string) => ReturnType
      clearSearch: () => ReturnType
    }
  }
}

/** Strip diacritics so that «καλημέρα» matches «καλημερα» (Greek tonos, etc.). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')

function buildRegex(o: SearchOptions): RegExp | null {
  if (!o.query) return null
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!o.regex && !o.diacritics) src = fold(src)
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`
  try {
    return new RegExp(src, 'gu' + (o.caseSensitive ? '' : 'i'))
  } catch {
    return null
  }
}

function findMatches(doc: PMNode, o: SearchOptions) {
  const re = buildRegex(o)
  const out: { from: number; to: number }[] = []
  if (!re) return out
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Build the block's text with a position map (inline atoms count as one char).
    let text = ''
    const map: number[] = []
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) {
          text += child.text![i]
          map.push(pos + 1 + offset + i)
        }
      } else {
        text += '￼'
        map.push(pos + 1 + offset)
      }
    })
    // Diacritic folding keeps length only when every char folds 1:1 — fold per char.
    const hay = !o.regex && !o.diacritics ? [...text].map((c) => fold(c) || c).join('') : text
    const aligned = hay.length === text.length
    const src = aligned ? hay : text
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      const from = map[m.index]
      const last = map[m.index + m[0].length - 1]
      if (from != null && last != null) out.push({ from, to: last + 1 })
    }
    return false
  })
  return out
}

const empty: SearchState = { query: '', caseSensitive: false, wholeWord: false, regex: false, diacritics: false, matches: [], index: -1 }

export const SearchReplace = Extension.create({
  name: 'searchReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => empty,
          apply(tr, prev) {
            const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined
            if (!meta && !tr.docChanged) return prev
            const next = { ...prev, ...(meta || {}) }
            if (!next.query) return { ...empty, ...next, matches: [], index: -1 }
            const matches = findMatches(tr.doc, next)
            let index = meta?.index ?? prev.index
            if (index >= matches.length) index = matches.length ? 0 : -1
            if (index < 0 && matches.length) {
              const head = tr.selection.from
              index = Math.max(0, matches.findIndex((m) => m.from >= head))
            }
            return { ...next, matches, index }
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state)
            if (!s || !s.matches.length) return null
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? 'search-hit search-current' : 'search-hit' })),
            )
          },
        },
      }),
    ]
  },

  addCommands() {
    const go = (dir: 1 | -1) => ({ state, tr, dispatch, view }: any) => {
      const s = searchKey.getState(state)!
      if (!s.matches.length) return false
      const index = (s.index + dir + s.matches.length) % s.matches.length
      const m = s.matches[index]
      if (dispatch) {
        tr.setMeta(searchKey, { index }).setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
        dispatch(tr)
        requestAnimationFrame(() => view.dom.querySelector('.search-current')?.scrollIntoView({ block: 'center' }))
      }
      return true
    }
    return {
      setSearch: (o) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(searchKey, { ...o, index: -1 }))
        return true
      },
      findNext: () => go(1),
      findPrev: () => go(-1),
      replaceCurrent: (replacement) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state)!
        const m = s.matches[s.index]
        if (!m) return false
        if (dispatch) {
          const marks = state.doc.resolve(m.from + 1).marks()
          if (replacement) tr.replaceWith(m.from, m.to, state.schema.text(replacement, marks))
          else tr.delete(m.from, m.to)
          tr.setMeta(searchKey, { index: s.index })
          dispatch(tr)
        }
        return true
      },
      replaceAll: (replacement) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state)!
        if (!s.matches.length) return false
        if (dispatch) {
          for (let i = s.matches.length - 1; i >= 0; i--) {
            const m = s.matches[i]
            const marks = state.doc.resolve(m.from + 1).marks()
            if (replacement) tr.replaceWith(m.from, m.to, state.schema.text(replacement, marks))
            else tr.delete(m.from, m.to)
          }
          dispatch(tr)
        }
        return true
      },
      clearSearch: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(searchKey, { query: '' }))
        return true
      },
    }
  },
})
