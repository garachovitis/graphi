// Numbering / bullet formats for lists (Word's Numbering Library & Bullet Library).
import { Extension } from '@tiptap/core'

export const NUMBER_FORMATS = [
  { id: 'decimal', label: '1. 2. 3.' },
  { id: 'decimal-paren', label: '1) 2) 3)' },
  { id: 'lower-alpha', label: 'a. b. c.' },
  { id: 'upper-alpha', label: 'A. B. C.' },
  { id: 'lower-roman', label: 'i. ii. iii.' },
  { id: 'upper-roman', label: 'I. II. III.' },
  { id: 'lower-greek', label: 'α. β. γ.' },
] as const

export const BULLET_FORMATS = [
  { id: 'disc', label: '●' },
  { id: 'circle', label: '○' },
  { id: 'square', label: '■' },
  { id: 'dash', label: '–' },
  { id: 'arrow', label: '➢' },
  { id: 'check', label: '✓' },
] as const

const TYPE_ATTR: Record<string, string> = { a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman', '1': 'decimal' }

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listStyle: { setListStyle: (style: string) => ReturnType }
  }
}

export const OrderedListStyle = Extension.create({
  name: 'listStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['orderedList', 'bulletList'],
        attributes: {
          listStyle: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              el.getAttribute('data-list-style') || el.style.listStyleType || TYPE_ATTR[el.getAttribute('type') || ''] || null,
            renderHTML: (a: Record<string, any>) => (a.listStyle ? { 'data-list-style': a.listStyle } : {}),
          },
        },
      },
    ]
  },
  addCommands() {
    return {
      setListStyle:
        (style) =>
        ({ editor, chain }) => {
          const isBullet = BULLET_FORMATS.some((b) => b.id === style)
          const type = isBullet ? 'bulletList' : 'orderedList'
          let c = chain().focus()
          if (!editor.isActive(type)) c = isBullet ? c.toggleBulletList() : c.toggleOrderedList()
          return c.updateAttributes(type, { listStyle: style }).run()
        },
    }
  },
})
