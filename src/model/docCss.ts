// CSS for the document surface. Generated at runtime (it depends on page settings) and
// shared by the editor, print/PDF output and standalone HTML export.
import { fontStack, stylesCss, DEFAULT_FONT, lineHeightCss, PARA_STYLES, bodyFont, headingStyle } from './styles'
import type { DocSettings, HFAlign } from './settings'
import { themeVarsCss, currentTheme, tintShade } from './themes'
import { t, fmtDate } from '../i18n'
import { tableStylesCss } from './tableStyles'

const S = '.doc-surface'

export function surfaceCss(opts: { headingNumbers?: boolean } = {}): string {
  const normal = PARA_STYLES[0]
  const th = currentTheme
  return `${S}{${themeVarsCss(th)}}
${S}{counter-reset:wfig wtab${opts.headingNumbers ? ' wh1 wh2 wh3 wh4 wh5 wh6' : ''}}
${opts.headingNumbers ? headingNumberCss() : ''}
${S}{font-family:${fontStack(bodyFont())};font-size:${normal.sizePt}pt;line-height:${lineHeightCss(normal.lineHeight)};color:#000;
  font-kerning:normal;font-variant-ligatures:common-ligatures;tab-size:0.5in;-moz-tab-size:0.5in;
  word-wrap:break-word;overflow-wrap:break-word;white-space:pre-wrap;white-space:break-spaces;hyphens:manual;outline:none;caret-color:#000}
${S} *{box-sizing:border-box}
${stylesCss(S)}
${captionCss()}
${S} p:first-child,${S} h1:first-child,${S} h2:first-child,${S} h3:first-child{margin-top:0}
${S} strong{font-weight:700}
${S} a{color:var(--th-hlink);text-decoration:underline}
${S} sub,${S} sup{font-size:65%;line-height:0}
${S} code{font-family:${fontStack('Courier New')};font-size:0.92em;background:#f1f3f3;padding:0 2px;border-radius:2px}
${S} pre{font-family:${fontStack('Courier New')};font-size:10pt;line-height:1.2;background:#f4f6f6;border:1px solid #e2e8e8;padding:6pt 8pt;margin:0 0 8pt;white-space:pre-wrap;border-radius:3px}
${S} pre code{background:none;padding:0;font-size:inherit}
${S} blockquote{margin:10pt 0 8pt;padding:0 0 0 12pt;border-left:3px solid var(--th-accent1-l60);color:#404040;font-style:italic}
${S} blockquote p{margin-bottom:4pt}
${S} hr{border:none;border-top:1px solid #a6b5b5;margin:0;padding:6pt 0 0;height:7pt;box-sizing:content-box}
${S} img{max-width:100%;vertical-align:bottom}
/* A wrapped picture is drawn by a carrier at the line beside its spot on the page (floats.ts); like in
   Word, text of the following paragraphs wraps around it too — so a paragraph must not contain it
   (no flow-root / BFC). Its node is an empty anchor. */
${S} .wpic-carrier{display:contents}
${S} .wpic.lifted{display:none !important}
.fl-measuring .wpic{pointer-events:none}
${S} ul,${S} ol{margin:0 0 0 0;padding-left:0.5in}
${S} li{margin:0}
${S} li > p{margin-top:0;margin-bottom:0}
${S} li:last-child > p:last-child{margin-bottom:0}
${S} ul + p,${S} ol + p{margin-top:${normal.spaceAfterPt}pt}
${S} ul{list-style-type:disc}
${S} ul ul{list-style-type:circle}
${S} ul ul ul{list-style-type:square}
${S} ol{list-style-type:decimal}
${S} ol ol{list-style-type:lower-alpha}
${S} ol ol ol{list-style-type:lower-roman}
${S} ol[data-list-style="lower-alpha"]{list-style-type:lower-alpha}
${S} ol[data-list-style="upper-alpha"]{list-style-type:upper-alpha}
${S} ol[data-list-style="lower-roman"]{list-style-type:lower-roman}
${S} ol[data-list-style="upper-roman"]{list-style-type:upper-roman}
${S} ol[data-list-style="lower-greek"]{list-style-type:lower-greek}
${S} ol[data-list-style="decimal-paren"]{list-style-type:none;counter-reset:wlist calc(var(--start,1) - 1)}
${S} ol[data-list-style="decimal-paren"] > li{counter-increment:wlist}
${S} ol[data-list-style="decimal-paren"] > li::before{content:counter(wlist) ")";position:absolute;margin-left:-0.3in}
${S} ul[data-list-style="circle"]{list-style-type:circle}
${S} ul[data-list-style="square"]{list-style-type:square}
${S} ul[data-list-style="dash"]{list-style-type:"–  "}
${S} ul[data-list-style="arrow"]{list-style-type:"➢  "}
${S} ul[data-list-style="check"]{list-style-type:"✓  "}
${S} ul[data-type="taskList"]{list-style:none;padding-left:0.25in}
${S} ul[data-type="taskList"] li{display:flex;gap:6px;align-items:flex-start}
${S} ul[data-type="taskList"] li > label{flex:0 0 auto;user-select:none;margin-top:0.15em}
${S} ul[data-type="taskList"] li > div{flex:1 1 auto;min-width:0}
${S} ul[data-type="taskList"] li[data-checked="true"] > div{text-decoration:line-through;color:#6b7b7b}
${S} ul[data-type="taskList"] input[type=checkbox]{accent-color:var(--th-accent1);width:1em;height:1em;margin:0}
${S} .tableWrapper{margin:0;padding:0 0 ${normal.spaceAfterPt}pt;overflow-x:auto}
${S} table{border-collapse:collapse;table-layout:fixed;width:100%;margin:0}
${S} td,${S} th{border:1px solid #7f8c8c;padding:2pt 5.4pt;vertical-align:top;position:relative;min-width:1em}
${S} th{background:${tableHeaderFill(th.colors.accent1)};font-weight:700;text-align:left}
${S} td > p,${S} th > p{margin:0}
${tableStylesCss(S)}
${S} .toc{margin:0;padding:0 0 ${normal.spaceAfterPt}pt;user-select:none}
${S} .toc-title{font-family:${fontStack(headingStyle(1).font || bodyFont())};font-size:${headingStyle(1).sizePt}pt;color:${headingStyle(1).color || '#000'};font-weight:${headingStyle(1).bold ? 700 : 400};margin:0 0 6pt}
${S} .toc-entry{display:flex;align-items:baseline;gap:4px;margin:0 0 5pt;cursor:pointer}
${S} .toc-entry:hover .toc-text{text-decoration:underline}
${S} .toc-l2{padding-left:11pt}${S} .toc-l3{padding-left:22pt}${S} .toc-l4{padding-left:33pt}${S} .toc-l5{padding-left:44pt}${S} .toc-l6{padding-left:55pt}
${S} .toc-dots{flex:1 1 auto;border-bottom:1.5px dotted #666;transform:translateY(-3px);min-width:12px}
${S} .toc-page{flex:0 0 auto}
${S} .toc-empty{color:#6b7b7b;font-style:italic}
${S} .page-break{height:0;margin:0;padding:0;border:none;position:relative}
${S} .pg-spacer{display:block;margin:0;padding:0;border:0;pointer-events:none;user-select:none}
.pg-measuring .pg-spacer{display:none !important}
.pg-measuring .pg-pad{padding-top:var(--pg-base,0px) !important}
`
}

