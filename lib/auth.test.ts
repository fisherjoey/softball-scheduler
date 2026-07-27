import { describe, it, expect, beforeAll } from 'vitest'
import { signSession, signSessionAt, verifySession } from './auth'

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-be-real'
})

describe('session tokens', () => {
  it('verifies a token it signed', async () => {
    expect(await verifySession(await signSession())).toBe(true)
  })

  it('rejects a tampered token', async () => {
    const token = await signSession()
    expect(await verifySession(token.slice(0, -1) + 'x')).toBe(false)
  })

  it('rejects undefined', async () => {
    expect(await verifySession(undefined)).toBe(false)
  })

  it('rejects garbage', async () => {
    expect(await verifySession('not-a-token')).toBe(false)
  })

  it('rejects a token older than 30 days', async () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000
    const token = await signSessionAt(thirtyOneDaysAgo)
    expect(await verifySession(token)).toBe(false)
  })

  it('rejects a valid signature paired with a tampered timestamp', async () => {
    const token = await signSessionAt(Date.now())
    const [, sig] = token.split('.')
    const tamperedTimestamp = String(Date.now() - 1000)
    expect(await verifySession(`${tamperedTimestamp}.${sig}`)).toBe(false)
  })

  it('rejects a same-length signature with the wrong content', async () => {
    const token = await signSession()
    const [issuedAt, sig] = token.split('.')
    const wrongSig = 'A'.repeat(sig.length)
    expect(wrongSig).not.toBe(sig)
    expect(await verifySession(`${issuedAt}.${wrongSig}`)).toBe(false)
  })
})
