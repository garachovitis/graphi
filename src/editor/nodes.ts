// Custom document nodes: hard page break, table of contents, sized images, styled table cells.
import { Node, mergeAttributes } from '@tiptap/core'
import { TableCell, TableHeader } from '@tiptap/extension-table'
import { layoutStore } from './layoutStore'
import { normalizeColor } from './units'
import { headingNumberer } from '../model/styles'
import { t, onLangChange } from '../i18n'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: { setPageBreak: () => ReturnType; setBreak: (kind: BreakKind) => ReturnType }
    toc: { insertTableOfContents: () => ReturnType }
  }
}

// ───────────── Page / column / section breaks (Ctrl/Cmd+Enter) ─────────────
// One atom node for every break kind. The single-section, single-column editor renders
// `column` like a page break (as Word does in one-column text) and `continuous` as a
// mark only; `evenPage` / `oddPage` skip a blank page when needed. Exports keep the kind.
export type BreakKind = 'page' | 'column' | 'nextPage' | 'continuous' | 'evenPage' | 'oddPage'
export const BREAK_KINDS: BreakKind[] = ['page', 'column', 'nextPage', 'continuous', 'evenPage', 'oddPage']
export const isSectionBreak = (k: unknown) => k === 'nextPage' || k === 'continuous' || k === 'evenPage' || k === 'oddPage'

// Formatting-marks labels (CSS ::before reads them), kept in the UI language.
function setBreakLabels() {
  if (typeof document === 'undefined') return
  const st = document.documentElement.style
  for (const k of BREAK_KINDS) st.setProperty(`--brk-${k}`, JSON.stringify(`·········· ${t(`brk.mark.${k}`)} ··········`))
}
setBreakLabels()
onLangChange(setBreakLabels)

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: {
        default: 'page',
        parseHTML: (el) => {
          const k = el.getAttribute('data-break') as BreakKind | null
          return k && BREAK_KINDS.includes(k) ? k : 'page'
        },
        renderHTML: (a) => (a.kind && a.kind !== 'page' ? { 'data-break': a.kind } : {}),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-page-break]' },
      // Word / LibreOffice HTML: <br style="page-break-before:always"> or <br clear=all style=...>
      {
        tag: 'br',
        priority: 60,
        getAttrs: (el) => {
          const s = (el as HTMLElement).style
          return s.pageBreakBefore === 'always' || s.breakBefore === 'page' ? null : false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'page-break', contenteditable: 'false' })]
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run(),
      setBreak:
        (kind) =>
        ({ chain }) =>
          chain().insertContent([{ type: 'pageBreak', attrs: { kind } }, { type: 'paragraph' }]).run(),
    }
  },

  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }
  },
})

// ───────────── Table of contents ─────────────
// Rendered live from the document's headings; page numbers come from the pagination engine.
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return { maxLevel: { default: 3, parseHTML: (el) => Number(el.getAttribute('data-max-level')) || 3 } }
  },

  parseHTML() {
    return [{ tag: 'div[data-toc]' }]
  },

  renderHTML({ node }) {
    // Static rendering (HTML export / clipboard): entries are filled in by the exporter.
    return ['div', { 'data-toc': '', 'data-max-level': node.attrs.maxLevel, class: 'toc' }]
  },

  addNodeView() {
    return ({ editor, node, getPos }) => {
      const dom = document.createElement('div')
      dom.className = 'toc'
      dom.setAttribute('data-toc', '')
      dom.contentEditable = 'false'
      let maxLevel = node.attrs.maxLevel as number

      const render = () => {
        const split = layoutStore.lessonSplit
        const here = typeof getPos === 'function' ? getPos() : undefined
        const range: [number, number] | undefined = split == null || here == null ? undefined
          : here < split ? [0, split] : [split, editor.state.doc.content.size]
        const entries = collectHeadings(editor.state.doc, maxLevel, range)
        const pages = layoutStore.headingPages
        dom.replaceChildren()
        const title = document.createElement('div')
        title.className = 'toc-title'
        title.textContent = t('toc.title')
        dom.appendChild(title)
        if (!entries.length) {
          const empty = document.createElement('div')
          empty.className = 'toc-empty'
          empty.textContent = t('toc.empty')
          dom.appendChild(empty)
          return
        }
        for (const e of entries) {
          const row = document.createElement('div')
          row.className = `toc-entry toc-l${e.level}`
          const label = document.createElement('span')
          label.className = 'toc-text'
          label.textContent = layoutStore.headingNumbers ? `${e.num}\u00a0\u00a0${e.text}` : e.text
          const dots = document.createElement('span')
          dots.className = 'toc-dots'
          const pg = document.createElement('span')
          pg.className = 'toc-page'
          pg.textContent = String(pages.get(e.pos) ?? '')
          row.append(label, dots, pg)
          row.addEventListener('mousedown', (ev) => {
            ev.preventDefault()
            editor.chain().focus().setTextSelection(e.pos + 1).scrollIntoView().run()
          })
          dom.appendChild(row)
        }
      }
      render()
      const unsub = layoutStore.subscribe(render)
      const offLang = onLangChange(render)
      editor.on('update', render)

      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'tableOfContents') return false
          maxLevel = n.attrs.maxLevel
          render()
          return true
        },
        destroy: () => {
          unsub()
          offLang()
          editor.off('update', render)
        },
        ignoreMutation: () => true,
      }
    }
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: 'tableOfContents' }, { type: 'paragraph' }]).run(),
    }
  },
})

export interface HeadingEntry { level: number; text: string; pos: number; num: string }
export function collectHeadings(doc: any, maxLevel = 9, range?: [number, number]): HeadingEntry[] {
  const out: HeadingEntry[] = []
  const number = headingNumberer()
  doc.descendants((n: any, pos: number) => {
    if (n.type.name === 'heading') {
      if (range && (pos < range[0] || pos >= range[1])) return false
      // Numbering counts every heading (as the CSS counters do), even empty/deeper ones.
      const num = number(n.attrs.level)
      if (n.attrs.level <= maxLevel && n.textContent.trim()) out.push({ level: n.attrs.level, text: n.textContent, pos, num })
      return false
    }
    return true
  })
  return out
}

// ───────────── Table cells with shading / vertical alignment ─────────────
const cellAttrs = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => normalizeColor(el.getAttribute('data-bg') || el.style.backgroundColor || el.getAttribute('bgcolor')),
    renderHTML: (a: Record<string, any>) => (a.backgroundColor ? { 'data-bg': a.backgroundColor, style: `background-color:${a.backgroundColor}` } : {}),
  },
  verticalAlign: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-valign') || el.style.verticalAlign || el.getAttribute('valign') || null,
    renderHTML: (a: Record<string, any>) => (a.verticalAlign ? { 'data-valign': a.verticalAlign, style: `vertical-align:${a.verticalAlign}` } : {}),
  },
}

export const WTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs }
  },
})
export const WTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs }
  },
})
