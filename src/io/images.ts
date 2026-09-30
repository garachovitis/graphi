// Image helpers for import/export: data URLs, natural size, format conversion.
import { t } from '../i18n'

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return `data:${mime};base64,${btoa(bin)}`
}

export function dataUrlToBytes(url: string): { bytes: Uint8Array; mime: string } | null {
  if (!url.startsWith('data:')) return null
  const comma = url.indexOf(',')
  if (comma < 0) return null
  const meta = url.slice(5, comma).split(';')
  const mime = meta[0] || 'application/octet-stream'
  const data = url.slice(comma + 1)
  if (meta.includes('base64')) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { bytes, mime }
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(data)), mime }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(t('io.imageLoad')))
    img.src = src
  })
}

/** Raster formats every word processor understands. Everything else → PNG. */
export async function toPortableImage(src: string): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; mime: string; w: number; h: number } | null> {
  try {
    // Pictures are always embedded (see Picture.parseHTML): there is nothing to download.
    const parsed = dataUrlToBytes(src)
    if (!parsed) return null
    const img = await loadImage(src)
    const map: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp',
    }
    const t = map[parsed.mime]
    if (t) return { bytes: parsed.bytes, type: t, mime: parsed.mime, w: img.naturalWidth, h: img.naturalHeight }
    // SVG / WebP / AVIF → rasterize at 2× for crispness.
    const c = document.createElement('canvas')
    const w = img.naturalWidth || 300
    const h = img.naturalHeight || 150
    c.width = w * 2
    c.height = h * 2
    const ctx = c.getContext('2d')!
    ctx.scale(2, 2)
    ctx.drawImage(img, 0, 0, w, h)
    const png = dataUrlToBytes(c.toDataURL('image/png'))!
    return { bytes: png.bytes, type: 'png', mime: 'image/png', w, h }
  } catch {
    return null
  }
}
