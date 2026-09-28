// Picking colours off the screen.
//
//  • Eyedropper: the system colour sampler (EyeDropper API — Chromium/Electron). Works on
//    anything on screen, including other apps, and brings its own small magnifier.
//  • Scope: our own magnifier over a frozen snapshot of the window, for exact picks —
//    a pixel grid you can steer with the arrow keys one pixel at a time, a zoom you can
//    change with the wheel, and averaging over 1×1 / 3×3 / 5×5 pixels so antialiased
//    text or noisy photos give the colour you actually see.
//
// While either is active, open colour menus and dialogs are hidden so they don't cover
// what the user wants to sample.
import { platform } from '../platform'
import { rgbHex, inkOn } from '../model/themes'
import { t } from '../i18n'

type EyeDropperCtor = new () => { open(o?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> }
const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper

export const canEyedrop = () => !!EyeDropper
export const canScope = () => platform.canCaptureWindow()

/** Hides menus/dialogs while sampling (they'd cover the document). */
async function hideChrome<T>(run: () => Promise<T>): Promise<T> {
  const root = document.documentElement
  root.classList.add('color-picking')
  // Two frames: the hide must be painted before a snapshot is taken.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  try { return await run() } finally { root.classList.remove('color-picking') }
}

/** Normalises the EyeDropper result (Chromium returns "#rrggbb", some builds "rgb(…)"). */
function toHexColor(s: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s)
  return m ? rgbHex(+m[1], +m[2], +m[3]) : null
}

export async function eyedrop(): Promise<string | null> {
  if (!EyeDropper) return null
  return hideChrome(async () => {
    try { return toHexColor((await new EyeDropper().open()).sRGBHex) } catch { return null } // Esc → AbortError
  })
}

// ───────────── the scope ─────────────
const LOUPE = 168 // CSS px
const ZOOMS = [7, 9, 11, 13, 15, 19, 23, 31] // pixels across the loupe (odd: there is a centre pixel)

export async function scope(): Promise<string | null> {
  let shot: ImageBitmap | null = null
  try {
    shot = await hideChrome(() => platform.captureWindow())
  } catch {
    return null // permission refused / capture failed
  }
  if (!shot) return null
  return runScope(shot)
}

