// Descriptive, colourful command icons ("show the result", Canva-style) for the ribbon.
// Each is a 32×32 SVG built from a few shared primitives so the set stays consistent.
import type { ReactElement } from 'react'

const C = {
  primary: '#1AB3AC', dark: '#117470', light: '#D3F6F4', paper: '#FFFFFF', edge: '#9DB4B3', line: '#B9C9C8',
  ink: '#243B3A', // on the ribbon background (lightened in dark theme)
  inkP: '#253C3B', // on paper / light tiles (never changes)
  orange: '#F59E0B', pink: '#EC4899', blue: '#3B82F6', sky: '#BFE3FF', red: '#EF4444',
  purple: '#8B5CF6', yellow: '#FDE047', green: '#22C55E',
}

const Page = ({ x = 7, y = 3, w = 18, h = 26, fill = C.paper }: { x?: number; y?: number; w?: number; h?: number; fill?: string }) => (
  <rect x={x} y={y} width={w} height={h} rx={2} fill={fill} stroke={C.edge} strokeWidth={1.2} />
)
const Lines = ({ x = 10, y = 8, w = 12, n = 5, gap = 3.4, color = C.line }: { x?: number; y?: number; w?: number; n?: number; gap?: number; color?: string }) => (
  <>{Array.from({ length: n }, (_, i) => <rect key={i} x={x} y={y + i * gap} width={i === n - 1 ? w * 0.6 : w} height={1.6} rx={0.8} fill={color} />)}</>
)
const Grid = ({ x = 4, y = 7, w = 24, h = 18, header = C.primary, cells }: { x?: number; y?: number; w?: number; h?: number; header?: string; cells?: [number, number, string][] }) => (
  <>
    <rect x={x} y={y} width={w} height={h} rx={2} fill={C.paper} stroke={C.edge} strokeWidth={1.2} />
    <rect x={x} y={y} width={w} height={h / 3} rx={2} fill={header} />
    {cells?.map(([cx, cy, f], i) => <rect key={i} x={x + (cx * w) / 3} y={y + (cy * h) / 3} width={w / 3} height={h / 3} fill={f} />)}
    <path d={`M${x + w / 3} ${y}v${h}M${x + (2 * w) / 3} ${y}v${h}M${x} ${y + h / 3}h${w}M${x} ${y + (2 * h) / 3}h${w}`} stroke={C.edge} strokeWidth={1} />
  </>
)
const Photo = ({ x = 4, y = 6, w = 24, h = 20, clip }: { x?: number; y?: number; w?: number; h?: number; clip?: string }) => (
  <g clipPath={clip}>
    <rect x={x} y={y} width={w} height={h} rx={clip ? 0 : 3} fill={C.sky} />
    <circle cx={x + w * 0.72} cy={y + h * 0.3} r={h * 0.13} fill={C.yellow} />
    <path d={`M${x} ${y + h}L${x + w * 0.35} ${y + h * 0.45}L${x + w * 0.6} ${y + h * 0.75}L${x + w * 0.75} ${y + h * 0.6}L${x + w} ${y + h}Z`} fill={C.green} />
    {!clip && <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke={C.edge} strokeWidth={1.2} />}
  </g>
)
const Badge = ({ cx, cy, r = 5, fill = C.primary, children }: { cx: number; cy: number; r?: number; fill?: string; children?: ReactElement | string }) => (
  <g><circle cx={cx} cy={cy} r={r} fill={fill} stroke="#fff" strokeWidth={1.2} />
    {typeof children === 'string' ? <text x={cx} y={cy + 2.6} textAnchor="middle" fontSize={r * 1.3} fontWeight={800} fill="#fff" fontFamily="Arial, sans-serif">{children}</text> : children}</g>
)
const Plus = ({ cx, cy }: { cx: number; cy: number }) => <Badge cx={cx} cy={cy} r={5}><path d={`M${cx - 2.6} ${cy}h5.2M${cx} ${cy - 2.6}v5.2`} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" /></Badge>
const SERIF = "Georgia, 'Times New Roman', serif"
const SANS = "-apple-system, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
const Glyph = ({ t, color = C.ink, size = 18, y = 22, italic, underline, weight = 800, sans }: { t: string; color?: string; size?: number; y?: number; italic?: boolean; underline?: boolean; weight?: number; sans?: boolean }) => (
  <text x={16} y={y} textAnchor="middle" fontSize={size} fontWeight={weight} fontStyle={italic ? 'italic' : 'normal'} textDecoration={underline ? 'underline' : 'none'} fill={color} fontFamily={sans ? SANS : SERIF}>{t}</text>
)

