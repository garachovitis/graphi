// File-format dispatch: open any supported file, save/export to any supported format.
import { generateHTML, type JSONContent } from '@tiptap/core'
import { marked } from 'marked'
import { schemaExtensions } from '../editor/extensions'
import { normalizeSettings, type DocSettings } from '../model/settings'
import { pageCss, surfaceCss } from '../model/docCss'
import { collectHeadingsJson, escapeHtml, textOf } from './common'
import { importDocx } from './docxImport'
import { exportDocx } from './docxExport'
import { exportOdt, importOdt } from './odt'

import { type Kind } from './kinds'
export { SAVE_FORMATS, kindOf, baseName, type Kind } from './kinds'
import { kindOf } from './kinds'
import { t, getLang } from '../i18n'

export interface Loaded {
  /** Either a ProseMirror JSON document or HTML to be parsed by the editor. */
  doc?: JSONContent
  html?: string
  /** The HTML carries meaningful spaces (ODF text:s, trailing spaces) that must not be collapsed. */
  preserveWhitespace?: boolean
  settings: DocSettings
  warnings: string[]
}

const decode = (d: Uint8Array) => new TextDecoder('utf-8').decode(d)

export async function loadFile(name: string, data: Uint8Array): Promise<Loaded> {
  const kind = kindOf(name)
  switch (kind) {
    case 'docx': {
      const r = await importDocx(data)
      return { doc: r.doc, settings: r.settings, warnings: r.warnings }
    }
    case 'odt': {
      const r = await importOdt(data)
      return { html: r.html, preserveWhitespace: true, settings: r.settings, warnings: r.warnings }
    }
    case 'grafi': {
      const j = JSON.parse(decode(data))
      if ((j.format !== 'grafi' && j.format !== 'worder') || !j.content) throw new Error(t('io.badGrafi'))
      return { doc: j.content, settings: normalizeSettings(j.settings), warnings: [] }
    }
    case 'html': {
      const text = decode(data)
      const dom = new DOMParser().parseFromString(text, 'text/html')
      dom.querySelectorAll('script,style,meta,link,title').forEach((n) => n.remove())
      const settings = normalizeSettings({ title: dom.title || '' })
      return { html: dom.body.innerHTML, settings, warnings: [] }
    }
    case 'md': {
      const html = await marked.parse(decode(data), { gfm: true, breaks: false })
      return { html, settings: normalizeSettings(undefined), warnings: [] }
    }
    case 'txt': {
      const text = decode(data).replace(/\r\n?/g, '\n')
      const content: JSONContent[] = text.split('\n').map((line) =>
        line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' },
      )
      return { doc: { type: 'doc', content }, settings: normalizeSettings(undefined), warnings: [] }
    }
    default:
      throw new Error(t('io.unsupportedType', { name }))
  }
}

// ───────────── serializers ─────────────
export function serializeGrafi(doc: JSONContent, settings: DocSettings): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ format: 'grafi', version: 1, settings, content: doc }))
}

function tocHtml(doc: JSONContent, maxLevel: number, pages: Map<number, number>) {
  const rows = collectHeadingsJson(doc)
    .filter((h) => h.level <= maxLevel)
    .map((h) => `<div class="toc-entry toc-l${h.level}"><span class="toc-text">${escapeHtml(h.text)}</span><span class="toc-dots"></span><span class="toc-page">${pages.get(h.pos) ?? ''}</span></div>`)
  return `<div class="toc-title">${escapeHtml(t('toc.title'))}</div>${rows.join('')}`
}

export function exportHtml(doc: JSONContent, settings: DocSettings, pages: Map<number, number>): Uint8Array {
  let body = generateHTML(doc, schemaExtensions())
  body = body.replace(/<div data-toc="" data-max-level="(\d+)" class="toc"><\/div>/g, (_m, lvl) =>
    `<div class="toc">${tocHtml(doc, Number(lvl), pages)}</div>`)
  const m = settings.margins
  const html = `<!doctype html>
<html lang="${getLang()}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Graphi">
<title>${escapeHtml(settings.title || t('io.untitled'))}</title>
<style>
body{margin:0;background:#eef1f1}
.doc-surface{max-width:${settings.width - m.left - m.right}mm;margin:24px auto;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}
@media print{body{background:#fff}.doc-surface{margin:0;padding:0;box-shadow:none;max-width:none}}
${pageCss(settings)}
${surfaceCss({ headingNumbers: settings.headingNumbers })}
</style></head>
<body><article class="doc-surface">${body}</article></body></html>`
  return new TextEncoder().encode(html)
}

