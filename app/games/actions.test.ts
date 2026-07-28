import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// `server-only` (pulled in via lib/auth) throws at import time outside a
// react-server bundle; stub it the way Next's server bundler empties it.
vi.mock('server-only', () => ({}))

/**
 * The cookie jar the actions see. Tests flip `sessionToken` between a real
 * signed token and undefined to walk both sides of the session gate — the
 * gate itself (requireSession → verifySession) runs for real.
 */
const jar = { sessionToken: undefined as string | undefined }

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.sessionToken === undefined ? undefined : { name, value: jar.sessionToken },
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// The real redirect throws a control-flow error Next catches; throwing here
// too keeps "success" and "returned an error" distinguishable in tests.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

vi.mock('@/lib/db/queries', () => ({
  createGame: vi.fn(async () => 'game-1'),
  setAttendance: vi.fn(async () => undefined),
}))

import { newGame, saveAttendance } from './actions'
import { createGame, setAttendance } from '@/lib/db/queries'
import { signSession } from '@/lib/auth'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-be-real'
})

beforeEach(async () => {
  vi.clearAllMocks()
  jar.sessionToken = await signSession()
})

describe('session gate', () => {
  it('newGame with no session cookie throws before touching the database', async () => {
    jar.sessionToken = undefined
    await expect(newGame({}, form({ date: '2026-07-27' }))).rejects.toThrow('Not signed in.')
    expect(createGame).not.toHaveBeenCalled()
  })

  it('saveAttendance with no session cookie throws before touching the database', async () => {
    jar.sessionToken = undefined
    await expect(saveAttendance('game-1', [])).rejects.toThrow('Not signed in.')
    expect(setAttendance).not.toHaveBeenCalled()
  })
})

describe('newGame validation', () => {
  it('creates a game and redirects to it when the input is sound', async () => {
    await expect(newGame({}, form({ date: '2026-07-27', innings: '7' }))).rejects.toThrow(
      'REDIRECT:/games/game-1',
    )
    expect(createGame).toHaveBeenCalledWith({ date: '2026-07-27', opponent: undefined, innings: 7 })
  })

  it.each(['0', '-3', '10', 'abc', '3.5'])(
    'returns a readable error for innings %s without touching the database',
    async (innings) => {
      const state = await newGame({}, form({ date: '2026-07-27', innings }))
      expect(state.error).toMatch(/innings/i)
      expect(createGame).not.toHaveBeenCalled()
    },
  )

  it.each(['', 'yesterday', '2026-7-27', '27-07-2026', '2026-07-27T12:00'])(
    'returns a readable error for date %j without touching the database',
    async (date) => {
      const state = await newGame({}, form({ date }))
      expect(state.error).toMatch(/date/i)
      expect(createGame).not.toHaveBeenCalled()
    },
  )
})
