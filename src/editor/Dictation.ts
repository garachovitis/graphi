// Dictation in the editor: words still being recognised are a widget decoration at the caret
// (never document content); a finished phrase is inserted as one undo step with the caret's formatting.
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { render, preview, type RenderOpts } from '../dictation/text'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dictation: {
      /** Grey preview of the phrase in progress ('' hides it). */
      setDictationInterim: (text: string, o: RenderOpts) => ReturnType
    }
  }
}

const key = new PluginKey<string>('dictation')

/** Paragraph text before the caret (inline nodes count as one character). */
const textBefore = (sel: Selection) => sel.$from.parent.textBetween(0, sel.$from.parentOffset, undefined, '￼')

export const Dictation = Extension.create({
  name: 'dictation',

  addProseMirrorPlugins() {
    return [
      new Plugin<string>({
        key,
        state: {
          init: () => '',
          apply: (tr, v) => (tr.getMeta(key) as string | undefined) ?? v,
        },
        props: {
          decorations(state) {
            const text = key.getState(state)
            if (!text) return null
            const w = document.createElement('span')
            w.className = 'dictation-interim'
            w.textContent = text
            return DecorationSet.create(state.doc, [Decoration.widget(state.selection.head, w, { side: 1, key: text })])
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setDictationInterim: (text, o) => ({ state, tr, dispatch }) => {
        const shown = text ? preview(text, textBefore(state.selection), o) : ''
        if (shown === key.getState(state)) return true
        dispatch?.(tr.setMeta(key, shown).setMeta('addToHistory', false))
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
      if (op.text || del) view.dispatch(editor.state.tr.insertText(op.text, from - del, from).setMeta(key, '').scrollIntoView())
    } else if (op.type === 'para') {
      editor.commands.first(({ commands }) => [() => commands.splitListItem('listItem'), () => commands.splitListItem('taskItem'), () => commands.splitBlock()])
    } else {
      editor.commands.setHardBreak()
    }
  }
  return true
}
