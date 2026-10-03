// Dev-only verification harness for the pagination engine (not included in production builds).
const PARA = 'Η σελιδοποίηση πρέπει να είναι ακριβής όπως στο Word: κάθε γραμμή κειμένου ανήκει σε μία μόνο σελίδα, οι επικεφαλίδες δεν μένουν ορφανές στο τέλος μιας σελίδας και οι παράγραφοι χωρίζονται ανάμεσα σε γραμμές με έλεγχο ορφανών και χήρων γραμμών. '
const w = () => (window as any).__grafi

async function load(n = 40, extra: { tables?: boolean; lists?: boolean; breaks?: boolean; images?: boolean } = {}) {
  const content: any[] = []
  const p = (text: string, attrs: any = {}) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text }] })
  for (let i = 0; i < n; i++) {
    if (i % 6 === 0) content.push({ type: 'heading', attrs: { level: 1 + (i % 3) }, content: [{ type: 'text', text: 'Ενότητα ' + (i / 6 + 1) }] })
    content.push(p(PARA.repeat(1 + (i % 4)), { textAlign: i % 2 ? 'justify' : null }))
    if (extra.tables && i % 9 === 4) content.push({ type: 'table', content: Array.from({ length: 6 }, (_, r) => ({ type: 'tableRow', content: Array.from({ length: 3 }, (_, c) => ({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [p(`Κελί ${r}.${c}`)] })) })) })
    if (extra.lists && i % 7 === 3) content.push({ type: 'bulletList', content: Array.from({ length: 5 }, (_, k) => ({ type: 'listItem', content: [p('Στοιχείο λίστας ' + k + ' ' + PARA.slice(0, 120))] })) })
    if (extra.breaks && i % 13 === 12) content.push({ type: 'pageBreak' })
    const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#0f766e"/></svg>')
    if (extra.images && i % 10 === 5) content.push({ type: 'paragraph', content: [{ type: 'image', attrs: { src: svg, width: 400, height: 260, wrap: 'topBottom', align: 'center', shadow: 'soft' } }] })
    if (extra.images && i % 10 === 8) content.push({ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'image', attrs: { src: svg, width: 180, height: 180, wrap: 'square', align: i % 20 === 8 ? 'left' : 'right', shape: 'circle' } }, { type: 'text', text: PARA.repeat(3) }] })
  }
  w().editor.commands.setContent({ type: 'doc', content })
  await new Promise((r) => setTimeout(r, 1200))
}

/** First rendered glyph rect inside `el`, ignoring pagination spacers. */
function firstTextRect(el: Element): DOMRect | null {
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (tw.nextNode()) {
    const t = tw.currentNode as Text
    if (!t.textContent!.trim()) continue
    const r = document.createRange(); r.selectNodeContents(t)
    const rc = [...r.getClientRects()].find((x) => x.height > 0)
    if (rc) return rc
  }
  return null
}

function verify() {
  const s = w().settings
  const mm = (v: number) => (v * 96) / 25.4
  const pages = document.querySelector('.pages') as HTMLElement
  // Exact zoom from the transform (rect sizes are 1/64-px quantized → drift at y ≈ 10⁵ px).
  const m = /scale\(([\d.]+)\)/.exec(pages.style.transform)
  const scale = m ? parseFloat(m[1]) : 1
  const top0 = pages.getBoundingClientRect().top
  const P = mm(s.height) + 20, mt = mm(s.margins.top), C = mm(s.height - s.margins.top - s.margins.bottom)
  const y = (v: number) => (v - top0) / scale
  const pm = document.querySelector('.ProseMirror')!
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  const bad: any[] = []
  let n = 0
  const check = (y0: number, y1: number, what: string) => {
    n++
    const pg = Math.floor(y0 / P)
    if (y0 < pg * P + mt - 1 || y1 > pg * P + mt + C + 1) bad.push({ what, y0: Math.round(y0), y1: Math.round(y1), pg })
  }
  while (walker.nextNode()) {
    const t = walker.currentNode as Text
    if (!t.textContent!.trim()) continue
    const r = document.createRange(); r.selectNodeContents(t)
    for (const rc of r.getClientRects()) check(y(rc.top), y(rc.bottom), t.textContent!.slice(0, 24))
  }
  for (const img of pm.querySelectorAll('img:not(.ProseMirror-separator)')) { const r = img.getBoundingClientRect(); check(y(r.top), y(r.bottom), 'IMG') }
  const orphanHeadings: string[] = []
  for (const h of pm.querySelectorAll('h1,h2,h3')) {
    const next = h.nextElementSibling; if (!next) continue
    const hText = firstTextRect(h) || h.getBoundingClientRect()
    const pgH = Math.floor(y(hText.top) / P)
    const first = firstTextRect(next) || next.getBoundingClientRect()
    if (Math.floor(y(first.top) / P) !== pgH) orphanHeadings.push(h.textContent!)
  }
  const tablesSplit = [...pm.querySelectorAll('.tableWrapper')].filter((t) => { const r = t.getBoundingClientRect(); return Math.floor(y(r.top) / P) !== Math.floor((y(r.bottom) - 1) / P) }).length
  return { checked: n, badCount: bad.length, bad: bad.slice(0, 5), orphanHeadings, tablesSplit, pages: w().layoutStore.pageCount, sheets: document.querySelectorAll('.page-sheet').length }
}

