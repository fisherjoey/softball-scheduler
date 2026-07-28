import { describe, it, expect, beforeAll, vi } from 'vitest'

// Same tripwire stub the other server-context tests use.
vi.mock('server-only', () => ({}))

vi.mock('next/headers', () => ({
  headers: async () =>
    new Map([
      ['x-forwarded-host', 'bigbats.syncedsport.com'],
      ['x-forwarded-proto', 'https'],
    ]),
}))

vi.mock('@/lib/require-session', () => ({
  requireSession: vi.fn(async () => {}),
}))

import { createInviteLink } from './actions'
import { verifyInvite } from '@/lib/auth'

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-be-real'
})

describe('createInviteLink', () => {
  it('mints links that expire at the end of September 1st, Calgary time', async () => {
    const link = await createInviteLink()
    const rendered = new Date(link.expiresAtMs).toLocaleDateString('en-CA', {
      timeZone: 'America/Edmonton',
    })
    expect(rendered).toBe('2026-09-01')
  })

  it('mints a token the verifier accepts, pointed at the forwarded host', async () => {
    const link = await createInviteLink()
    expect(link.url).toMatch(/^https:\/\/bigbats\.syncedsport\.com\/i\//)
    const token = link.url.split('/i/')[1]
    expect(await verifyInvite(token)).toBe(true)
  })

  it('refuses to mint once the season date has passed', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-02T07:00:00Z'))
      await expect(createInviteLink()).rejects.toThrow(/invite window ended/i)
    } finally {
      vi.useRealTimers()
    }
  })
})
