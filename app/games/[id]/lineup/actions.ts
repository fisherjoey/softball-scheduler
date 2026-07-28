'use server'

import { revalidatePath } from 'next/cache'
import { saveLineup } from '@/lib/db/queries'
import { requireSession } from '@/lib/require-session'
import type { BattingOrder, FieldingGrid } from '@/lib/types'

/**
 * Persist the lineup the captain is looking at.
 *
 * The whole grid and order travel from the client rather than being re-solved
 * here on purpose: the solver is history-dependent, so a server-side re-run
 * would save a different lineup than the one on the captain's screen. What is
 * saved is exactly what was shown, warnings and all.
 */
export async function persistLineup(
  gameId: string,
  grid: FieldingGrid,
  order: BattingOrder,
): Promise<void> {
  await requireSession()
  await saveLineup(gameId, grid, order)
  revalidatePath(`/games/${gameId}/lineup`)
}
