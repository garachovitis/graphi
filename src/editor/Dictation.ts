// Dictation in the editor: a listening wave and the words still being recognised are widget
// decorations at the caret (never document content); a finished phrase is inserted as one undo step with the caret's formatting.
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { render, preview, type RenderOpts } from '../dictation/text'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dictation: {
      /** Grey preview of the phrase in progress ('' hides it). */
      setDictationInterim: (text: string, o: RenderOpts) => ReturnType
      /** Show / hide the listening wave at the caret. */
      setDictationActive: (on: boolean) => ReturnType
    }
  }
}

interface DictView { active: boolean; text: string }
const key = new PluginKey<DictView>('dictation')

/** Paragraph text before the caret (inline nodes count as one character). */
const textBefore = (sel: Selection) => sel.$from.parent.textBetween(0, sel.$from.parentOffset, undefined, '\ufffc')

// The wave's bars follow `--dict-l0…4`, set on the editor ~33×/s by the controller: one element,
// kept across transactions (same key), so typing or new words never restart its animation.
function wave() {
  const w = document.createElement('span')
  w.className = 'dict-wave'
  w.setAttribute('aria-hidden', 'true')
  w.contentEditable = 'false'
  for (let i = 0; i < 5; i++) {
    const b = document.createElement('i')
    b.style.setProperty('--l', `var(--dict-l${i}, 0)`)
    w.append(b)
  }
  return w
}

export const Dictation = Extension.create({
  name: 'dictation',

  addProseMirrorPlugins() {
    return [
      new Plugin<DictView>({
        key,
        state: {
          init: () => ({ active: false, text: '' }),
          apply: (tr, v) => {
            const m = tr.getMeta(key) as Partial<DictView> | undefined
            return m ? { ...v, ...m } : v
          },
        },
        props: {
          decorations(state) {
            const { active, text } = key.getState(state)!
            if (!active && !text) return null
            const pos = state.selection.head
            const decos: Decoration[] = []
            if (text) {
              const t = document.createElement('span')
              t.className = 'dictation-interim'
              t.textContent = text
              decos.push(Decoration.widget(pos, t, { side: 1, key: `t:${text}` }))
            }
            if (active) decos.push(Decoration.widget(pos, wave, { side: 2, key: 'dict-wave', ignoreSelection: true }))
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setDictationInterim: (text, o) => ({ state, tr, dispatch }) => {
        const shown = text ? preview(text, textBefore(state.selection), o) : ''
        if (shown === key.getState(state)!.text) return true
        dispatch?.(tr.setMeta(key, { text: shown }).setMeta('addToHistory', false))
        return true
      },
      setDictationActive: (on) => ({ state, tr, dispatch }) => {
        if (on === key.getState(state)!.active) return true
        dispatch?.(tr.setMeta(key, { active: on, text: '' }).setMeta('addToHistory', false))
        return true
      },
    }
  },
})

/**
 * Insert a recognised phrase at the caret; false if the phrase asked to stop dictating.
 * Each step is an ordinary editor command, so "new paragraph" behaves exactly like Enter (new list
 * item inside lists) and the steps of one phrase fall into one undo group.
 */
export function insertDictation(editor: Editor, text: string, o: RenderOpts): boolean {
  const view = editor.view
  if (!editor.state.selection.empty) editor.commands.deleteSelection() // Word replaces a selection
  for (const op of render(text, textBefore(editor.state.selection), o)) {
    if (op.type === 'stop') return false
    if (op.type === 'text') {
      const { from, $from } = editor.state.selection
      const del = Math.min(op.deleteBefore, $from.parentOffset)
      // insertText keeps the caret's marks (bold, font, colour…) just like typing.
      if (op.text || del) view.dispatch(editor.state.tr.insertText(op.text, from - del, from).setMeta(key, { text: '' }).scrollIntoView())
    } else if (op.type === 'para') {
      editor.commands.first(({ commands }) => [() => commands.splitListItem('listItem'), () => commands.splitListItem('taskItem'), () => commands.splitBlock()])
    } else {
      editor.commands.setHardBreak()
    }
  }
  return true
}
