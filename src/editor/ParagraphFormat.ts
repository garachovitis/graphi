// Paragraph-level formatting shared by paragraphs and headings, modelled on Word's
// Paragraph dialog: named style, line spacing, space before/after, indents, page-break-before.
import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { cssToPt, parseLineHeight, round2 } from './units'
import { lineHeightCss, styleById } from '../model/styles'

export interface ParaAttrs {
  styleId?: string | null
  lineHeight?: string | null
  spaceBefore?: number | null // pt
  spaceAfter?: number | null // pt
  indentLeft?: number | null // pt
  indentRight?: number | null // pt
  firstLine?: number | null // pt (negative = hanging)
  pageBreakBefore?: boolean
  keepNext?: boolean
  shading?: string | null
}

export const INDENT_STEP_PT = 36 // 0.5" = 1.27 cm, Word's default indent increment

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setParagraphAttrs: (attrs: ParaAttrs) => ReturnType
      setParaStyle: (styleId: string) => ReturnType
      indent: () => ReturnType
      outdent: () => ReturnType
      clearParagraphFormat: () => ReturnType
    }
  }
}

const TYPES = ['paragraph', 'heading']

const ptAttr = (cssProp: 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight' | 'textIndent', dataKey: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => {
    const d = el.getAttribute(`data-${dataKey}`)
    if (d != null) return parseFloat(d)
    const v = cssToPt(el.style[cssProp])
    return v == null ? null : round2(v)
  },
  renderHTML: () => ({}),
})

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  // Above the core keymap, so Enter at the end of a caption is ours.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      // Like Word's "Style for following paragraph": Enter at the end of a caption continues with
      // plain Normal text instead of another numbered caption.
      Enter: () => {
        const { $from, empty } = this.editor.state.selection
        const p = $from.parent
        if (!empty || p.type.name !== 'paragraph' || $from.parentOffset !== p.content.size) return false
        if (!p.attrs.captionKind && p.attrs.styleId !== 'Caption') return false
        return this.editor.chain().splitBlock().command(({ tr }) => {
          const pos = tr.selection.$from.before()
          const n = tr.doc.nodeAt(pos)
          if (n) tr.setNodeMarkup(pos, undefined, { ...n.attrs, styleId: null, captionKind: null, keepNext: false, textAlign: null })
          return true
        }).run()
      },
    }
  },

  // Captions behave like a small text box: framed while the caret is in them, and a click on the
  // "Εικόνα N:" label (or Esc inside) selects the whole caption so Delete removes it.
  addProseMirrorPlugins() {
    const isCap = (n: { type: { name: string }; attrs: Record<string, unknown> }) => n.type.name === 'paragraph' && !!n.attrs.captionKind
    return [new Plugin({
      props: {
        decorations: (state) => {
          const decos: Decoration[] = []
          const { selection } = state
          state.doc.descendants((n, pos) => {
            if (!isCap(n)) return n.isBlock && !n.isTextblock
            const sel = selection instanceof NodeSelection && selection.from === pos
            const inside = !sel && selection.from > pos && selection.to < pos + n.nodeSize
            decos.push(Decoration.node(pos, pos + n.nodeSize, { class: `caption-box${inside ? ' caption-active' : ''}` }))
            return false
          })
          return DecorationSet.create(state.doc, decos)
        },
        handleDOMEvents: {
          mousedown: (view, ev) => {
            const p = (ev.target as HTMLElement | null)?.closest?.('p.caption-box') as HTMLElement | null
            if (!p || ev.button !== 0) return false
            const pos = view.posAtDOM(p, 0) - 1
            const n = view.state.doc.nodeAt(pos)
            if (!n || !isCap(n)) return false
            // Left of the first character on its line = on the auto label.
            const c = view.coordsAtPos(pos + 1)
            if (ev.clientY > c.bottom || ev.clientX >= c.left) return false
            ev.preventDefault()
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
            view.focus()
            return true
          },
        },
        handleKeyDown: (view, ev) => {
          if (ev.key !== 'Escape') return false
          const { $from, empty } = view.state.selection
          if (!empty || !isCap($from.parent)) return false
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, $from.before())))
          return true
        },
      },
    })]
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          styleId: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const s = el.getAttribute('data-style')
              if (s) return s
              // Word HTML: class="MsoTitle", "MsoSubtitle", "MsoQuote", "MsoNoSpacing"
              const cls = el.className || ''
              const m = /Mso(Title|Subtitle|Quote|NoSpacing|IntenseQuote)/.exec(cls)
              if (m) return m[1] === 'IntenseQuote' ? 'Quote' : m[1]
              return null
            },
            renderHTML: (a: ParaAttrs) => (a.styleId && a.styleId !== 'Normal' ? { 'data-style': a.styleId } : {}),
          },
          // Auto-numbered caption: "Εικόνα N:" / "Πίνακας N:" (numbers come from CSS counters / exporters).
          captionKind: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-caption') || null,
            renderHTML: (a: { captionKind?: string | null }) => (a.captionKind ? { 'data-caption': a.captionKind } : {}),
          },
        },
      },
      {
        types: TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-line-height') || parseLineHeight(el.style.lineHeight),
            renderHTML: (a: ParaAttrs) => (a.lineHeight ? { 'data-line-height': a.lineHeight } : {}),
          },
          spaceBefore: ptAttr('marginTop', 'space-before'),
          spaceAfter: ptAttr('marginBottom', 'space-after'),
          indentLeft: ptAttr('marginLeft', 'indent-left'),
          indentRight: ptAttr('marginRight', 'indent-right'),
          firstLine: ptAttr('textIndent', 'first-line'),
          pageBreakBefore: {
            default: false,
            parseHTML: (el: HTMLElement) =>
              el.style.breakBefore === 'page' || el.style.pageBreakBefore === 'always' || el.hasAttribute('data-break-before'),
            renderHTML: () => ({}),
          },
          keepNext: {
            default: false,
            parseHTML: (el: HTMLElement) => el.hasAttribute('data-keep-next'),
            renderHTML: () => ({}),
          },
          shading: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-shading') || null,
            renderHTML: () => ({}),
          },
          // Composite renderer: one style attribute built from all of the above.
          _paraStyle: {
            default: null,
            parseHTML: () => null,
            renderHTML: (a: ParaAttrs) => {
              const css: string[] = []
              const out: Record<string, string> = {}
              if (a.lineHeight) css.push(`line-height:${lineHeightCss(a.lineHeight)}`)
              if (a.spaceBefore != null) css.push(`margin-top:${a.spaceBefore}pt`)
              if (a.spaceAfter != null) css.push(`margin-bottom:${a.spaceAfter}pt`)
              if (a.indentLeft != null) css.push(`margin-left:${a.indentLeft}pt`)
              if (a.indentRight != null) css.push(`margin-right:${a.indentRight}pt`)
              if (a.firstLine != null) css.push(`text-indent:${a.firstLine}pt`)
              if (a.shading) css.push(`background-color:${a.shading}`)
              if (a.pageBreakBefore) out['data-break-before'] = ''
              if (a.keepNext) out['data-keep-next'] = ''
              if (css.length) out.style = css.join(';')
              return out
            },
          },
        },
      },
    ]
  },

  addCommands() {
    const eachPara = (fn: (attrs: Record<string, unknown>, type: string) => Record<string, unknown> | null) =>
      ({ tr, state, dispatch }: any) => {
        const { from, to } = state.selection
        let changed = false
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (!TYPES.includes(node.type.name)) return true
          const next = fn(node.attrs, node.type.name)
          if (next) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next })
            changed = true
          }
          return false
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }

    return {
      setParagraphAttrs: (attrs) => eachPara(() => attrs as Record<string, unknown>),

      setParaStyle:
        (styleId) =>
        ({ chain }) => {
          const st = styleById(styleId)
          if (!st) return false
          if (st.node === 'heading') {
            return chain().setNode('heading', { level: st.level }).run()
          }
          return chain()
            .setNode('paragraph')
            .command(({ tr, state }) => {
              const { from, to } = state.selection
              state.doc.nodesBetween(from, to, (node, pos) => {
                if (node.type.name !== 'paragraph') return true
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, styleId: styleId === 'Normal' ? null : styleId })
                return false
              })
              return true
            })
            .run()
        },

      indent:
        () =>
        (props) => {
          const { editor, commands } = props
          if (editor.isActive('listItem') || editor.isActive('taskItem')) {
            return commands.sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem')
          }
          return eachPara((a) => ({ indentLeft: round2(((a.indentLeft as number) || 0) + INDENT_STEP_PT) }))(props)
        },

      outdent:
        () =>
        (props) => {
          const { editor, commands } = props
          if (editor.isActive('listItem') || editor.isActive('taskItem')) {
            return commands.liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem')
          }
          return eachPara((a) => {
            const cur = (a.indentLeft as number) || 0
            if (cur <= 0) return null
            const n = Math.max(0, round2(cur - INDENT_STEP_PT))
            return { indentLeft: n || null }
          })(props)
        },

      clearParagraphFormat: () =>
        eachPara(() => ({
          styleId: null, lineHeight: null, spaceBefore: null, spaceAfter: null, indentLeft: null,
          indentRight: null, firstLine: null, pageBreakBefore: false, keepNext: false, shading: null, textAlign: null,
        })),
    }
  },
})
