// Tiny observable store populated by the pagination engine and read by the UI
// (page count, status bar, TOC page numbers, header/footer rendering).

type Listener = () => void

class LayoutStore {
  pageCount = 1
  /** heading node position → 1-based page number */
  headingPages = new Map<number, number>()
  /** Mirrors DocSettings.headingNumbers for the TOC node view. */
  headingNumbers = false
  /** Duration of the last pagination pass (ms), for diagnostics. */
  lastLayoutMs = 0
  /** Rounds the last layout took to place floating pictures (1 = settled at once), for diagnostics. */
  lastLayoutRounds = 0
  /** Counts layouts (each of one or more rounds). */
  layoutRun = 0
  /** Set by a round that pinned an imported picture to its page (floats.ts): the layout goes on. */
  pinning = false
  /** File ▸ Εκπαίδευση: position of the page break between the sample and the learner's
   *  pages. A table of contents then lists only the headings on its own side. */
  lessonSplit: number | null = null
  private listeners = new Set<Listener>()
  private scheduled = false

  setNumbering(on: boolean) {
    if (on === this.headingNumbers) return
    this.headingNumbers = on
    this.listeners.forEach((l) => l())
  }

  setLessonSplit(pos: number | null) {
    if (pos === this.lessonSplit) return
    this.lessonSplit = pos
    this.listeners.forEach((l) => l())
  }

  set(pageCount: number, headingPages: Map<number, number>) {
    const same =
      pageCount === this.pageCount &&
      headingPages.size === this.headingPages.size &&
      [...headingPages].every(([k, v]) => this.headingPages.get(k) === v)
    if (same) return
    this.pageCount = pageCount
    this.headingPages = headingPages
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.listeners.forEach((l) => l())
    })
  }

  subscribe(l: Listener) {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }
}

export const layoutStore = new LayoutStore()
