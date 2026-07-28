import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// `server-only` (pulled in via lib/auth) throws at import time outside a
// react-server bundle; stub it the way Next's server bundler empties it.
vi.mock('server-only', () => ({}))

const jar = { sessionToken: undefined as string | undefined }

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.sessionToken === undefined ? undefined : { name, value: jar.sessionToken },
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/db/queries', () => ({
  upsertPlayerWithPositions: vi.fn(async () => undefined),
}))

import { saveFullPlayer } from './actions'
import { upsertPlayerWithPositions } from '@/lib/db/queries'
import { signSession } from '@/lib/auth'
import type { Position, Tier } from '@/lib/types'

const PLAYER_ID = 'a3bb189e-8bf9-3888-9912-ace4e6543002'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const validForm = () => form({ id: PLAYER_ID, name: 'Dana', isFemale: 'on', isSub: '', isActive: 'on' })

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-be-real'
})

beforeEach(async () => {
  vi.clearAllMocks()
  jar.sessionToken = await signSession()
})

describe('saveFullPlayer', () => {
  it('throws with no session cookie, before touching the database', async () => {
    jar.sessionToken = undefined
    await expect(saveFullPlayer(validForm(), { SS: 'primary' })).rejects.toThrow('Not signed in.')
    expect(upsertPlayerWithPositions).not.toHaveBeenCalled()
  })

  it('writes player and positions in one call', async () => {
    await saveFullPlayer(validForm(), { SS: 'primary', CF: 'backup' })
    expect(upsertPlayerWithPositions).toHaveBeenCalledOnce()
    expect(upsertPlayerWithPositions).toHaveBeenCalledWith(
      { id: PLAYER_ID, name: 'Dana', isFemale: true, isSub: false, isActive: true },
      { SS: 'primary', CF: 'backup' },
    )
  })

  it('rejects a position outside the whitelist without inserting', async () => {
    await expect(
      saveFullPlayer(validForm(), { XX: 'garbage' } as unknown as Partial<Record<Position, Tier>>),
    ).rejects.toThrow(/position/i)
    expect(upsertPlayerWithPositions).not.toHaveBeenCalled()
  })

  it('rejects a known position with a garbage tier without inserting', async () => {
    await expect(
      saveFullPlayer(validForm(), { SS: 'legendary' } as unknown as Partial<Record<Position, Tier>>),
    ).rejects.toThrow(/tier/i)
    expect(upsertPlayerWithPositions).not.toHaveBeenCalled()
  })

  it('rejects a missing name', async () => {
    await expect(
      saveFullPlayer(form({ id: PLAYER_ID, name: '   ' }), {}),
    ).rejects.toThrow(/name/i)
    expect(upsertPlayerWithPositions).not.toHaveBeenCalled()
  })

  it('rejects an id that is not a UUID', async () => {
    await expect(saveFullPlayer(form({ id: 'not-a-uuid', name: 'Dana' }), {})).rejects.toThrow(/id/i)
    expect(upsertPlayerWithPositions).not.toHaveBeenCalled()
  })
})
