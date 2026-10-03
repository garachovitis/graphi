// Voice-activity segmentation for on-device dictation: 30 ms frames of 16 kHz audio in, finished
// phrases out. Energy against a noise floor that is always tracked (minimum of the last 3 s), so a
// quiet microphone or speech that starts at once still works; hysteresis keeps soft word endings.
// Pure: no audio APIs, so it can be tested on recordings.

export const RATE = 16000
export const FRAME = 480 // 30 ms

const FLOOR_FRAMES = 100 // 3 s of history for the noise floor
const MIN_FLOOR = 0.0004
const START = 4 // × floor to start a phrase…
const KEEP = 2.2 // …and to stay in one
const ABS_MIN = 0.0015 // ≈ −56 dBFS: never treat hiss below this as speech
const PREROLL = 10 // 300 ms kept from before speech starts
const END_QUIET = 24 // 720 ms of quiet ends a phrase
const MAX_FRAMES = Math.floor(25_000 / 30) // Whisper's window is 30 s
const MIN_VOICED = 8 // shorter blips (clicks, breaths) are not sent on their own
const TAIL = 7 // ~200 ms of the closing pause is kept
const CARRY = 50 // a blip too short to send is prepended to a phrase starting within 1.5 s

export interface FrameResult {
  /** Microphone level 0…1 for the meter. */
  level: number
  /** A phrase just ended (null if it was too short to send; it is then kept for the next one). */
  phrase?: Float32Array | null
}

export class Segmenter {
  private ring: number[] = []
  private pre: Float32Array[] = []
  private seg: Float32Array[] = []
  private voiced = 0
  private quiet = 0
  private run = 0
  private carry: Float32Array[] = []
  private sinceCarry = 0
  private carryVoiced = 0
  speaking = false

  /** Audio of the phrase so far (for live previews). */
  current() { return concat(this.seg) }
  get frames() { return this.seg.length }

  push(f: Float32Array): FrameResult {
    let e = 0
    for (let i = 0; i < f.length; i++) e += f[i] * f[i]
    const rms = Math.sqrt(e / f.length)
    this.ring.push(rms)
    if (this.ring.length > FLOOR_FRAMES) this.ring.shift()
    const floor = Math.max(MIN_FLOOR, Math.min(...this.ring))
    const level = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 60) / 50))

    if (!this.speaking) {
      if (this.carry.length && ++this.sinceCarry > CARRY) this.carry = []
      this.pre.push(f)
      if (this.pre.length > PREROLL) this.pre.shift()
      // Two loud frames in a row start a phrase (one is usually a click).
      this.run = rms > Math.max(floor * START, ABS_MIN) ? this.run + 1 : 0
      if (this.run >= 2) {
        this.speaking = true
        this.seg = [...this.carry, ...this.pre]
        this.voiced = this.run + this.carryVoiced
        this.pre = []; this.carry = []; this.carryVoiced = 0; this.quiet = 0
      }
      return { level }
    }
    this.seg.push(f)
    if (rms > Math.max(floor * KEEP, ABS_MIN * 0.6)) { this.voiced++; this.quiet = 0 } else this.quiet++
    if (this.quiet >= END_QUIET || this.seg.length >= MAX_FRAMES) return { level, phrase: this.close() }
    return { level }
  }

  /** End the current phrase now (e.g. the user pressed Stop). */
  close(): Float32Array | null {
    const frames = this.seg.slice(0, this.seg.length - Math.max(0, this.quiet - TAIL))
    const ok = this.voiced >= MIN_VOICED
    // Too short on its own (a click, or the first syllable before a pause): keep it for the next phrase.
    if (!ok) { this.carry = frames; this.carryVoiced = this.voiced; this.sinceCarry = 0 }
    this.speaking = false; this.seg = []; this.voiced = 0; this.quiet = 0; this.run = 0
    return ok ? concat(frames) : null
  }
}

export function concat(frames: Float32Array[]) {
  const out = new Float32Array(frames.reduce((s, f) => s + f.length, 0))
  let o = 0
  for (const f of frames) { out.set(f, o); o += f.length }
  return out
}

/** Streaming box-filter downsampler to 16 kHz (enough anti-aliasing for speech). */
export function downsampler(from: number) {
  const ratio = from / RATE
  let acc = 0, n = 0, pos = 0
  return (x: Float32Array) => {
    if (ratio <= 1) return x
    const out = new Float32Array(Math.ceil(x.length / ratio) + 1)
    let k = 0
    for (let i = 0; i < x.length; i++) {
      acc += x[i]; n++; pos++
      if (pos >= ratio) { pos -= ratio; out[k++] = acc / n; acc = 0; n = 0 }
    }
    return out.subarray(0, k)
  }
}