/** Default fill of table header cells: a very light tint of Accent 1 (also used by exporters). */
export const HEADER_TINT = 88
export const tableHeaderFill = (accent1 = currentTheme.colors.accent1) => tintShade(accent1, HEADER_TINT)

/** Heading numbering + caption numbering via CSS counters (live, no document changes). */
function headingNumberCss(): string {
  const r: string[] = []
  for (let l = 1; l <= 6; l++) {
    // counter-set (not counter-reset): resets the same document-level counter instead of nesting a new one.
    const deeper = Array.from({ length: 6 - l }, (_, i) => `wh${l + i + 1} 0`).join(' ')
    const content = Array.from({ length: l }, (_, i) => `counter(wh${i + 1})`).join(' "." ')
    r.push(`${S} h${l}{counter-increment:wh${l}${deeper ? `;counter-set:${deeper}` : ''}}`)
    r.push(`${S} h${l}::before{content:${content} "\\00a0\\00a0\\00a0";font-style:normal}`)
  }
  return r.join('\n')
}

const captionCss = () => `${S} p[data-caption="figure"]{counter-increment:wfig}
${S} p[data-caption="table"]{counter-increment:wtab}
${S} p[data-caption="figure"]::before{content:${cssStr(t('caption.figure') + ' ')} counter(wfig) ": "}
${S} p[data-caption="table"]::before{content:${cssStr(t('caption.table') + ' ')} counter(wtab) ": "}`

