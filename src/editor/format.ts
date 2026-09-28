// Character-formatting helpers used by the ribbon and keyboard shortcuts.
import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { DEFAULT_FONT, PARA_STYLES, headingStyle, styleById } from '../model/styles'
import { fontSizeToPt } from './units'

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]

/** The paragraph style in effect at the selection head. */
export function currentStyle(editor: Editor) {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d)
    if (n.type.name === 'heading') return headingStyle(n.attrs.level)
    if (n.type.name === 'paragraph') return styleById(n.attrs.styleId) || PARA_STYLES[0]
  }
  return PARA_STYLES[0]
}

export function currentFontSizePt(editor: Editor): number {
  const fs = editor.getAttributes('textStyle').fontSize as string | undefined
  const pt = fontSizeToPt(fs)
  if (pt) return pt
  if (editor.isActive('codeBlock') || editor.isActive('code')) return 10
  return currentStyle(editor).sizePt
}

export function currentFontFamily(editor: Editor): string {
  const ff = editor.getAttributes('textStyle').fontFamily as string | undefined
  if (ff) return ff.split(',')[0].replace(/["']/g, '').trim()
  return currentStyle(editor).font || DEFAULT_FONT
}

export function setFontSizePt(editor: Editor, pt: number) {
  const v = Math.max(1, Math.min(1638, Math.round(pt * 2) / 2))
  editor.chain().focus().setFontSize(`${v}pt`).run()
}

export function growFont(editor: Editor, dir: 1 | -1) {
  const cur = currentFontSizePt(editor)
  let next: number
  if (dir > 0) next = FONT_SIZES.find((s) => s > cur + 0.01) ?? cur + 10
  else next = [...FONT_SIZES].reverse().find((s) => s < cur - 0.01) ?? Math.max(1, cur - 1)
  setFontSizePt(editor, next)
}

export function stepFont(editor: Editor, dir: 1 | -1) {
  setFontSizePt(editor, currentFontSizePt(editor) + dir)
}

export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence' | 'toggle'

export function changeCase(editor: Editor, mode: CaseMode) {
  const { state } = editor
  const { from, to, empty } = state.selection
  if (empty) return
  const tr = state.tr
  let sentenceStart = true
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) sentenceStart = true
    if (!node.isText) return true
    const s = Math.max(from, pos)
    const e = Math.min(to, pos + node.nodeSize)
    const text = node.text!.slice(s - pos, e - pos)
    let out = text
    switch (mode) {
      case 'upper': out = text.toLocaleUpperCase(); break
      case 'lower': out = text.toLocaleLowerCase(); break
      case 'toggle': out = [...text].map((c) => (c === c.toLocaleUpperCase() ? c.toLocaleLowerCase() : c.toLocaleUpperCase())).join(''); break
      case 'title': out = text.toLocaleLowerCase().replace(/(^|[\s\-–—("«])(\p{L})/gu, (_m, a, b) => a + b.toLocaleUpperCase()); break
      case 'sentence': {
        let r = ''
        for (const c of text.toLocaleLowerCase()) {
          if (sentenceStart && /\p{L}/u.test(c)) { r += c.toLocaleUpperCase(); sentenceStart = false }
          else { r += c; if (/[.!?;]/.test(c)) sentenceStart = true }
        }
        out = strip(text, r)
        break
      }
    }
    if (out !== text) tr.insertText(out, s, e)
    return false
  })
  if (tr.docChanged) {
    tr.setSelection(state.selection.map(tr.doc, tr.mapping))
    editor.view.dispatch(tr)
  }
}
// Greek: uppercase must drop tonos (Ά→Α) — toLocaleUpperCase('el') does this natively.
const strip = (_orig: string, r: string) => r

// ───────────── Format painter ─────────────
export interface PaintedFormat { marks: { type: string; attrs: Record<string, unknown> }[]; para: Record<string, unknown> | null; align: string | null }

export function captureFormat(editor: Editor): PaintedFormat {
  const { state } = editor
  const $pos = state.selection.$from
  const marks = (state.storedMarks || $pos.marks()).map((m) => ({ type: m.type.name, attrs: { ...m.attrs } }))
  const parent = $pos.parent
  const para = parent.type.name === 'paragraph' || parent.type.name === 'heading'
    ? {
        lineHeight: parent.attrs.lineHeight, spaceBefore: parent.attrs.spaceBefore, spaceAfter: parent.attrs.spaceAfter,
        indentLeft: parent.attrs.indentLeft, indentRight: parent.attrs.indentRight, firstLine: parent.attrs.firstLine,
      }
    : null
  return { marks, para, align: parent.attrs.textAlign ?? null }
}

export function applyFormat(editor: Editor, f: PaintedFormat) {
  let c = editor.chain().focus().unsetAllMarks()
  for (const m of f.marks) c = c.setMark(m.type, m.attrs)
  if (f.para) c = c.setParagraphAttrs(f.para as any)
  if (f.align) c = c.setTextAlign(f.align)
  c.run()
}

// ───────────── Word-compatible keyboard shortcuts ─────────────
export const WordShortcuts = Extension.create({
  name: 'wordShortcuts',
  addKeyboardShortcuts() {
    const e = () => this.editor
    return {
      'Mod-e': () => e().chain().focus().setTextAlign('center').run(),
      'Mod-l': () => e().chain().focus().setTextAlign('left').run(),
      'Mod-r': () => e().chain().focus().setTextAlign('right').run(),
      'Mod-j': () => e().chain().focus().setTextAlign('justify').run(),
      'Mod-]': () => { stepFont(e(), 1); return true },
      'Mod-[': () => { stepFont(e(), -1); return true },
      'Mod-Shift-.': () => { growFont(e(), 1); return true },
      'Mod-Shift-,': () => { growFont(e(), -1); return true },
      'Mod-Shift->': () => { growFont(e(), 1); return true },
      'Mod-Shift-<': () => { growFont(e(), -1); return true },
      'Mod-=': () => e().chain().focus().toggleSubscript().run(),
      'Mod-Shift-=': () => e().chain().focus().toggleSuperscript().run(),
      'Mod-Shift-+': () => e().chain().focus().toggleSuperscript().run(),
      'Mod-1': () => e().chain().focus().setParagraphAttrs({ lineHeight: '1' }).run(),
      'Mod-2': () => e().chain().focus().setParagraphAttrs({ lineHeight: '2' }).run(),
      'Mod-5': () => e().chain().focus().setParagraphAttrs({ lineHeight: '1.5' }).run(),
      'Mod-Shift-n': () => e().chain().focus().setParaStyle('Normal').run(),
      'Mod-Shift-l': () => e().chain().focus().toggleBulletList().run(),
      'Mod-m': () => e().chain().focus().indent().run(),
      'Mod-Shift-m': () => e().chain().focus().outdent().run(),
      'Mod-\\': () => e().chain().focus().unsetAllMarks().run(),
      'Shift-F3': () => {
        const { from, to } = e().state.selection
        const t = e().state.doc.textBetween(from, to)
        changeCase(e(), t === t.toLocaleUpperCase() ? 'lower' : t === t.toLocaleLowerCase() ? 'title' : 'upper')
        return true
      },
      Tab: () => {
        const ed = e()
        if (ed.isActive('table')) return false // table extension moves to next cell
        if (ed.isActive('listItem') || ed.isActive('taskItem')) return ed.commands.indent()
        if (ed.isActive('codeBlock')) return ed.commands.insertContent('\t')
        return ed.commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        const ed = e()
        if (ed.isActive('table')) return false
        return ed.commands.outdent()
      },
    }
  },
})
