/**
 * Draws a saved lineup onto a canvas so it can be downloaded as a PNG.
 *
 * Hand-drawn rather than screenshotting the DOM with a library: the on-screen
 * editor is a phone-first stack of cards, which is the wrong shape for
 * something you drop into a team chat. Drawing directly also means the output
 * does not inherit dark mode, viewport width, or a scroll position, and adds
 * no dependency to the bundle.
 *
 * Pure apart from the canvas it is handed — no DOM lookups, no globals.
 */

export interface LineupTable {
  title: string
  subtitle: string
  innings: number
  /** Row per position, in display order. */
  rows: Array<{ position: string; cells: string[] }>
  batting: Array<{ slot: number; label: string }>
  bench: Array<{ inning: number; sitting: string }>
  notes: string[]
}

const PAD = 28
const CELL_PAD_X = 10
const ROW_H = 30
const HEADER_H = 34
const GAP = 26
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

function textWidth(ctx: CanvasRenderingContext2D, text: string, bold = false): number {
  ctx.font = `${bold ? '700 ' : ''}15px ${FONT}`
  return ctx.measureText(text).width
}

/** Column widths sized to the widest cell, so nothing is ever clipped. */
function columnWidths(ctx: CanvasRenderingContext2D, header: string[], body: string[][]): number[] {
  return header.map((h, col) => {
    let widest = textWidth(ctx, h, true)
    for (const row of body) {
      widest = Math.max(widest, textWidth(ctx, row[col] ?? '', false))
    }
    return Math.ceil(widest) + CELL_PAD_X * 2
  })
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  caption: string,
  header: string[],
  body: string[][],
): { width: number; height: number } {
  const widths = columnWidths(ctx, header, body)
  const total = widths.reduce((a, b) => a + b, 0)

  ctx.fillStyle = '#000'
  ctx.textBaseline = 'middle'
  ctx.font = `700 16px ${FONT}`
  ctx.fillText(caption, x, y + 10)
  const top = y + 26

  // Header band.
  ctx.fillStyle = '#efefef'
  ctx.fillRect(x, top, total, HEADER_H)

  let cx = x
  ctx.font = `700 15px ${FONT}`
  ctx.fillStyle = '#000'
  header.forEach((label, i) => {
    ctx.fillText(label, cx + CELL_PAD_X, top + HEADER_H / 2)
    cx += widths[i]
  })

  // Body.
  body.forEach((row, r) => {
    let bx = x
    const by = top + HEADER_H + r * ROW_H
    // Zebra striping survives greyscale printing and photocopying.
    if (r % 2 === 1) {
      ctx.fillStyle = '#f7f7f7'
      ctx.fillRect(x, by, total, ROW_H)
    }
    ctx.fillStyle = '#000'
    row.forEach((cell, i) => {
      ctx.font = i === 0 ? `700 15px ${FONT}` : `15px ${FONT}`
      ctx.fillText(cell, bx + CELL_PAD_X, by + ROW_H / 2)
      bx += widths[i]
    })
  })

  const height = HEADER_H + body.length * ROW_H

  // Grid lines last, so they sit above the fills.
  ctx.strokeStyle = '#999'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let r = 0; r <= body.length + 1; r++) {
    const ly = Math.round(top + (r === 0 ? 0 : HEADER_H + (r - 1) * ROW_H)) + 0.5
    ctx.moveTo(x, ly)
    ctx.lineTo(x + total, ly)
  }
  let lx = x
  for (let c = 0; c <= widths.length; c++) {
    const px = Math.round(lx) + 0.5
    ctx.moveTo(px, top)
    ctx.lineTo(px, top + height)
    lx += widths[c] ?? 0
  }
  ctx.stroke()

  return { width: total, height: 26 + height }
}

/**
 * Renders `table` into `canvas`, resizing it to fit. Returns the canvas so the
 * caller can turn it into a blob.
 *
 * `scale` is the device-pixel multiplier — 2 produces a crisp image on a phone
 * screen and when zoomed.
 */
export function renderLineupToCanvas(
  canvas: HTMLCanvasElement,
  table: LineupTable,
  scale = 2,
): HTMLCanvasElement {
  const probe = canvas.getContext('2d')
  if (!probe) throw new Error('Canvas 2D context is unavailable in this browser.')

  const fieldHeader = ['Pos', ...Array.from({ length: table.innings }, (_, i) => String(i + 1))]
  const fieldBody = table.rows.map((r) => [r.position, ...r.cells])
  const battingHeader = ['#', 'Batter']
  const battingBody = table.batting.map((b) => [String(b.slot), b.label])
  const benchHeader = ['Inn', 'Sitting']
  const benchBody = table.bench.map((b) => [String(b.inning), b.sitting])

  // Measure everything against the unscaled context before resizing.
  const fieldW = columnWidths(probe, fieldHeader, fieldBody).reduce((a, b) => a + b, 0)
  const battingW = columnWidths(probe, battingHeader, battingBody).reduce((a, b) => a + b, 0)
  const benchW = columnWidths(probe, benchHeader, benchBody).reduce((a, b) => a + b, 0)

  const lowerW = battingW + GAP + benchW
  const contentW = Math.max(fieldW, lowerW, 420)

  const fieldH = 26 + HEADER_H + fieldBody.length * ROW_H
  const lowerH = 26 + HEADER_H + Math.max(battingBody.length, benchBody.length) * ROW_H
  const notesH = table.notes.length > 0 ? 24 + table.notes.length * 22 : 0
  const contentH = 64 + fieldH + GAP + lowerH + (notesH > 0 ? GAP + notesH : 0)

  canvas.width = Math.ceil((contentW + PAD * 2) * scale)
  canvas.height = Math.ceil((contentH + PAD * 2) * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is unavailable in this browser.')
  ctx.setTransform(scale, 0, 0, scale, 0, 0)

  // Always white: this gets shared, and a dark-mode export looks broken
  // everywhere it lands.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#000'
  ctx.textBaseline = 'middle'
  ctx.font = `700 22px ${FONT}`
  ctx.fillText(table.title, PAD, PAD + 12)
  ctx.font = `15px ${FONT}`
  ctx.fillStyle = '#444'
  ctx.fillText(table.subtitle, PAD, PAD + 38)

  let y = PAD + 60
  const field = drawTable(ctx, PAD, y, 'Fielding', fieldHeader, fieldBody)
  y += field.height + GAP

  drawTable(ctx, PAD, y, 'Batting order', battingHeader, battingBody)
  drawTable(ctx, PAD + battingW + GAP, y, 'Bench by inning', benchHeader, benchBody)
  y += lowerH

  if (table.notes.length > 0) {
    y += GAP
    ctx.fillStyle = '#000'
    ctx.font = `700 16px ${FONT}`
    ctx.fillText('Notes', PAD, y)
    ctx.font = `14px ${FONT}`
    table.notes.forEach((note, i) => {
      ctx.fillText(`• ${note}`, PAD, y + 22 + i * 22)
    })
  }

  return canvas
}