const ICONS: Record<string, () => ReactElement> = {
  // ── Home ──
  bold: () => <Glyph t="B" sans size={19} y={23} weight={700} />,
  italic: () => <Glyph t="I" sans italic size={19} y={23} weight={500} />,
  underline: () => <><Glyph t="U" sans size={17} y={20} weight={500} /><rect x={10} y={24} width={12} height={1.8} rx={0.9} fill={C.primary} /></>,
  color: () => <><Glyph t="A" sans size={17} y={20} weight={500} /><rect x={8} y={23.5} width={16} height={3.2} rx={1.6} fill={C.red} /></>,
  changeCase: () => <Glyph t="Aa" sans size={16} y={22} weight={500} />,
  highlight: () => <><rect x={5} y={21} width={22} height={6} rx={2} fill={C.yellow} /><path d="M11 18l9-11 4 3-9 11z" fill={C.orange} /><path d="M11 18l4 3-5 1z" fill={C.ink} /></>,
  grow: () => <><Glyph t="A" size={20} y={26} weight={700} /><path d="M23 11l3-4 3 4" stroke={C.primary} strokeWidth={2} fill="none" strokeLinecap="round" /></>,
  shrink: () => <><Glyph t="A" size={15} y={25} weight={700} /><path d="M23 7l3 4 3-4" stroke={C.primary} strokeWidth={2} fill="none" strokeLinecap="round" /></>,
  styles: () => <><rect x={3} y={6} width={26} height={20} rx={3} fill={C.light} /><text x={16} y={21} textAnchor="middle" fontSize={13} fontWeight={700} fill={C.dark} fontFamily="Arial">Aa</text></>,
  bullets: () => <>{[8, 16, 24].map((y) => <g key={y}><circle cx={7} cy={y} r={2.4} fill={C.primary} /><rect x={12} y={y - 1} width={15} height={2} rx={1} fill={C.line} /></g>)}</>,
  numbering: () => <>{[['1', 9], ['2', 17], ['3', 25]].map(([n, y]) => <g key={n}><text x={6} y={(y as number) + 2} fontSize={7.5} fontWeight={800} fill={C.primary} fontFamily="Arial">{n}</text><rect x={12} y={(y as number) - 1.5} width={15} height={2} rx={1} fill={C.line} /></g>)}</>,
  checklist: () => <>{[8, 16, 24].map((y, i) => <g key={y}><rect x={4} y={y - 3} width={6} height={6} rx={1.5} fill={i < 2 ? C.primary : C.paper} stroke={C.primary} strokeWidth={1.2} />{i < 2 && <path d={`M5.5 ${y}l1.5 1.5 2.5-3`} stroke="#fff" strokeWidth={1.3} fill="none" />}<rect x={13} y={y - 1} width={14} height={2} rx={1} fill={C.line} /></g>)}</>,
  alignLeft: () => <>{[8, 13, 18, 23].map((y, i) => <rect key={y} x={5} y={y} width={i % 2 ? 14 : 22} height={2.2} rx={1.1} fill={i === 0 ? C.primary : C.ink} />)}</>,
  alignCenter: () => <>{[8, 13, 18, 23].map((y, i) => <rect key={y} x={i % 2 ? 9 : 5} y={y} width={i % 2 ? 14 : 22} height={2.2} rx={1.1} fill={i === 0 ? C.primary : C.ink} />)}</>,
  alignRight: () => <>{[8, 13, 18, 23].map((y, i) => <rect key={y} x={i % 2 ? 13 : 5} y={y} width={i % 2 ? 14 : 22} height={2.2} rx={1.1} fill={i === 0 ? C.primary : C.ink} />)}</>,
  justify: () => <>{[8, 13, 18, 23].map((y, i) => <rect key={y} x={5} y={y} width={i === 3 ? 14 : 22} height={2.2} rx={1.1} fill={i === 0 ? C.primary : C.ink} />)}</>,
  indentMore: () => <><path d="M4 12l4 4-4 4z" fill={C.primary} />{[8, 13, 18, 23].map((y) => <rect key={y} x={12} y={y} width={15} height={2.2} rx={1.1} fill={C.ink} />)}</>,
  indentLess: () => <><path d="M9 12l-4 4 4 4z" fill={C.primary} />{[8, 13, 18, 23].map((y) => <rect key={y} x={12} y={y} width={15} height={2.2} rx={1.1} fill={C.ink} />)}</>,
  lineSpacing: () => <><path d="M7 5l3 4H4zM7 27l3-4H4z" fill={C.primary} /><rect x={6} y={9} width={2} height={14} fill={C.primary} />{[8, 14, 20, 26].map((y) => <rect key={y} x={13} y={y - 1} width={15} height={2} rx={1} fill={C.ink} />)}</>,
  painter: () => <><rect x={5} y={4} width={18} height={9} rx={2} fill={C.primary} /><rect x={23} y={7} width={4} height={3} fill={C.dark} /><path d="M25 10v6H15v4" stroke={C.dark} strokeWidth={2} fill="none" /><rect x={12.5} y={20} width={5} height={9} rx={1.5} fill={C.orange} /></>,
  clear: () => <><Glyph t="A" size={17} y={22} weight={700} /><path d="M18 26l6-10 5 3-6 10z" fill={C.pink} /><path d="M18 26h9" stroke={C.ink} strokeWidth={1.2} /></>,
  more: () => <>{[8, 16, 24].map((x) => <circle key={x} cx={x} cy={16} r={2.8} fill={C.primary} />)}</>,
  find: () => <><Page x={4} y={4} w={17} h={22} /><Lines x={7} y={9} w={11} n={4} /><circle cx={21} cy={20} r={6} fill={C.light} stroke={C.primary} strokeWidth={2.2} /><path d="M25.5 24.5l4 4" stroke={C.primary} strokeWidth={2.8} strokeLinecap="round" /></>,
  replace: () => <><rect x={3} y={4} width={12} height={11} rx={2} fill={C.light} /><text x={9} y={13} textAnchor="middle" fontSize={9} fontWeight={800} fill={C.dark} fontFamily="Arial">A</text><rect x={17} y={17} width={12} height={11} rx={2} fill={C.primary} /><text x={23} y={26} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff" fontFamily="Arial">B</text><path d="M16 9h7v6M16 23H9v-6" stroke={C.orange} strokeWidth={1.8} fill="none" strokeLinecap="round" /></>,
  dictate: () => <><rect x={11} y={2.5} width={10} height={17} rx={5} fill={C.primary} /><path d="M13.5 7h5M13.5 10.5h5M13.5 14h5" stroke="#fff" strokeWidth={1.3} strokeLinecap="round" opacity={0.7} /><path d="M7 14a9 9 0 0 0 18 0" stroke={C.ink} strokeWidth={2} fill="none" strokeLinecap="round" /><path d="M16 23v5M11.5 29h9" stroke={C.ink} strokeWidth={2} strokeLinecap="round" /><path d="M26.5 6.5c1.6 1.6 1.6 5.4 0 7M29 4c3 3 3 9.5 0 12.5" stroke={C.orange} strokeWidth={1.6} fill="none" strokeLinecap="round" /></>,
  dictateOn: () => <><rect x={11} y={2.5} width={10} height={17} rx={5} fill={C.red} /><path d="M13.5 7h5M13.5 10.5h5M13.5 14h5" stroke="#fff" strokeWidth={1.3} strokeLinecap="round" opacity={0.7} /><path d="M7 14a9 9 0 0 0 18 0" stroke={C.ink} strokeWidth={2} fill="none" strokeLinecap="round" /><path d="M16 23v5M11.5 29h9" stroke={C.ink} strokeWidth={2} strokeLinecap="round" /><path d="M26.5 6.5c1.6 1.6 1.6 5.4 0 7M29 4c3 3 3 9.5 0 12.5" stroke={C.red} strokeWidth={1.6} fill="none" strokeLinecap="round" /></>,
  // ── Insert ──
  table: () => <Grid />,
  image: () => <Photo />,
  signature: () => <><Page x={3} y={5} w={26} h={22} /><path d="M6 20c3-6 5-6 5-2s2 3 4-1 3-3 3 0 3 2 6-1" stroke={C.inkP} strokeWidth={1.7} fill="none" strokeLinecap="round" /><rect x={6} y={23} width={20} height={1.2} fill={C.edge} /><path d="M20 15l8-9 2.5 2.2-8 9z" fill={C.primary} /><path d="M20 15l2.5 2.2-3.6 1.3z" fill={C.inkP} /></>,
  link: () => <><rect x={3} y={11} width={15} height={10} rx={5} fill="none" stroke={C.primary} strokeWidth={3} /><rect x={14} y={11} width={15} height={10} rx={5} fill="none" stroke={C.blue} strokeWidth={3} /></>,
  pageBreak: () => <><Page x={8} y={2} w={16} h={11} /><Page x={8} y={19} w={16} h={11} /><path d="M3 16h26" stroke={C.primary} strokeWidth={1.8} strokeDasharray="3 2" /><Badge cx={27} cy={16} r={4.2} fill={C.orange}><path d="M27 13.6v4.6m-2-2 2 2 2-2" stroke="#fff" strokeWidth={1.4} fill="none" /></Badge></>,
  blankPage: () => <><Page x={5} y={5} w={16} h={22} /><Page x={11} y={2} w={16} h={22} /><Plus cx={24} cy={24} /></>,
  header: () => <><Page /><rect x={8.2} y={4.2} width={15.6} height={5} fill={C.primary} /><Lines x={10} y={13} w={12} n={4} /></>,
  footer: () => <><Page /><Lines x={10} y={7} w={12} n={4} /><rect x={8.2} y={22.8} width={15.6} height={5} fill={C.primary} /></>,
  pageNumber: () => <><Page /><Lines x={10} y={7} w={12} n={3} /><Badge cx={16} cy={23} r={4.6}>1</Badge></>,
  symbol: () => <><rect x={4} y={4} width={24} height={24} rx={6} fill={C.purple} /><text x={16} y={23} textAnchor="middle" fontSize={17} fontWeight={700} fill="#fff" fontFamily="Georgia, serif">Ω</text></>,
  line: () => <><Lines x={5} y={6} w={22} n={2} gap={4} /><rect x={4} y={15} width={24} height={2.4} rx={1.2} fill={C.primary} /><Lines x={5} y={22} w={22} n={2} gap={4} /></>,
  quote: () => <><rect x={3} y={5} width={26} height={22} rx={4} fill={C.light} /><text x={9} y={21} fontSize={20} fontWeight={800} fill={C.primary} fontFamily="Georgia, serif">“</text><Lines x={16} y={11} w={10} n={3} gap={4} color={C.dark} /></>,
  code: () => <><rect x={3} y={5} width={26} height={22} rx={4} fill={C.inkP} /><path d="M11 12l-4 4 4 4M21 12l4 4-4 4" stroke={C.primary} strokeWidth={2.2} fill="none" strokeLinecap="round" /><path d="M17.5 10l-3 12" stroke="#fff" strokeWidth={1.6} /></>,
  date: () => <><rect x={4} y={6} width={24} height={21} rx={3} fill={C.paper} stroke={C.edge} strokeWidth={1.2} /><rect x={4} y={6} width={24} height={6} rx={3} fill={C.red} /><text x={16} y={24} textAnchor="middle" fontSize={10} fontWeight={800} fill={C.inkP} fontFamily="Arial">28</text></>,
  // ── Layout ──
  margins: () => <><Page x={5} y={2} w={22} h={28} /><rect x={9} y={6} width={14} height={20} fill={C.light} stroke={C.primary} strokeWidth={1.2} strokeDasharray="2 1.6" /><Lines x={11} y={9} w={10} n={4} /></>,
  portrait: () => <><Page x={9} y={2} w={15} h={22} fill={C.light} /><Page x={4} y={16} w={22} h={14} /></>,
  orientation: () => <><Page x={4} y={3} w={15} h={21} /><rect x={11} y={14} width={19} height={14} rx={2} fill={C.primary} /><path d="M20 8a7 7 0 0 1 7 6" stroke={C.orange} strokeWidth={1.8} fill="none" /><path d="M25 12l2 2.5 2-3" stroke={C.orange} strokeWidth={1.8} fill="none" /></>,
  size: () => <><Page x={3} y={9} w={14} h={20} /><Page x={11} y={2} w={18} h={26} /><text x={20} y={19} textAnchor="middle" fontSize={7} fontWeight={800} fill={C.dark} fontFamily="Arial">A4</text></>,
  brkColumn: () => <><Page x={3} y={2} w={26} h={28} /><Lines x={6} y={6} w={8} n={5} gap={3.6} /><Lines x={18} y={6} w={8} n={2} gap={3.6} color={C.orange} /><path d="M10 24c0 4 8 4 8-12" stroke={C.orange} strokeWidth={1.6} fill="none" /><path d="M16 14l2-3 2 3" stroke={C.orange} strokeWidth={1.6} fill="none" /></>,
  brkNextPage: () => <><Page x={6} y={2} w={20} h={12} /><Lines x={9} y={5} w={14} n={2} gap={3.4} /><path d="M2 16h28" stroke={C.primary} strokeWidth={1.6} strokeDasharray="3 2" /><Page x={6} y={18} w={20} h={12} /><Lines x={9} y={21} w={14} n={2} gap={3.4} color={C.orange} /></>,
  brkContinuous: () => <><Page x={6} y={2} w={20} h={28} /><Lines x={9} y={6} w={14} n={2} gap={3.4} /><path d="M6 15h20" stroke={C.primary} strokeWidth={1.6} strokeDasharray="3 2" /><Lines x={9} y={19} w={14} n={3} gap={3.4} color={C.orange} /></>,
  brkEvenPage: () => <><Page x={4} y={2} w={18} h={12} /><Lines x={7} y={5} w={9} n={2} gap={3.4} /><text x={19} y={11} textAnchor="middle" fontSize={7} fontWeight={800} fill={C.inkP} fontFamily="Arial">2</text><path d="M2 16h28" stroke={C.primary} strokeWidth={1.6} strokeDasharray="3 2" /><Page x={4} y={18} w={18} h={12} /><Lines x={7} y={21} w={9} n={2} gap={3.4} color={C.orange} /><Badge cx={25} cy={24} r={5} fill={C.orange}>4</Badge></>,
  brkOddPage: () => <><Page x={4} y={2} w={18} h={12} /><Lines x={7} y={5} w={9} n={2} gap={3.4} /><text x={19} y={11} textAnchor="middle" fontSize={7} fontWeight={800} fill={C.inkP} fontFamily="Arial">1</text><path d="M2 16h28" stroke={C.primary} strokeWidth={1.6} strokeDasharray="3 2" /><Page x={4} y={18} w={18} h={12} /><Lines x={7} y={21} w={9} n={2} gap={3.4} color={C.orange} /><Badge cx={25} cy={24} r={5} fill={C.orange}>3</Badge></>,
  breaks: () => <><Page x={6} y={3} w={20} h={11} /><Page x={6} y={18} w={20} h={11} /><path d="M2 16h28" stroke={C.red} strokeWidth={1.6} strokeDasharray="3 2" /></>,
  styleSets: () => <><rect x={3} y={4} width={26} height={24} rx={4} fill={C.paper} stroke={C.edge} strokeWidth={1.2} /><rect x={6} y={8} width={14} height={3} rx={1.5} fill={C.dark} /><rect x={6} y={14} width={10} height={2} rx={1} fill={C.primary} /><Lines x={6} y={19} w={20} n={2} gap={3.5} /><circle cx={25} cy={9} r={3} fill={C.pink} /></>,
  // ── References ──
  toc: () => <><Page x={5} y={2} w={22} h={28} /><rect x={8} y={6} width={10} height={2.6} rx={1.3} fill={C.primary} />{[12, 17, 22].map((y, i) => <g key={y}><rect x={8 + (i === 1 ? 2 : 0)} y={y} width={7} height={1.8} rx={0.9} fill={C.inkP} /><path d={`M${16 + (i === 1 ? 2 : 0)} ${y + 1}h5`} stroke={C.edge} strokeWidth={1.2} strokeDasharray="1 1.3" /><text x={24} y={y + 2} fontSize={4.5} fontWeight={800} fill={C.dark} fontFamily="Arial">{i + 1}</text></g>)}</>,
  headingNumbers: () => <>{[['1', 9, 4, C.primary], ['1.1', 17, 8, C.dark], ['1.2', 25, 8, C.dark]].map(([t, y, x, f]) => <g key={t as string}><text x={x as number} y={(y as number) + 2.5} fontSize={7} fontWeight={800} fill={f as string} fontFamily="Arial">{t}</text><rect x={(x as number) + 10} y={(y as number) - 1} width={27 - ((x as number) + 10)} height={2.2} rx={1.1} fill={C.line} /></g>)}</>,
  captionImage: () => <><Photo x={5} y={3} w={22} h={17} /><rect x={5} y={23} width={10} height={2.4} rx={1.2} fill={C.primary} /><rect x={16} y={23} width={11} height={2.4} rx={1.2} fill={C.line} /></>,
  captionTable: () => <><rect x={4} y={3} width={10} height={2.4} rx={1.2} fill={C.primary} /><rect x={15} y={3} width={13} height={2.4} rx={1.2} fill={C.line} /><Grid x={4} y={9} w={24} h={19} /></>,
  // ── Review / View ──
  spelling: () => <><text x={3} y={17} fontSize={11} fontWeight={800} fill={C.ink} fontFamily="Arial">abc</text><path d="M3 21q1.5 2 3 0t3 0 3 0 3 0 3 0" stroke={C.red} strokeWidth={1.4} fill="none" /><Badge cx={25} cy={22} r={5.5} fill={C.green}><path d="M22.4 22l2 2 3.4-4" stroke="#fff" strokeWidth={1.8} fill="none" /></Badge></>,
  wordCount: () => <><rect x={3} y={6} width={26} height={20} rx={4} fill={C.light} /><text x={16} y={20} textAnchor="middle" fontSize={10} fontWeight={800} fill={C.dark} fontFamily="Arial">123</text></>,
  printLayout: () => <><Page x={6} y={2} w={20} h={28} /><Lines x={9} y={7} w={14} n={6} /></>,
  webLayout: () => <><rect x={3} y={5} width={26} height={22} rx={3} fill={C.paper} stroke={C.edge} strokeWidth={1.2} /><rect x={3} y={5} width={26} height={5} rx={3} fill={C.primary} /><circle cx={6.5} cy={7.5} r={1} fill="#fff" /><circle cx={9.5} cy={7.5} r={1} fill="#fff" /><Lines x={6} y={14} w={20} n={3} gap={4} /></>,
  zoom100: () => <><circle cx={14} cy={14} r={10} fill={C.light} stroke={C.primary} strokeWidth={2.2} /><text x={14} y={17.5} textAnchor="middle" fontSize={8} fontWeight={800} fill={C.dark} fontFamily="Arial">100</text><path d="M21.5 21.5l6 6" stroke={C.primary} strokeWidth={3} strokeLinecap="round" /></>,
  fitWidth: () => <><Page x={8} y={3} w={16} h={26} /><path d="M2 16h8M22 16h8M5 13l-3 3 3 3M27 13l3 3-3 3" stroke={C.primary} strokeWidth={1.8} fill="none" strokeLinecap="round" /></>,
  onePage: () => <><Page x={8} y={2} w={16} h={22} /><path d="M6 28h20" stroke={C.primary} strokeWidth={2} strokeLinecap="round" /></>,
  ruler: () => <><rect x={2} y={11} width={28} height={10} rx={2} fill={C.yellow} stroke={C.orange} strokeWidth={1} />{[6, 10, 14, 18, 22, 26].map((x, i) => <rect key={x} x={x} y={11} width={1.2} height={i % 2 ? 3 : 5} fill={C.ink} />)}</>,
  marks: () => <><rect x={4} y={4} width={24} height={24} rx={6} fill={C.light} /><text x={16} y={23} textAnchor="middle" fontSize={18} fontWeight={700} fill={C.primary} fontFamily="Georgia, serif">¶</text></>,
  pdf: () => <><Page x={6} y={2} w={20} h={28} /><rect x={3} y={14} width={20} height={9} rx={2} fill={C.red} /><text x={13} y={21} textAnchor="middle" fontSize={6.5} fontWeight={800} fill="#fff" fontFamily="Arial">PDF</text></>,
  print: () => <><rect x={9} y={3} width={14} height={9} fill={C.paper} stroke={C.edge} strokeWidth={1.2} /><rect x={3} y={11} width={26} height={11} rx={3} fill={C.dark} /><circle cx={24} cy={15} r={1.3} fill={C.green} /><rect x={9} y={18} width={14} height={11} fill={C.paper} stroke={C.edge} strokeWidth={1.2} /><Lines x={11} y={21} w={10} n={2} gap={3} /></>,
  // ── Picture ──
  wrapTopBottom: () => <><Lines x={3} y={3} w={26} n={1} /><Photo x={9} y={8} w={14} h={12} /><Lines x={3} y={25} w={26} n={1} /></>,
  wrapSquare: () => <><Photo x={3} y={4} w={12} h={11} />{[5, 9, 13].map((y) => <rect key={y} x={17} y={y} width={12} height={1.6} rx={0.8} fill={C.line} />)}<Lines x={3} y={19} w={26} n={3} /></>,
  shape: () => <><defs><clipPath id="ill-star"><path d="M16 2l4 9 10 1-7.5 6.5L25 29l-9-5.5L7 29l2.5-10.5L2 12l10-1z" /></clipPath></defs><Photo x={2} y={2} w={28} h={28} clip="url(#ill-star)" /></>,
  circleCrop: () => <><defs><clipPath id="ill-circle"><circle cx={16} cy={16} r={13} /></clipPath></defs><Photo x={2} y={3} w={28} h={27} clip="url(#ill-circle)" /></>,
  aspect: () => <><Photo x={5} y={5} w={22} h={22} /><path d="M2 8h6V2M30 24h-6v6" stroke={C.ink} strokeWidth={2.2} fill="none" /></>,
  pan: () => <><Photo x={3} y={5} w={26} h={22} /><path d="M16 9v14M9 16h14" stroke="#fff" strokeWidth={2} /><path d="M16 7l-2 3h4zM16 25l-2-3h4zM7 16l3-2v4zM25 16l-3-2v4z" fill="#fff" /></>,
  shadow: () => <><rect x={9} y={9} width={19} height={17} rx={3} fill="#000" opacity={0.18} /><Photo x={4} y={4} w={20} h={18} /></>,
  bigger: () => <><Photo x={3} y={5} w={24} h={22} /><Plus cx={26} cy={25} /></>,
  smaller: () => <><Photo x={8} y={10} w={16} h={14} /><Badge cx={26} cy={25} r={5}><path d="M23.4 25h5.2" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" /></Badge></>,
  resetSize: () => <><Photo x={5} y={7} w={20} h={18} /><path d="M27 6a8 8 0 1 1-3-3" stroke={C.orange} strokeWidth={1.8} fill="none" /><path d="M24 1v3h3" stroke={C.orange} strokeWidth={1.8} fill="none" /></>,
  picLeft: () => <><Photo x={3} y={6} w={14} h={12} />{[7, 11, 15].map((y) => <rect key={y} x={20} y={y} width={9} height={1.6} rx={0.8} fill={C.line} />)}<Lines x={3} y={22} w={26} n={2} gap={3.6} /></>,
  picCenter: () => <><Photo x={9} y={4} w={14} h={12} /><Lines x={3} y={20} w={26} n={3} gap={3.6} /></>,
  picRight: () => <><Photo x={15} y={6} w={14} h={12} />{[7, 11, 15].map((y) => <rect key={y} x={3} y={y} width={9} height={1.6} rx={0.8} fill={C.line} />)}<Lines x={3} y={22} w={26} n={2} gap={3.6} /></>,
  photoFull: () => <Photo x={0} y={0} w={32} h={32} clip="none" />,
  cornerRadius: () => <><defs><clipPath id="ill-round"><rect x={3} y={3} width={26} height={26} rx={10} /></clipPath></defs><Photo x={3} y={3} w={26} h={26} clip="url(#ill-round)" />
    <path d="M3 17V13A10 10 0 0 1 13 3h4" stroke={C.orange} strokeWidth={2.2} fill="none" strokeLinecap="round" /><circle cx={10} cy={10} r={3} fill={C.primary} stroke="#fff" strokeWidth={1.3} /></>,
  altText: () => <><Photo x={2} y={3} w={22} h={18} /><rect x={11} y={18} width={19} height={11} rx={3} fill={C.purple} stroke="#fff" strokeWidth={1.2} /><text x={20.5} y={26} textAnchor="middle" fontSize={6.5} fontWeight={800} fill="#fff" fontFamily="Arial">ALT</text></>,
  resetStyle: () => <><defs><clipPath id="ill-reset"><circle cx={13} cy={14} r={11} /></clipPath></defs><Photo x={2} y={3} w={22} h={22} clip="url(#ill-reset)" /><path d="M18 27l6-10 5 3-6 10z" fill={C.pink} /><path d="M18 27h10" stroke={C.ink} strokeWidth={1.2} /></>,
  widthArrows: () => <><Photo x={5} y={4} w={22} h={16} /><path d="M4 26h24M7 23l-3 3 3 3M25 23l3 3-3 3" stroke={C.primary} strokeWidth={1.8} fill="none" strokeLinecap="round" /></>,
  heightArrows: () => <><Photo x={4} y={5} w={16} h={22} /><path d="M26 4v24M23 7l3-3 3 3M23 25l3 3 3-3" stroke={C.primary} strokeWidth={1.8} fill="none" strokeLinecap="round" /></>,
  replaceImage: () => <><Photo x={3} y={3} w={17} h={15} /><Photo x={12} y={14} w={17} h={15} /></>,
  delete: () => <><rect x={8} y={9} width={16} height={19} rx={2.5} fill={C.red} /><rect x={5} y={5} width={22} height={3.4} rx={1.7} fill={C.red} /><rect x={13} y={2.5} width={6} height={3} rx={1.2} fill={C.red} /><path d="M13 13v11M19 13v11" stroke="#fff" strokeWidth={1.6} /></>,
  // ── Table ──
  rowAbove: () => <><Grid x={4} y={10} w={24} h={18} /><Plus cx={16} cy={6} /></>,
  rowBelow: () => <><Grid x={4} y={3} w={24} h={18} /><Plus cx={16} cy={26} /></>,
  colLeft: () => <><Grid x={10} y={7} w={19} h={18} /><Plus cx={5} cy={16} /></>,
  colRight: () => <><Grid x={3} y={7} w={19} h={18} /><Plus cx={27} cy={16} /></>,
  delRow: () => <><Grid x={4} y={4} w={24} h={18} cells={[[0, 1, '#FECACA'], [1, 1, '#FECACA'], [2, 1, '#FECACA']]} /><Badge cx={16} cy={26} r={4.6} fill={C.red}><path d="M13.6 26h4.8" stroke="#fff" strokeWidth={1.8} /></Badge></>,
  delCol: () => <><Grid x={2} y={6} w={24} h={18} cells={[[1, 1, '#FECACA'], [1, 2, '#FECACA']]} /><Badge cx={27} cy={26} r={4.6} fill={C.red}><path d="M24.6 26h4.8" stroke="#fff" strokeWidth={1.8} /></Badge></>,
  merge: () => <><rect x={3} y={7} width={26} height={18} rx={2} fill={C.paper} stroke={C.edge} strokeWidth={1.2} /><rect x={3} y={13} width={26} height={6} fill={C.light} /><path d="M3 13h26M3 19h26M11.7 7v6M20.3 7v6M11.7 19v6M20.3 19v6" stroke={C.edge} /><path d="M8 16h5m6 0h5M11 14l2 2-2 2M21 14l-2 2 2 2" stroke={C.primary} strokeWidth={1.5} fill="none" /></>,
  split: () => <><rect x={3} y={7} width={26} height={18} rx={2} fill={C.paper} stroke={C.edge} strokeWidth={1.2} /><path d="M16 7v18" stroke={C.primary} strokeWidth={1.8} strokeDasharray="2 1.5" /><path d="M13 16H8m11 0h5" stroke={C.primary} strokeWidth={1.5} /></>,
  headerRow: () => <Grid header={C.orange} />,
  shading: () => <><Grid cells={[[1, 1, C.yellow], [2, 2, C.pink]]} /></>,
  valign: () => <><rect x={4} y={4} width={24} height={24} rx={3} fill={C.paper} stroke={C.edge} strokeWidth={1.2} /><rect x={8} y={14} width={16} height={4} rx={2} fill={C.primary} /><path d="M16 6v5m0 10v5" stroke={C.edge} strokeWidth={1.2} /></>,
  deleteTable: () => <><Grid x={2} y={3} w={22} h={17} /><Badge cx={24} cy={24} r={6} fill={C.red}><path d="M21.5 21.5l5 5m0-5-5 5" stroke="#fff" strokeWidth={1.8} /></Badge></>,
  // ── App ──
  shapes: () => <><rect x={3} y={4} width={15} height={13} rx={1.5} fill={C.blue} /><circle cx={21} cy={19} r={8} fill={C.primary} /><path d="M9 29l6-10 6 10z" fill={C.orange} /></>,
  lineWeight: () => <><rect x={4} y={6} width={24} height={1.4} rx={0.7} fill={C.ink} /><rect x={4} y={12} width={24} height={2.6} rx={1.3} fill={C.ink} /><rect x={4} y={19.5} width={24} height={4.5} rx={2} fill={C.primary} /></>,
  file: () => <><Page x={6} y={2} w={20} h={28} fill={C.light} /><path d="M20 2v6h6" fill={C.primary} /><Lines x={9} y={13} w={14} n={4} color={C.dark} /></>,
}

/** Colourful descriptive icon. `name` is a key of ICONS. */
export function Ill({ name, size = 28 }: { name: string; size?: number }) {
  const draw = ICONS[name] || ICONS.more
  return (
    <svg className="ill" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {draw()}
    </svg>
  )
}
