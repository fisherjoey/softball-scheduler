import { describe, expect, it } from 'vitest'
import { renderLineupToCanvas, type LineupTable } from './lineupCanvas'

// Mirror the module's layout constants so the assertions can talk about the
// same geometry (padding on each side, device-pixel scale).
const PAD = 28
const SCALE = 2

const LONG_TITLE = 'Sunday June 14 — vs The Bat Intentions (doubleheader, game 2)'

// Real solver warning shapes (buildFieldingGrid / buildBattingOrder): long
// prose sentences whose actionable tail is exactly what used to get clipped.
const WARNINGS = [
  "Nobody present is listed at SS, LF, RF. Filled anyway — set someone's eligibility to fix this.",
  'Only a sub is listed at 1B, so a sub has to field. Add a roster player there to fix this.',
]

/**
 * Deterministic 2D-context stub. jsdom has no canvas backend, which suits us:
 * the module is pure layout arithmetic on top of measureText, so a fixed
 * per-character width (0.55 × font size) makes every layout decision exactly
 * reproducible, and recording fillText lets the test replay the geometry.
 */
function makeStubCanvas() {
  const calls: Array<{ text: string; x: number; y: number; font: string }> = []
  const measure = (text: string, font: string): number => {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 15)
    return text.length * px * 0.55
  }
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textBaseline: 'alphabetic',
    measureText(text: string) {
      return { width: measure(text, this.font) } as TextMetrics
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ text, x, y, font: this.font })
    },
    fillRect() {},
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, calls, measure }
}

/** A deliberately narrow lineup: every table column is well under 420px. */
function makeTable(overrides: Partial<LineupTable> = {}): LineupTable {
  return {
    title: 'Jun 12 vs Hawks',
    subtitle: 'Wednesday league — Field 3',
    innings: 7,
    rows: [
      { position: 'P', cells: ['Ali', 'Ali', 'Ali', 'Ali', 'Ali', 'Ali', 'Ali'] },
      { position: 'C', cells: ['Sam', 'Sam', 'Sam', 'Sam', 'Sam', 'Sam', 'Sam'] },
    ],
    batting: [
      { slot: 1, label: 'Ali' },
      { slot: 2, label: 'Sam' },
    ],
    bench: [{ inning: 1, sitting: 'Sam' }],
    notes: [],
    ...overrides,
  }
}

describe('renderLineupToCanvas', () => {
  it('never paints text past the right edge of the canvas', () => {
    const { canvas, calls, measure } = makeStubCanvas()
    renderLineupToCanvas(canvas, makeTable({ title: LONG_TITLE, notes: WARNINGS }), SCALE)

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      // Coordinates are logical (pre-scale) px; canvas.width is physical.
      expect(call.x + measure(call.text, call.font)).toBeLessThanOrEqual(canvas.width / SCALE)
    }
  })

  it('widens the canvas to fit a long single-line title', () => {
    const { canvas, measure } = makeStubCanvas()
    renderLineupToCanvas(canvas, makeTable({ title: LONG_TITLE }), SCALE)

    const titleW = measure(LONG_TITLE, '700 22px')
    expect(canvas.width / SCALE).toBeGreaterThanOrEqual(titleW + PAD * 2)
  })

  it('wraps long notes into extra height instead of width beyond the cap', () => {
    const short = makeStubCanvas()
    renderLineupToCanvas(short.canvas, makeTable({ notes: ['Bring the good bats.'] }), SCALE)

    const long = makeStubCanvas()
    renderLineupToCanvas(long.canvas, makeTable({ notes: WARNINGS }), SCALE)

    // Tables and title here are narrow, so the wrap cap is the 560 floor:
    // notes may widen the image to 560 content px and no further.
    expect(long.canvas.width).toBeLessThanOrEqual(Math.ceil((560 + PAD * 2) * SCALE))

    // The overflow shows up as extra wrapped lines — more height, and more
    // note-font fillText calls than there are notes.
    expect(long.canvas.height).toBeGreaterThan(short.canvas.height)
    const noteCalls = long.calls.filter((c) => c.font.startsWith('14px'))
    expect(noteCalls.length).toBeGreaterThan(WARNINGS.length)
  })

  it('keeps every word of a wrapped note, with a hanging indent under the bullet', () => {
    const { canvas, calls, measure } = makeStubCanvas()
    renderLineupToCanvas(canvas, makeTable({ notes: WARNINGS }), SCALE)

    const noteCalls = calls.filter((c) => c.font.startsWith('14px'))
    const indent = PAD + measure('• ', '14px')

    // Rebuild each note from its drawn lines: a bullet starts a note,
    // bullet-less lines are continuations aligned under the note text.
    const rebuilt: string[] = []
    for (const call of noteCalls) {
      if (call.text.startsWith('• ')) {
        expect(call.x).toBe(PAD)
        rebuilt.push(call.text.slice('• '.length))
      } else {
        expect(call.x).toBe(indent)
        rebuilt[rebuilt.length - 1] += ` ${call.text}`
      }
    }
    expect(rebuilt).toEqual(WARNINGS)
  })

  it('keeps the 420 content-width minimum for short lineups', () => {
    const { canvas } = makeStubCanvas()
    renderLineupToCanvas(canvas, makeTable(), SCALE)

    expect(canvas.width).toBe(Math.ceil((420 + PAD * 2) * SCALE))
  })
})
