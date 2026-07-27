'use server'

import { revalidatePath } from 'next/cache'
import { upsertPlayer, setPlayerPositions } from '@/lib/db/queries'
import type { Position, Tier } from '@/lib/types'

/**
 * Creates or updates a player from a roster form submission. Returns the
 * player id so the caller can immediately follow up with `savePositions`
 * for a brand-new player (whose id doesn't exist until this resolves).
 */
export async function savePlayer(formData: FormData): Promise<string> {
  const rawId = formData.get('id')
  const rawName = formData.get('name')

  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    throw new Error('Name is required.')
  }

  const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : undefined

  const playerId = await upsertPlayer({
    id,
    name: rawName.trim(),
    isFemale: formData.get('isFemale') === 'on',
    isSub: formData.get('isSub') === 'on',
    isActive: formData.get('isActive') === 'on',
  })

  revalidatePath('/roster')
  return playerId
}

/** Replaces a player's eligible positions wholesale. */
export async function savePositions(
  playerId: string,
  positions: Partial<Record<Position, Tier>>,
): Promise<void> {
  await setPlayerPositions(playerId, positions)
  revalidatePath('/roster')
}
