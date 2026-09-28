// Starter templates for File ▸ New. Each is a real, well-designed document (not lorem
// scaffolding) and the File screen renders a live miniature of it as the thumbnail.
import type { JSONContent } from '@tiptap/core'
import type { DocSettings } from './settings'
import { t as L, fmtLongDate } from '../i18n'

type Marks = JSONContent['marks']
const t = (text: string, marks?: Marks): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const color = (c: string, extra: Marks = []): Marks => [...(extra || []), { type: 'textStyle', attrs: { color: c } }]
const bold: Marks = [{ type: 'bold' }]
const p = (content: string | JSONContent[] = '', attrs: Record<string, unknown> = {}): JSONContent =>
  typeof content === 'string'
    ? content ? { type: 'paragraph', attrs, content: [t(content)] } : { type: 'paragraph', attrs }
    : { type: 'paragraph', attrs, content }
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const bullets = (items: (string | JSONContent[])[]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const numbered = (items: string[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const hr: JSONContent = { type: 'horizontalRule' }
const cell = (content: string | JSONContent[], attrs: Record<string, unknown> = {}, header = false): JSONContent =>
  ({ type: header ? 'tableHeader' : 'tableCell', attrs, content: [typeof content === 'string' ? p(content) : p(content)] })
const table = (rows: JSONContent[][]): JSONContent => ({ type: 'table', content: rows.map((r) => ({ type: 'tableRow', content: r })) })
const today = () => fmtLongDate()

/** Soft brand-coloured placeholder picture (replace via the Picture tab). */
const placeholder = (w: number, h: number, label: string) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1AB3AC"/><stop offset="1" stop-color="#A5EBE7"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.78}" cy="${h * 0.3}" r="${h * 0.12}" fill="#FDE68A"/><path d="M0 ${h} L${w * 0.35} ${h * 0.5} L${w * 0.58} ${h * 0.78} L${w * 0.72} ${h * 0.62} L${w} ${h} Z" fill="#117470" opacity=".85"/><text x="${w / 2}" y="${h * 0.93}" text-anchor="middle" font-family="Arial" font-size="${Math.round(h * 0.07)}" fill="#fff">${label}</text></svg>`)

/** Names, descriptions, settings and content are read at use time, in the current UI language. */
export interface Template { id: string; readonly name: string; readonly description: string; doc: () => JSONContent; readonly settings?: Partial<DocSettings> }

export const TEMPLATES: Template[] = [
  { id: 'blank', get name() { return L('tpl.blank.name') }, get description() { return L('tpl.blank.desc') }, doc: () => ({ type: 'doc', content: [p()] }) },

  {
    id: 'letter', get name() { return L('tpl.letter.name') }, get description() { return L('tpl.letter.desc') },
    get settings(): Partial<DocSettings> { return { styleSet: 'teal', margins: { top: 20, right: 22, bottom: 20, left: 22 } } },
    doc: () => ({
      type: 'doc',
      content: [
        p([t(L('tpl.fullName'), color('#117470', bold)), t('  ·  ' + L('tpl.letter.jobTitle'), color('#5A6B6B'))], { spaceAfter: 0 }),
        p([t(L('tpl.letter.contact'), color('#5A6B6B'))], { styleId: 'NoSpacing' }),
        hr,
        p(today(), { textAlign: 'right', spaceBefore: 12 }),
        p([t(L('tpl.letter.to'), bold)], { styleId: 'NoSpacing' }),
        p(L('tpl.letter.recipient'), { styleId: 'NoSpacing' }),
        p(L('tpl.letter.recipientAddress'), { styleId: 'NoSpacing', spaceAfter: 14 }),
        p([t(L('tpl.letter.subject'), bold), t(L('tpl.letter.subjectText'))], { spaceAfter: 14 }),
        p(L('tpl.letter.salutation')),
        p(L('tpl.letter.p1'), { textAlign: 'justify' }),
        p(L('tpl.letter.p2'), { textAlign: 'justify' }),
        p(L('tpl.letter.p3'), { textAlign: 'justify', spaceAfter: 18 }),
        p(L('tpl.letter.closing'), { spaceAfter: 30 }),
        p([t(L('tpl.fullName'), bold)], { styleId: 'NoSpacing' }),
        p([t(L('tpl.letter.jobTitle'), color('#5A6B6B'))], { styleId: 'NoSpacing' }),
      ],
    }),
  },

  {
    id: 'report', get name() { return L('tpl.report.name') }, get description() { return L('tpl.report.desc') },
    get settings(): Partial<DocSettings> { return {
      title: L('tpl.report.docTitle'), headingNumbers: true,
      hf: { headerText: '{title}', headerAlign: 'right', footerText: L('pn.xOfYField'), footerAlign: 'center', differentFirstPage: true, headerDistance: 12.5, footerDistance: 12.5 },
    } },
    doc: () => ({
      type: 'doc',
      content: [
        p('', { spaceBefore: 150 }),
        p([t(L('tpl.report.org'), color('#13928C', bold))], { styleId: 'NoSpacing' }),
        p(L('tpl.report.docTitle'), { styleId: 'Title' }),
        p(L('tpl.report.subtitle'), { styleId: 'Subtitle' }),
        hr,
        p([t(L('tpl.report.author'), bold), t(L('tpl.fullName'))], { styleId: 'NoSpacing' }),
        p([t(L('tpl.report.date'), bold), t(today())], { styleId: 'NoSpacing' }),
        { type: 'pageBreak' },
        { type: 'tableOfContents', attrs: { maxLevel: 2 } },
        { type: 'pageBreak' },
        h(1, L('tpl.report.summary')),
        p(L('tpl.report.summaryText'), { textAlign: 'justify' }),
        h(1, L('tpl.report.goals')),
        bullets([[t(L('tpl.report.growth'), bold), t(L('tpl.report.growthText'))], [t(L('tpl.report.quality'), bold), t(L('tpl.report.qualityText'))], [t(L('tpl.report.team'), bold), t(L('tpl.report.teamText'))]]),
        h(1, L('tpl.report.results')),
        h(2, L('tpl.report.kpis')),
        p(L('tpl.report.caption'), { styleId: 'Caption', captionKind: 'table', keepNext: true }),
        table([
          [cell(L('tpl.report.metric'), {}, true), cell(L('tpl.report.target'), {}, true), cell(L('tpl.report.actual'), {}, true)],
          [cell(L('tpl.report.newCustomers')), cell('+20%'), cell('+24%', { backgroundColor: '#D3F6F4' })],
          [cell(L('tpl.report.satisfaction')), cell('90%'), cell('92%', { backgroundColor: '#D3F6F4' })],
          [cell(L('tpl.report.responseTime')), cell(L('tpl.report.under24h')), cell(L('tpl.report.18h'), { backgroundColor: '#D3F6F4' })],
        ]),
        h(2, L('tpl.report.analysis')),
        p(L('tpl.report.analysisText'), { textAlign: 'justify' }),
        h(1, L('tpl.report.next')),
        numbered([L('tpl.report.next1'), L('tpl.report.next2'), L('tpl.report.next3')]),
      ],
    }),
  },

  {
    id: 'cv', get name() { return L('tpl.cv.name') }, get description() { return L('tpl.cv.desc') },
    get settings(): Partial<DocSettings> { return { styleSet: 'modern', margins: { top: 16, right: 18, bottom: 16, left: 18 } } },
    doc: () => ({
      type: 'doc',
      content: [
        p(L('tpl.cv.person'), { styleId: 'Title' }),
        p([t('Senior Product Designer', color('#117470', bold))], { spaceAfter: 2 }),
        p([t(L('tpl.cv.contact'), color('#5A6B6B'))], { styleId: 'NoSpacing' }),
        hr,
        h(1, L('tpl.cv.profile')),
        p(L('tpl.cv.profileText'), { textAlign: 'justify' }),
        h(1, L('tpl.cv.experience')),
        p([t('Senior Product Designer', bold), t(L('tpl.cv.companyA'), color('#117470')), t(L('tpl.cv.present'), color('#5A6B6B'))], { spaceAfter: 2 }),
        bullets([L('tpl.cv.a1'), L('tpl.cv.a2')]),
        p([t('Product Designer', bold), t(L('tpl.cv.companyB'), color('#117470')), t('    2017 – 2021', color('#5A6B6B'))], { spaceAfter: 2, spaceBefore: 6 }),
        bullets([L('tpl.cv.b1'), L('tpl.cv.b2')]),
        h(1, L('tpl.cv.education')),
        p([t(L('tpl.cv.degree'), bold), t(L('tpl.cv.university'), color('#117470')), t('    2017', color('#5A6B6B'))]),
        h(1, L('tpl.cv.skills')),
        table([
          [cell([t(L('tpl.cv.design'), bold)]), cell('Figma, prototyping, design systems')],
          [cell([t(L('tpl.cv.research'), bold)]), cell(L('tpl.cv.researchText'))],
          [cell([t(L('tpl.cv.languages'), bold)]), cell(L('tpl.cv.languagesText'))],
        ]),
      ],
    }),
  },

  {
    id: 'minutes', get name() { return L('tpl.minutes.name') }, get description() { return L('tpl.minutes.desc') },
    doc: () => ({
      type: 'doc',
      content: [
        p(L('tpl.minutes.title'), { styleId: 'Title' }),
        p(L('tpl.minutes.subtitle'), { styleId: 'Subtitle' }),
        table([
          [cell([t(L('tpl.date'), bold)], { backgroundColor: '#EFFCFB' }), cell(today()), cell([t(L('tpl.minutes.time'), bold)], { backgroundColor: '#EFFCFB' }), cell('10:00 – 11:00')],
          [cell([t(L('tpl.minutes.place'), bold)], { backgroundColor: '#EFFCFB' }), cell(L('tpl.minutes.room')), cell([t(L('tpl.minutes.secretary'), bold)], { backgroundColor: '#EFFCFB' }), cell(L('tpl.fullName'))],
        ]),
        h(2, L('tpl.minutes.attendees')),
        p(L('tpl.minutes.attendeesText')),
        h(2, L('tpl.minutes.agenda')),
        numbered([L('tpl.minutes.ag1'), L('tpl.minutes.ag2'), L('tpl.minutes.ag3')]),
        h(2, L('tpl.minutes.decisions')),
        bullets([L('tpl.minutes.d1'), L('tpl.minutes.d2')]),
        h(2, L('tpl.minutes.actions')),
        table([
          [cell(L('tpl.minutes.action'), {}, true), cell(L('tpl.minutes.owner'), {}, true), cell(L('tpl.minutes.due'), {}, true), cell(L('tpl.minutes.status'), {}, true)],
          [cell(L('tpl.minutes.act1')), cell(L('tpl.minutes.owner1')), cell(L('tpl.minutes.friday')), cell([t(L('tpl.minutes.inProgress'), color('#B45309', bold))])],
          [cell(L('tpl.minutes.act2')), cell(L('tpl.minutes.owner2')), cell(L('tpl.minutes.monday')), cell([t(L('tpl.minutes.completed'), color('#15803D', bold))])],
        ]),
      ],
    }),
  },

  {
    id: 'invoice', get name() { return L('tpl.invoice.name') }, get description() { return L('tpl.invoice.desc') },
    get settings(): Partial<DocSettings> { return { margins: { top: 18, right: 20, bottom: 18, left: 20 } } },
    doc: () => ({
      type: 'doc',
      content: [
        table([
          [cell([t(L('tpl.invoice.company'), color('#117470', bold))]), cell([t(L('tpl.invoice.quote'), color('#1AB3AC', bold))], {})],
          [cell([t(L('tpl.invoice.companyInfo'), color('#5A6B6B'))]), cell([t(L('tpl.invoice.number', { date: today() }), color('#5A6B6B'))])],
        ]),
        p('', { spaceAfter: 4 }),
        p([t(L('tpl.invoice.to'), bold), t(L('tpl.invoice.toText'))]),
        table([
          [cell(L('tpl.invoice.description'), {}, true), cell(L('tpl.invoice.qty'), {}, true), cell(L('tpl.invoice.unitPrice'), {}, true), cell(L('tpl.invoice.total'), {}, true)],
          [cell(L('tpl.invoice.item1')), cell('1'), cell(L('tpl.invoice.p1200')), cell(L('tpl.invoice.p1200'))],
          [cell(L('tpl.invoice.item2')), cell('1'), cell(L('tpl.invoice.p2400')), cell(L('tpl.invoice.p2400'))],
          [cell(L('tpl.invoice.item3')), cell('12'), cell(L('tpl.invoice.p50')), cell(L('tpl.invoice.p600'))],
          [cell(''), cell(''), cell([t(L('tpl.invoice.net'), bold)], { backgroundColor: '#EFFCFB' }), cell(L('tpl.invoice.p4200'), { backgroundColor: '#EFFCFB' })],
          [cell(''), cell(''), cell([t(L('tpl.invoice.vat'), bold)], { backgroundColor: '#EFFCFB' }), cell(L('tpl.invoice.p1008'), { backgroundColor: '#EFFCFB' })],
          [cell(''), cell(''), cell([t(L('tpl.invoice.total'), color('#FFFFFF', bold))], { backgroundColor: '#1AB3AC' }), cell([t(L('tpl.invoice.p5208'), color('#FFFFFF', bold))], { backgroundColor: '#1AB3AC' })],
        ]),
        h(3, L('tpl.invoice.terms')),
        bullets([L('tpl.invoice.t1'), L('tpl.invoice.t2'), L('tpl.invoice.t3')]),
        p('', { spaceBefore: 18 }),
        p([t(L('tpl.invoice.forCompany'), color('#5A6B6B'))]),
      ],
    }),
  },

  {
    id: 'school', get name() { return L('tpl.school.name') }, get description() { return L('tpl.school.desc') },
    get settings(): Partial<DocSettings> { return { styleSet: 'fresh', headingNumbers: true, hf: { headerText: '', headerAlign: 'center', footerText: '{page}', footerAlign: 'center', differentFirstPage: true, headerDistance: 12.5, footerDistance: 12.5 } } },
    doc: () => ({
      type: 'doc',
      content: [
        p('', { spaceBefore: 120 }),
        p(L('tpl.school.title'), { styleId: 'Title', textAlign: 'center' }),
        p(L('tpl.school.subtitle'), { styleId: 'Subtitle', textAlign: 'center' }),
        { type: 'paragraph', attrs: { textAlign: 'center', spaceBefore: 18 }, content: [{ type: 'image', attrs: { src: placeholder(480, 300, L('tpl.school.cover')), width: 360, height: 225, wrap: 'topBottom', align: 'center', shape: 'rounded', shadow: 'soft' } }] },
        p([t(L('tpl.school.student'), bold), t(L('tpl.fullName'))], { textAlign: 'center', spaceBefore: 24, styleId: 'NoSpacing' }),
        p([t(L('tpl.school.teacher'), bold), t(L('tpl.fullName'))], { textAlign: 'center', styleId: 'NoSpacing' }),
        p(today(), { textAlign: 'center', styleId: 'NoSpacing' }),
        { type: 'pageBreak' },
        h(1, L('tpl.school.intro')),
        p(L('tpl.school.introText'), { textAlign: 'justify' }),
        h(1, L('tpl.school.body')),
        h(2, L('tpl.school.sec1')),
        p(L('tpl.school.sec1Text'), { textAlign: 'justify' }),
        h(2, L('tpl.school.sec2')),
        p(L('tpl.school.sec2Text'), { textAlign: 'justify' }),
        h(1, L('tpl.school.conclusions')),
        p(L('tpl.school.conclusionsText'), { textAlign: 'justify' }),
        h(1, L('tpl.school.sources')),
        numbered([L('tpl.school.src1'), L('tpl.school.src2')]),
      ],
    }),
  },

  {
    id: 'flyer', get name() { return L('tpl.flyer.name') }, get description() { return L('tpl.flyer.desc') },
    get settings(): Partial<DocSettings> { return { styleSet: 'fresh', margins: { top: 15, right: 15, bottom: 15, left: 15 } } },
    doc: () => ({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'image', attrs: { src: placeholder(800, 380, L('tpl.flyer.image')), width: 680, height: 323, wrap: 'topBottom', align: 'center', shape: 'rounded' } }] },
        p([t(L('tpl.flyer.when'), color('#13928C', bold))], { textAlign: 'center', spaceBefore: 8 }),
        p(L('tpl.flyer.title'), { styleId: 'Title', textAlign: 'center' }),
        p(L('tpl.flyer.subtitle'), { styleId: 'Subtitle', textAlign: 'center' }),
        hr,
        table([
          [cell([t(L('tpl.flyer.where'), color('#117470', bold))]), cell([t(L('tpl.flyer.entry'), color('#117470', bold))]), cell([t(L('tpl.flyer.info'), color('#117470', bold))])],
          [cell(L('tpl.flyer.venue')), cell(L('tpl.flyer.free')), cell('210 000 0000')],
        ]),
        p(L('tpl.flyer.seeYou'), { textAlign: 'center', spaceBefore: 16, styleId: 'Quote' }),
      ],
    }),
  },
]
