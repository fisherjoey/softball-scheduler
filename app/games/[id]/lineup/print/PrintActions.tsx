'use client'

import { useRef, useState } from 'react'
import { renderLineupToCanvas, type LineupTable } from '@/lib/export/lineupCanvas'

const BUTTON =
  'flex h-11 items-center justify-center rounded-md border-2 px-4 text-sm font-semibold transition-colors'
const PRIMARY =
  'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
const SECONDARY = 'border-zinc-400 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300'

export interface PrintActionsProps {
  /** Everything the PNG renderer needs, already flattened by the server. */
  table: LineupTable
  /** Used for the downloaded file name. */
  fileName: string
}

/**
 * Print and image-download buttons.
 *
 * Print is the PDF path: every browser, desktop and phone, can save its print
 * output as a PDF, and it produces real vector text rather than a screenshot.
 * The PNG is the share path — what actually gets pasted into a team chat.
 */
export function PrintActions({ table, fileName }: PrintActionsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function downloadImage() {
    setError(null)
    setBusy(true)
    try {
      const canvas = canvasRef.current ?? document.createElement('canvas')
      canvasRef.current = canvas
      renderLineupToCanvas(canvas, table)

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      )
      if (!blob) throw new Error('The browser could not produce an image.')

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => window.print()} className={`${BUTTON} ${PRIMARY}`}>
          Print / save PDF
        </button>
        <button
          type="button"
          onClick={downloadImage}
          disabled={busy}
          className={`${BUTTON} ${SECONDARY} disabled:opacity-60`}
        >
          {busy ? 'Building…' : 'Download image'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
