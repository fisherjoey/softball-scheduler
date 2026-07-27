'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createGame, setAttendance } from '@/lib/db/queries'

/** Creates a game from the "new game" form and jumps straight to its attendance screen. */
export async function newGame(formData: FormData): Promise<void> {
  const rawDate = formData.get('date')
  const rawOpponent = formData.get('opponent')
  const rawInnings = formData.get('innings')

  if (typeof rawDate !== 'string' || rawDate.trim().length === 0) {
    throw new Error('Date is required.')
  }

  const innings =
    typeof rawInnings === 'string' && rawInnings.trim().length > 0
      ? Number(rawInnings)
      : undefined

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
  await setAttendance(gameId, rows)
  revalidatePath(`/games/${gameId}`)
}
