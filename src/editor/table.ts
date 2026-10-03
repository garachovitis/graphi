// Tables: the table node with its style (src/model/tableStyles.ts), and Word's move handle — hover a
// table and a small ✥ appears at its top-left corner; click it to select the whole table, drag it
// to move the table (with its caption) between any two paragraphs.
import { Extension, type Editor } from '@tiptap/core'
import { Table, TableView } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import { t } from '../i18n'
import { isStyleInk, type TableStyleId } from '../model/tableStyles'

/** TipTap's view writes the table's attributes only once; the style must follow every change. */
class StyledTableView extends TableView {
  constructor(node: PMNode, cellMinWidth: number, view?: EditorView, attrs?: Record<string, unknown>) {
    super(node, cellMinWidth, view, attrs)
    this.sync()
  }
  update(node: PMNode) {
    if (!super.update(node)) return false
    this.sync()
    return true
  }
  private sync() {
    const s = this.node.attrs.tableStyle as string | null
    if (s) this.table.dataset.tableStyle = s
    else delete this.table.dataset.tableStyle
  }
}

export const WTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableStyle: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-table-style') || null,
        renderHTML: (a: { tableStyle?: string | null }) => (a.tableStyle ? { 'data-table-style': a.tableStyle } : {}),
      },
    }
  },
}).configure({ resizable: true, lastColumnResizable: true, allowTableNodeSelection: true, cellMinWidth: 24, View: StyledTableView })

/**
 * Applies a table style to the table around the caret. Like picking a style in Word's gallery, the
 * style's colours replace the cells' own shading (and the text colour an earlier style put there).
 */
export function setTableStyle(editor: Editor, id: TableStyleId) {
  const { $from } = editor.state.selection
  let d = $from.depth
  while (d > 0 && $from.node(d).type.name !== 'table') d--
  if (d === 0 && editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === 'table') d = -1
  editor.chain().focus().command(({ tr, state }) => {
    const pos = d === -1 ? state.selection.from : $from.before(d)
    const table = state.doc.nodeAt(pos)
    if (!table || table.type.name !== 'table') return false
    tr.setNodeMarkup(pos, undefined, { ...table.attrs, tableStyle: id === 'grid' ? null : id })
    const textStyle = state.schema.marks.textStyle
    table.descendants((n, p) => {
      const at = pos + 1 + p
      if ((n.type.name === 'tableCell' || n.type.name === 'tableHeader') && n.attrs.backgroundColor) tr.setNodeAttribute(at, 'backgroundColor', null)
      if (n.isText) {
        const m = n.marks.find((x) => x.type === textStyle)
        if (m && isStyleInk(m.attrs.color)) {
          tr.removeMark(at, at + n.nodeSize, textStyle)
          const rest = { ...m.attrs, color: null }
          if (Object.values(rest).some((v) => v != null)) tr.addMark(at, at + n.nodeSize, textStyle.create(rest))
        }
      }
      return true
    })
    return true
  }).run()
}

// ───────────── move handle ─────────────
const MOVE_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const isTableCaption = (n: PMNode | null | undefined) => !!n && n.type.name === 'paragraph' && n.attrs.captionKind === 'table'

/** The top-level range that moves together: the table and the caption right above / below it. */
interface Range { start: number; end: number; table: number }

class MoveHandle {
  readonly el = document.createElement('div')
  private wrapper: HTMLElement | null = null
  private hideTimer = 0
  private dragging = false

  constructor(private readonly view: EditorView) {
    this.el.className = 'tbl-move'
    this.el.innerHTML = MOVE_ICON
    this.el.addEventListener('pointerdown', this.drag)
    this.el.addEventListener('mouseenter', () => clearTimeout(this.hideTimer))
    this.el.addEventListener('mouseleave', this.hideSoon)
    view.dom.addEventListener('mousemove', this.onMove)
    view.dom.addEventListener('mouseleave', this.hideSoon)
    window.addEventListener('scroll', this.hide, true)
    document.body.appendChild(this.el)
  }

  update() {
    if (this.dragging || !this.wrapper) return
    if (this.wrapper.isConnected) this.show(this.wrapper)
    else this.hide()
  }

  destroy() {
    clearTimeout(this.hideTimer)
    this.view.dom.removeEventListener('mousemove', this.onMove)
    this.view.dom.removeEventListener('mouseleave', this.hideSoon)
    window.removeEventListener('scroll', this.hide, true)
    this.el.remove()
  }

  private onMove = (e: MouseEvent) => {
    if (this.dragging || !this.view.editable) return
    const w = (e.target as HTMLElement).closest?.('.tableWrapper') as HTMLElement | null
    // Top-level tables only: a table inside a cell or list moves with what holds it.
    if (!w || w.parentElement !== this.view.dom) return this.hideSoon()
    clearTimeout(this.hideTimer)
    this.show(w)
  }