export function exportText(doc: JSONContent): Uint8Array {
  const lines: string[] = []
  const walk = (n: JSONContent, prefix = '') => {
    switch (n.type) {
      case 'paragraph': case 'heading': case 'codeBlock':
        lines.push(prefix + textOf(n)); return
      case 'pageBreak': lines.push('\f'); return
      case 'horizontalRule': lines.push('―'.repeat(20)); return
      case 'bulletList': case 'taskList':
        n.content?.forEach((li) => li.content?.forEach((c, i) => walk(c, i === 0 ? `${prefix}• ` : `${prefix}  `))); return
      case 'orderedList': {
        let k = n.attrs?.start ?? 1
        n.content?.forEach((li) => { li.content?.forEach((c, i) => walk(c, i === 0 ? `${prefix}${k}. ` : `${prefix}   `)); k++ })
        return
      }
      case 'table':
        n.content?.forEach((row) => lines.push(row.content?.map((cell) => textOf(cell).replace(/\n/g, ' ')).join('\t') || ''))
        return
      default: n.content?.forEach((c) => walk(c, prefix))
    }
  }
  doc.content?.forEach((c) => walk(c))
  return new TextEncoder().encode(lines.join('\n'))
}

// ───────────── Markdown (GFM) ─────────────
function mdInline(n: JSONContent): string {
  return (n.content || [])
    .map((c) => {
      if (c.type === 'hardBreak') return '  \n'
      if (c.type === 'image') return `![${c.attrs?.alt || ''}](${c.attrs?.src})`
      if (c.type !== 'text') return ''
      let t = (c.text || '').replace(/([\\`*_[\]#<>|])/g, '\\$1')
      const marks = c.marks || []
      const has = (k: string) => marks.some((m) => m.type === k)
      if (has('code')) t = '`' + (c.text || '') + '`'
      if (has('bold')) t = `**${t}**`
      if (has('italic')) t = `*${t}*`
      if (has('strike')) t = `~~${t}~~`
      const link = marks.find((m) => m.type === 'link')
      if (link) t = `[${t}](${link.attrs?.href})`
      return t
    })
    .join('')
}

export function exportMarkdown(doc: JSONContent): Uint8Array {
  const out: string[] = []
  const block = (n: JSONContent, indent = ''): string[] => {
    switch (n.type) {
      case 'heading': return [`${'#'.repeat(n.attrs?.level || 1)} ${mdInline(n)}`]
      case 'paragraph': return [indent + mdInline(n)]
      case 'blockquote': return (n.content || []).flatMap((c) => block(c)).map((l) => `> ${l}`)
      case 'codeBlock': return ['```' + (n.attrs?.language || ''), textOf(n), '```']
      case 'horizontalRule': return ['---']
      case 'pageBreak': return ['<div style="page-break-after:always"></div>']
      case 'bulletList': case 'orderedList': case 'taskList': {
        let k = n.attrs?.start ?? 1
        return (n.content || []).flatMap((li) => {
          const marker = n.type === 'orderedList' ? `${k++}.` : n.type === 'taskList' ? `- [${li.attrs?.checked ? 'x' : ' '}]` : '-'
          const parts = (li.content || []).flatMap((c, i) =>
            (c.type || '').endsWith('List') ? block(c, indent + '   ') : i === 0 ? [`${indent}${marker} ${mdInline(c)}`] : [`${indent}   ${mdInline(c)}`])
          return parts
        })
      }
      case 'table': {
        const rows = (n.content || []).map((r) => `| ${(r.content || []).map((c) => textOf(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`)
        if (!rows.length) return []
        const cols = (n.content![0].content || []).length
        return [rows[0], `|${' --- |'.repeat(cols)}`, ...rows.slice(1)]
      }
      case 'tableOfContents': return ['[[_TOC_]]']
      default: return (n.content || []).flatMap((c) => block(c, indent))
    }
  }
  for (const n of doc.content || []) {
    const lines = block(n)
    out.push(lines.join('\n'))
  }
  return new TextEncoder().encode(out.join('\n\n') + '\n')
}

export async function serialize(kind: Kind, doc: JSONContent, settings: DocSettings, pages: Map<number, number>): Promise<Uint8Array> {
  switch (kind) {
    case 'docx': return exportDocx(doc, settings, pages)
    case 'odt': return exportOdt(doc, settings, pages)
    case 'grafi': return serializeGrafi(doc, settings)
    case 'html': return exportHtml(doc, settings, pages)
    case 'md': return exportMarkdown(doc)
    case 'txt': return exportText(doc)
    default: throw new Error(t('io.cannotSaveAs', { kind }))
  }
}
