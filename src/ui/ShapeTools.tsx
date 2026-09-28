// Insert ▸ Shapes gallery (Word's grouped grid) and the insert helper, shared by desktop and mobile.
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { MenuTitle } from './controls'
import { SHAPE_GROUPS, defaultShape, isLine, shapeLabel, shapeSrc, type ShapeKind, type VShape } from '../editor/shapes'
import { t } from '../i18n'

/** Small preview of a shape kind, in the given colours (default: the insert colours). */
export function ShapeIcon({ k, v, w = 24, h = 20 }: { k: ShapeKind; v?: VShape; w?: number; h?: number }) {
  const base = v ? { ...v, k } : defaultShape(k).v
  const icon = { ...base, lw: isLine(k) ? 2 : Math.min(base.lw, 1.5) }
  return <img className="shape-ico" src={shapeSrc(icon, w, h)} width={w} height={h} alt="" draggable={false} />
}

export function ShapeGallery({ onPick, current, v }: { onPick: (k: ShapeKind) => void; current?: ShapeKind; v?: VShape }) {
  return (
    <div className="shape-gallery">
      {SHAPE_GROUPS.map((g) => (
        <div key={g.key}>
          <MenuTitle>{t(g.key)}</MenuTitle>
          <div className="shape-grid">
            {g.kinds.map((k) => (
              <button key={k} className={`shape-cell${current === k ? ' active' : ''}`} title={shapeLabel(k)}
                onMouseDown={(ev) => ev.preventDefault()} onClick={() => onPick(k)}>
                <ShapeIcon k={k} v={v && !isLine(k) === !isLine(v.k) ? v : undefined} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Insert a shape at the cursor and select it, so its «Μορφή σχήματος» tab opens. */
export function insertShape(editor: Editor, k: ShapeKind) {
  const { v, w, h } = defaultShape(k)
  editor.chain().focus()
    .insertContent({ type: 'image', attrs: { src: shapeSrc(v, w, h), width: w, height: h, wrap: 'topBottom', align: 'center', vshape: v, alt: shapeLabel(k) } })
    .command(({ tr }) => {
      const pos = tr.selection.from - 1
      if (pos >= 0 && tr.doc.nodeAt(pos)?.type.name === 'image') tr.setSelection(NodeSelection.create(tr.doc, pos))
      return true
    })
    .run()
}

/** Swap the kind of a shape, keeping its colours (lines ↔ shapes take the new kind's defaults). */
export function changeKind(v: VShape, k: ShapeKind): VShape {
  if (isLine(k) !== isLine(v.k)) return defaultShape(k).v
  return { ...v, k }
}