  private show(w: HTMLElement) {
    this.wrapper = w
    const r = (w.querySelector('table') ?? w).getBoundingClientRect()
    this.el.title = t('tbl.moveTitle')
    this.el.style.left = `${r.left - 20}px`
    this.el.style.top = `${r.top - 20}px`
    this.el.classList.add('on')
  }
  private hide = () => {
    if (this.dragging) return
    this.el.classList.remove('on')
    this.wrapper = null
  }
  private hideSoon = () => {
    clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(this.hide, 350)
  }

  private rangeOf(w: HTMLElement): Range | null {
    const doc = this.view.state.doc
    let pos = 0
    for (let i = 0; i < doc.childCount; i++) {
      const n = doc.child(i)
      if (n.type.name === 'table' && this.view.nodeDOM(pos) === w) {
        const prev = i > 0 ? doc.child(i - 1) : null
        const next = i + 1 < doc.childCount ? doc.child(i + 1) : null
        return {
          start: isTableCaption(prev) ? pos - prev!.nodeSize : pos,
          end: pos + n.nodeSize + (isTableCaption(next) ? next!.nodeSize : 0),
          table: pos,
        }
      }
      pos += n.nodeSize
    }
    return null
  }

  /** Press selects the whole table; dragging moves it (and its caption) to the gap under the pointer. */
  private drag = (e: PointerEvent) => {
    const w = this.wrapper
    if (e.button !== 0 || !w) return
    const range = this.rangeOf(w)
    if (!range) return
    e.preventDefault()
    e.stopPropagation()
    const view = this.view
    view.focus()
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, range.table)))

    // Everything that moves, and every gap between top-level blocks (measured before anything moves,
    // relative to the editor so scrolling during the drag doesn't matter).
    const doc = view.state.doc
    const moving: HTMLElement[] = []
    const gaps: { pos: number; y: number; mid: number }[] = []
    const ed0 = view.dom.getBoundingClientRect().top
    let pos = 0, lastBottom = 0
    for (let i = 0; i < doc.childCount; i++) {
      const dom = view.nodeDOM(pos)
      if (dom instanceof HTMLElement) {
        const r = dom.getBoundingClientRect()
        if (pos >= range.start && pos < range.end) moving.push(dom)
        gaps.push({ pos, y: r.top - ed0, mid: r.top + r.height / 2 - ed0 })
        lastBottom = r.bottom - ed0
      }
      pos += doc.child(i).nodeSize
    }
    gaps.push({ pos: doc.content.size, y: lastBottom, mid: Infinity })

    const zoom = w.getBoundingClientRect().width / (w.offsetWidth || 1) || 1
    const x0 = e.clientX, y0 = e.clientY
    const h0 = { left: parseFloat(this.el.style.left), top: parseFloat(this.el.style.top) }
    const line = document.createElement('div')
    line.className = 'tbl-drop'
    let started = false
    let target: number | null = null
    this.dragging = true

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0
      if (!started) {
        if (Math.hypot(dx, dy) < 5) return
        started = true
        moving.forEach((m) => m.classList.add('tbl-moving'))
        document.body.appendChild(line)
        document.body.classList.add('tbl-dragging')
      }
      moving.forEach((m) => { m.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)` })
      this.el.style.left = `${h0.left + dx}px`
      this.el.style.top = `${h0.top + dy}px`
      // The gap nearest the top of the moving table.
      const ed = view.dom.getBoundingClientRect()
      const y = h0.top + 20 + dy - ed.top
      const gap = gaps.find((g) => y < g.mid) ?? gaps[gaps.length - 1]
      target = gap.pos >= range.start && gap.pos <= range.end ? null : gap.pos
      line.style.display = target == null ? 'none' : ''
      Object.assign(line.style, { left: `${ed.left}px`, width: `${ed.width}px`, top: `${ed.top + gap.y - 1}px` })
    }
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      moving.forEach((m) => { m.classList.remove('tbl-moving'); m.style.transform = '' })
      line.remove()
      document.body.classList.remove('tbl-dragging')
      this.dragging = false
      if (started && target != null && ev.type === 'pointerup') this.moveTo(range, target)
      else if (this.wrapper) this.show(this.wrapper)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  private moveTo(range: Range, to: number) {
    const { state } = this.view
    const content = state.doc.slice(range.start, range.end).content
    const tr = state.tr.delete(range.start, range.end)
    const at = tr.mapping.map(to)
    tr.insert(at, content)
    // A table is never the last block: there must be somewhere to type after it.
    if (at + content.size === tr.doc.content.size) tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create())
    tr.setSelection(NodeSelection.create(tr.doc, at + range.table - range.start)).scrollIntoView()
    this.view.dispatch(tr)
    this.hide()
  }
}

export const TableMove = Extension.create({
  name: 'tableMove',
  addProseMirrorPlugins() {
    return [new Plugin({ view: (view) => new MoveHandle(view) })]
  },
})
