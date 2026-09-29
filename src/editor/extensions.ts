// Assembles the editor schema. Anything that touches the document model lives here so
// the editor, headless import/export and tests share one definition.
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color, FontFamily, FontSize, BackgroundColor } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Table, TableRow } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { CharacterCount, Placeholder, Gapcursor, Dropcursor } from '@tiptap/extensions'
import Typography from '@tiptap/extension-typography'
import type { AnyExtension } from '@tiptap/core'
import { ParagraphFormat } from './ParagraphFormat'
import { PageBreak, TableOfContents, WTableCell, WTableHeader } from './nodes'
import { Picture } from './image'
import { SearchReplace } from './SearchReplace'
import { Dictation } from './Dictation'
import { Proofing } from './Proofing'
import { Pagination } from './Pagination'
import { WordShortcuts } from './format'
import { OrderedListStyle } from './lists'
import { t } from '../i18n'

/** Schema-only extensions (safe for headless use). */
export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
      undoRedo: { depth: 500, newGroupDelay: 600 },
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
    }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    BackgroundColor,
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    Table.configure({ resizable: true, lastColumnResizable: true, allowTableNodeSelection: true, cellMinWidth: 24 }),
    TableRow,
    WTableHeader,
    WTableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Picture,
    ParagraphFormat,
    PageBreak,
    TableOfContents,
    OrderedListStyle,
  ]
}

/** Full interactive editor. */
export function editorExtensions(): AnyExtension[] {
  return [
    ...schemaExtensions(),
    CharacterCount,
    Gapcursor,
    Dropcursor.configure({ color: '#1ab3ac', width: 2 }),
    Placeholder.configure({ placeholder: () => t('editor.placeholder'), showOnlyWhenEditable: true, showOnlyCurrent: true }),
    Typography.configure({ oneHalf: false, oneQuarter: false, threeQuarters: false, plusMinus: false, notEqual: false, laquo: false, raquo: false }),
    SearchReplace,
    Dictation,
    Proofing,
    WordShortcuts,
    Pagination,
  ]
}
