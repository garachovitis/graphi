// Prepares every picture of a document for export: portable raster bytes at the exact
// displayed size, with shape / crop / shadow baked in when used.
import type { JSONContent } from '@tiptap/core'
import { bakePicture, displaySize, needsBake, type ImgAttrs } from '../editor/image'
import { dataUrlToBytes, loadImage, toPortableImage } from './images'
import { shapeSrc } from '../editor/shapes'

export interface PreparedPicture {
  bytes: Uint8Array
  type: 'png' | 'jpg' | 'gif' | 'bmp'
  mime: string
  /** display size in px (96 dpi), including any baked shadow padding */
  w: number
  h: number
}

const DEFAULTS: Omit<ImgAttrs, 'src'> = {
  alt: null, title: null, width: null, height: null, wrap: null, align: 'center', shape: 'rect', aspect: null, focusX: 50, focusY: 50, shadow: 'none', radius: 12, x: null, y: null, vshape: null,
}

export const pictureAttrs = (n: JSONContent): ImgAttrs => ({ ...DEFAULTS, ...(n.attrs || {}) } as ImgAttrs)

export const pictureKey = (a: ImgAttrs) =>
  a.vshape
    ? JSON.stringify(['shape', a.vshape, a.width, a.height])
    : JSON.stringify([a.src.length, a.src.slice(-64), a.width, a.height, a.shape, a.aspect, a.focusX, a.focusY, a.shadow, a.radius])

export async function preparePictures(doc: JSONContent, maxWidthPx: number): Promise<Map<string, PreparedPicture>> {
  const out = new Map<string, PreparedPicture>()
  const nodes: ImgAttrs[] = []
  const walk = (n: JSONContent) => { if (n.type === 'image' && n.attrs?.src) nodes.push(pictureAttrs(n)); n.content?.forEach(walk) }
  walk(doc)
  for (let a of nodes) {
    // Shapes: draw the SVG at the exact displayed size, so the raster is sharp and unstretched.
    if (a.vshape) { const d = displaySize(a); a = { ...a, src: shapeSrc(a.vshape, d.w, d.h) } }
    const key = pictureKey(a)
    if (out.has(key)) continue
    const base = await toPortableImage(a.src)
    if (!base) continue
    let w: number, h: number
    let bytes = base.bytes, type = base.type, mime = base.mime
    if (needsBake(a)) {
      const img = await loadImage(a.src)
      const baked = await bakePicture(a, img)
      const p = dataUrlToBytes(baked.dataUrl)!
      bytes = p.bytes; type = 'png'; mime = 'image/png'
      w = baked.w; h = baked.h
    } else {
      const d = displaySize(a, { w: base.w, h: base.h })
      w = d.w; h = d.h
    }
    if (w > maxWidthPx) { h = (h * maxWidthPx) / w; w = maxWidthPx }
    out.set(key, { bytes, type, mime, w: Math.round(w), h: Math.round(h) })
  }
  return out
}