const cssStr = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function hfContent(text: string, title: string): string {
  if (!text) return 'none'
  const parts: string[] = []
  const re = /\{(page|pages|date|title)\}/g
  let last = 0
  let m: RegExpExecArray | null
  const str = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(str(text.slice(last, m.index)))
    if (m[1] === 'page') parts.push('counter(page)')
    else if (m[1] === 'pages') parts.push('counter(pages)')
    else if (m[1] === 'date') parts.push(str(fmtDate()))
    else parts.push(str(title))
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(str(text.slice(last)))
  return parts.join(' ') || 'none'
}

const box = (pos: 'top' | 'bottom', a: HFAlign) => `@${pos}-${a === 'left' ? 'left' : a === 'right' ? 'right' : 'center'}`

/** @page rules (size, margins, header/footer margin boxes with live page counters). */
export function pageCss(s: DocSettings): string {
  const m = s.margins
  const hf = s.hf
  const font = `font-family:${fontStack(DEFAULT_FONT)};font-size:10pt;color:#555`
  const header = hf.headerText ? `${box('top', hf.headerAlign)}{content:${hfContent(hf.headerText, s.title)};${font};vertical-align:bottom;padding-bottom:${Math.max(0, m.top - hf.headerDistance - 5)}mm}` : ''
  const footer = hf.footerText ? `${box('bottom', hf.footerAlign)}{content:${hfContent(hf.footerText, s.title)};${font};vertical-align:top;padding-top:${Math.max(0, m.bottom - hf.footerDistance - 5)}mm}` : ''
  const first = hf.differentFirstPage
    ? `@page :first{${hf.headerText ? `${box('top', hf.headerAlign)}{content:none}` : ''}${hf.footerText ? `${box('bottom', hf.footerAlign)}{content:none}` : ''}}`
    : ''
  // Exact text width in print: engines map CSS px to paper differently (Chromium 96 dpi,
  // iOS WebKit scales to the printable rect) — a fixed width keeps line breaks identical.
  const textW = s.width - m.left - m.right
  const lock = `@media print{.doc-surface{width:${textW}mm !important;max-width:${textW}mm !important}}`
  return `@page{size:${s.width}mm ${s.height}mm;margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;${header}${footer}}${first}${lock}`
}

/** Print-only rules: hide the app chrome and let the paginated column flow onto real pages. */
export function printCss(paginated: boolean): string {
  return `@media print{
  html,body,#root{background:#fff !important;margin:0 !important;padding:0 !important;height:auto !important;overflow:visible !important}
  .app-chrome,.no-print,.page-sheet,.page-hf,.hf-hit,.ruler-bar,.vruler,.findbar,.toasts{display:none !important}
  .app,.workspace,.canvas-scroll,.canvas-zoom,.pages,.editor-column{display:block !important;position:static !important;
    width:auto !important;height:auto !important;min-height:0 !important;max-height:none !important;margin:0 !important;padding:0 !important;
    transform:none !important;overflow:visible !important;background:none !important;box-shadow:none !important}
  ${S}{caret-color:transparent}
  ${S} .pg-spacer{height:0 !important;${paginated ? 'break-before:page;' : 'display:none !important;'}}
  ${S} .pg-top{${paginated ? 'margin-top:0 !important;padding-top:0 !important;' : ''}}
  ${S} .pg-pad{${paginated ? 'break-before:page;' : ''}}
  ${S} .pg-odd{${paginated ? 'break-before:right !important;' : ''}}
  ${S} .pg-even{${paginated ? 'break-before:left !important;' : ''}}
  ${S} .page-break{${paginated ? '' : 'break-after:page;'}}
  ${S} .page-break[data-break=continuous]{break-after:auto}
  ${S} p,${S} li{orphans:2;widows:2}
  ${S} h1,${S} h2,${S} h3,${S} h4,${S} h5,${S} h6{break-after:avoid}
  ${S} tr,${S} img{break-inside:avoid}
  ${S} .search-hit{background:none !important}
  ${S} .ProseMirror-selectednode{outline:none !important}
  ${S} .column-resize-handle,${S} [data-resize-handle]{display:none !important}
  ${S} .is-editor-empty::before{display:none !important}
}`
}