/**
 * Floating pictures (floats.ts): each one's pinned spot (`page/x/y`, x empty = aligned) and where it is
 * really drawn (`page/x/y/in|OUT` of its page's text area), plus the text check and how the layout settled.
 */
function floats() {
  const s = w().settings
  const mm = (v: number) => (v * 96) / 25.4
  const P = mm(s.height) + 20, C = mm(s.height - s.margins.top - s.margins.bottom)
  const pm = w().editor.view.dom as HTMLElement
  const r = pm.getBoundingClientRect(), z = r.height / pm.offsetHeight
  const attrs: string[] = []
  w().editor.state.doc.descendants((n: any) => { if (n.type.name === 'image' && n.attrs.wrap) attrs.push([n.attrs.page, n.attrs.x, n.attrs.y].join('/')) })
  const drawn = [...pm.querySelectorAll('.wpic-carrier .wpic')].map((el) => {
    const b = el.getBoundingClientRect()
    const top = (b.top - r.top) / z, left = (b.left - r.left) / z, pg = Math.floor((top + 0.5) / P), y = top - pg * P
    return [pg, Math.round(left * 10) / 10, Math.round(y * 10) / 10, y >= -0.5 && y + b.height / z <= C + 0.5 ? 'in' : 'OUT'].join('/')
  })
  const v = verify()
  return { attrs: attrs.join('  '), drawn: drawn.join('  '), bad: v.badCount, pages: v.pages, rounds: w().layoutStore.lastLayoutRounds, ms: Math.round(w().layoutStore.lastLayoutMs) }
}

/** `n` paragraphs with a square-wrapped picture (in the 4th) and a top-and-bottom one (in the 9th), caret at the start. */
async function loadFloats(n = 30) {
  const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><rect width="200" height="140" fill="#0f766e"/></svg>')
  const content = Array.from({ length: n }, (_, i) => {
    const c: any[] = [{ type: 'text', text: `${i + 1}. ` + PARA.repeat(2) }]
    if (i === 3) c.unshift({ type: 'image', attrs: { src: svg, width: 200, height: 140, wrap: 'square', align: 'right' } })
    if (i === 8) c.unshift({ type: 'image', attrs: { src: svg, width: 300, height: 100, wrap: 'topBottom', align: 'center' } })
    return { type: 'paragraph', content: c }
  })
  w().editor.commands.setContent({ type: 'doc', content })
  w().editor.commands.setTextSelection(1)
  await new Promise((r) => setTimeout(r, 1000))
  return floats()
}

/** Drags floating picture `i` (document order of the drawn pictures) by (dx, dy) page px, as the mouse would. */
async function dragPic(i: number, dx: number, dy: number) {
  const el = document.querySelectorAll<HTMLElement>('.wpic-carrier .wpic')[i]
  el.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 50))
  const r = el.getBoundingClientRect(), z = r.width / el.offsetWidth
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2
  const at = (x: number, y: number) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse', isPrimary: true, pointerId: 1 })
  el.dispatchEvent(new PointerEvent('pointerdown', at(x0, y0)))
  for (let k = 1; k <= 8; k++) window.dispatchEvent(new PointerEvent('pointermove', at(x0 + (dx * z * k) / 8, y0 + (dy * z * k) / 8)))
  window.dispatchEvent(new PointerEvent('pointerup', at(x0 + dx * z, y0 + dy * z)))
  await new Promise((r) => setTimeout(r, 400))
  return floats()
}

Object.assign(window, { __load: load, __verify: verify, __floats: floats, __dragPic: dragPic, __loadFloats: loadFloats })
export {}