function runScope(shot: ImageBitmap): Promise<string | null> {
  return new Promise((resolve) => {
    const W = shot.width, H = shot.height
    // Pixel data once, for sampling.
    const src = document.createElement('canvas')
    src.width = W; src.height = H
    const sctx = src.getContext('2d', { willReadFrequently: true })!
    sctx.drawImage(shot, 0, 0)
    const pixels = sctx.getImageData(0, 0, W, H).data

    // Where the snapshot is shown: the whole viewport (same aspect as the window), else fitted.
    const vw = window.innerWidth, vh = window.innerHeight
    const k = Math.min(vw / W, vh / H)
    const dw = W * k, dh = H * k
    const ox = (vw - dw) / 2, oy = (vh - dh) / 2

    const root = document.createElement('div')
    root.className = 'scope-overlay app-chrome'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', t('pick.scope'))
    root.tabIndex = -1
    const dpr = window.devicePixelRatio || 1
    const bg = document.createElement('canvas')
    bg.className = 'scope-bg'
    bg.width = Math.round(vw * dpr); bg.height = Math.round(vh * dpr)
    bg.style.width = `${vw}px`; bg.style.height = `${vh}px`
    const bctx = bg.getContext('2d')!
    bctx.imageSmoothingEnabled = k * dpr < 1
    bctx.drawImage(shot, ox * dpr, oy * dpr, dw * dpr, dh * dpr)

    const loupe = document.createElement('div')
    loupe.className = 'scope-loupe'
    const lc = document.createElement('canvas')
    lc.width = LOUPE * dpr; lc.height = LOUPE * dpr
    lc.style.width = lc.style.height = `${LOUPE}px`
    const lctx = lc.getContext('2d')!
    const read = document.createElement('div')
    read.className = 'scope-read'
    loupe.append(lc, read)

    const hint = document.createElement('div')
    hint.className = 'scope-hint'
    hint.textContent = t('pick.scopeHint')
    const live = document.createElement('div')
    live.className = 'sr-only'
    live.setAttribute('aria-live', 'polite')
    root.append(bg, loupe, hint, live)
    document.body.appendChild(root)
    const prevFocus = document.activeElement as HTMLElement | null
    root.focus()

    // State in snapshot pixels.
    let px = W / 2, py = H / 2
    let zi = 4 // index in ZOOMS
    let sample = 1
    let touch = false
    let cx = vw / 2, cy = vh / 2 // pointer in CSS px

    const sampleAt = (x: number, y: number) => {
      const r = Math.floor(sample / 2)
      let R = 0, G = 0, B = 0, n = 0
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const X = Math.min(W - 1, Math.max(0, Math.floor(x) + i)), Y = Math.min(H - 1, Math.max(0, Math.floor(y) + j))
        const o = (Y * W + X) * 4
        R += pixels[o]; G += pixels[o + 1]; B += pixels[o + 2]; n++
      }
      return rgbHex(R / n, G / n, B / n)
    }

    let liveTimer = 0
    const draw = () => {
      const N = ZOOMS[zi]
      const cell = (LOUPE * dpr) / N
      const x0 = Math.floor(px) - (N >> 1), y0 = Math.floor(py) - (N >> 1)
      lctx.imageSmoothingEnabled = false
      lctx.fillStyle = '#808080'
      lctx.fillRect(0, 0, lc.width, lc.height)
      lctx.drawImage(shot, x0, y0, N, N, 0, 0, lc.width, lc.height)
      // Pixel grid.
      lctx.strokeStyle = 'rgba(0,0,0,.14)'
      lctx.lineWidth = 1
      lctx.beginPath()
      for (let i = 1; i < N; i++) {
        const p = Math.round(i * cell) + 0.5
        lctx.moveTo(p, 0); lctx.lineTo(p, lc.height)
        lctx.moveTo(0, p); lctx.lineTo(lc.width, p)
      }
      lctx.stroke()
      // Sampled area: white + black outline, visible on any colour.
      const r = Math.floor(sample / 2)
      const sx = ((N >> 1) - r) * cell, sw = sample * cell
      lctx.lineWidth = 2 * dpr
      lctx.strokeStyle = '#000'
      lctx.strokeRect(sx - dpr, sx - dpr, sw + 2 * dpr, sw + 2 * dpr)
      lctx.strokeStyle = '#fff'
      lctx.strokeRect(sx + dpr, sx + dpr, sw - 2 * dpr, sw - 2 * dpr)

      const hex = sampleAt(px, py)
      read.innerHTML = ''
      const sw_ = document.createElement('i')
      sw_.style.background = hex
      const txt = document.createElement('b')
      txt.textContent = hex.toUpperCase()
      const meta = document.createElement('small')
      meta.textContent = `${sample}×${sample} · ${N}×`
      read.append(sw_, txt, meta)
      read.style.setProperty('--ink', inkOn(hex))

      // Keep the loupe beside the pointer, never under the finger, never off-screen.
      const gap = 22
      let lx = cx + gap, ly = touch ? cy - LOUPE - 70 : cy + gap
      if (lx + LOUPE > vw - 8) lx = cx - gap - LOUPE
      if (ly + LOUPE + 40 > vh - 8) ly = cy - gap - LOUPE - 40
      if (ly < 8) ly = Math.min(vh - LOUPE - 48, cy + gap)
      loupe.style.transform = `translate(${Math.max(8, lx)}px, ${Math.max(8, ly)}px)`
      clearTimeout(liveTimer)
      liveTimer = window.setTimeout(() => { live.textContent = hex.toUpperCase() }, 400)
    }

    const toImage = (x: number, y: number) => {
      cx = x; cy = y
      px = Math.min(W - 0.01, Math.max(0, (x - ox) / k))
      py = Math.min(H - 0.01, Math.max(0, (y - oy) / k))
    }

    let done = false
    const finish = (hex: string | null) => {
      if (done) return
      done = true
      cleanup()
      resolve(hex)
    }
    const onMove = (e: PointerEvent) => { touch = e.pointerType === 'touch'; toImage(e.clientX, e.clientY); draw() }
    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      touch = e.pointerType === 'touch'
      toImage(e.clientX, e.clientY); draw()
      if (!touch && e.button === 2) finish(null)
    }
    // Touch: drag the loupe around, lift the finger to pick. Mouse: click to pick.
    const onUp = (e: PointerEvent) => {
      if (e.button === 2) return
      toImage(e.clientX, e.clientY)
      finish(sampleAt(px, py))
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zi = Math.max(0, Math.min(ZOOMS.length - 1, zi + (e.deltaY > 0 ? 1 : -1)))
      draw()
    }
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1
      const nudge = (dx: number, dy: number) => {
        px = Math.min(W - 0.01, Math.max(0, Math.floor(px) + dx + 0.5))
        py = Math.min(H - 0.01, Math.max(0, Math.floor(py) + dy + 0.5))
        cx = ox + px * k; cy = oy + py * k
      }
      switch (e.key) {
        case 'Escape': finish(null); break
        case 'Enter': case ' ': finish(sampleAt(px, py)); break
        case 'ArrowLeft': nudge(-step, 0); break
        case 'ArrowRight': nudge(step, 0); break
        case 'ArrowUp': nudge(0, -step); break
        case 'ArrowDown': nudge(0, step); break
        case '+': case '=': zi = Math.max(0, zi - 1); break
        case '-': zi = Math.min(ZOOMS.length - 1, zi + 1); break
        case '1': case '3': case '5': sample = Number(e.key); break
        default: return
      }
      e.preventDefault()
      e.stopPropagation()
      draw()
    }
    const noMenu = (e: Event) => e.preventDefault()
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('contextmenu', noMenu)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', () => finish(null), { once: true })

    function cleanup() {
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(liveTimer)
      root.remove()
      shot.close()
      prevFocus?.focus?.({ preventScroll: true })
    }
    draw()
  })
}

// ───────────── recent colours ─────────────
const RECENT_KEY = 'grafi:recentColors'
export function recentColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 10) : []
  } catch { return [] }
}
export function addRecentColor(c: string | null) {
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return
  const list = [c.toLowerCase(), ...recentColors().filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 10)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}
