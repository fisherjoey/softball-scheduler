'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createGame, setAttendance } from '@/lib/db/queries'
import { requireSession } from '@/lib/require-session'

export interface NewGameState {
  error?: string
}

// Innings ceiling for validation. CSSC games are 7 innings; 9 leaves slack
// for other rulebooks without letting a typo like 77 create a game whose
// lineup page renders 77 columns.
const MAX_INNINGS = 9

/**
 * Creates a game from the "new game" form and jumps straight to its
 * attendance screen. Shaped for `useActionState`: validation problems come
 * back as `{ error }` for the form to render in place, success redirects.
 */
export async function newGame(_prevState: NewGameState, formData: FormData): Promise<NewGameState> {
  await requireSession()

  const rawDate = formData.get('date')
  const rawOpponent = formData.get('opponent')
  const rawInnings = formData.get('innings')

  // The date input already enforces this shape in a browser, but the action
  // is callable without the form — and a malformed date would otherwise get
  // as far as Postgres and come back as an unreadable driver error.
  if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return { error: 'Pick a date for the game.' }
  }

  let innings: number | undefined
  if (typeof rawInnings === 'string' && rawInnings.trim().length > 0) {
    const parsed = Number(rawInnings)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_INNINGS) {
      return { error: `Innings must be a whole number from 1 to ${MAX_INNINGS}.` }
    }
    innings = parsed
  }

  const id = await createGame({
    date: rawDate,
    opponent:
      typeof rawOpponent === 'string' && rawOpponent.trim().length > 0
        ? rawOpponent.trim()
        : undefined,
    innings,
  })

  revalidatePath('/games')
  redirect(`/games/${id}`)
}

/** Replaces a game's attendance wholesale from the live checkbox state. */
export async function saveAttendance(
  gameId: string,
  rows: Array<{ playerId: string; isPresent: boolean; arrivedInning: number; leftInning: number | null }>,
): Promise<void> {
  await requireSession()
  await setAttendance(gameId, rows)
  revalidatePath(`/games/${gameId}`)
}
