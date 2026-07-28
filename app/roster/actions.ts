'use server'

import { revalidatePath } from 'next/cache'
import { upsertPlayerWithPositions } from '@/lib/db/queries'
import { requireSession } from '@/lib/require-session'
import { POSITIONS, type Position, type Tier } from '@/lib/types'

// Bare-minimum UUID shape check (any version). The id column is a Postgres
// uuid, so garbage would bounce anyway — but as an unreadable driver error,
// and only after the transaction has started.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `positions` arrives straight from the client as an arbitrary object, and
 * the position/tier columns are plain text — an unvalidated key would insert
 * fine and then be silently dropped by every read that folds rows into
 * `Partial<Record<Position, Tier>>`. Data that saves but never loads is worse
 * than an error, so refuse it loudly here.
 */
function assertValidPositions(positions: Partial<Record<Position, Tier>>): void {
  for (const [position, tier] of Object.entries(positions)) {
    if (!(POSITIONS as readonly string[]).includes(position)) {
      throw new Error(`Unknown position: ${position}`)
    }
    if (tier !== 'primary' && tier !== 'backup') {
      throw new Error(`Unknown tier for ${position}: ${String(tier)}`)
    }
  }
}

/**
 * Creates or updates a player — name, flags, and eligible positions — in a
 * single call.
 *
 * One action on purpose, where this used to be a savePlayer/savePositions
 * pair: two sequential POSTs from a phone at the diamond meant a dropped
 * second request left a player with no positions, and a retry of the first
 * created a duplicate. The id always comes from the client (existing players
 * have one, new players mint one with `crypto.randomUUID()`), and the write
 * is an upsert on that id, so resubmitting after a lost response converges on
 * the same row instead of creating a twin.
 */
export async function saveFullPlayer(
  formData: FormData,
  positions: Partial<Record<Position, Tier>>,
): Promise<void> {
  await requireSession()

  const rawId = formData.get('id')
  const rawName = formData.get('name')

  if (typeof rawId !== 'string' || !UUID_PATTERN.test(rawId)) {
    throw new Error('Player id is malformed.')
  }
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    throw new Error('Name is required.')
  }
  assertValidPositions(positions)

  await upsertPlayerWithPositions(
    {
      id: rawId,
      name: rawName.trim(),
      isFemale: formData.get('isFemale') === 'on',
      isSub: formData.get('isSub') === 'on',
      isActive: formData.get('isActive') === 'on',
    },
    positions,
  )

  revalidatePath('/roster')
}
