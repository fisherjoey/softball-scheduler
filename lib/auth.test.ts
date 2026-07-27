import { describe, it, expect, beforeAll } from 'vitest'
import { signInvite, signSession, signSessionAt, verifyInvite, verifySession } from './auth'

const DAY_MS = 24 * 60 * 60 * 1000

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

describe('invite tokens', () => {
  it('verifies a token it signed', async () => {
    expect(await verifyInvite(await signInvite(Date.now() + 30 * DAY_MS))).toBe(true)
  })

  it('rejects a tampered token', async () => {
    const token = await signInvite(Date.now() + 30 * DAY_MS)
    expect(await verifyInvite(token.slice(0, -1) + 'x')).toBe(false)
  })

  it('rejects undefined', async () => {
    expect(await verifyInvite(undefined)).toBe(false)
  })

  it('rejects garbage', async () => {
    expect(await verifyInvite('not-a-token')).toBe(false)
  })

  it('rejects a malformed token with too many parts', async () => {
    const token = await signInvite(Date.now() + 30 * DAY_MS)
    expect(await verifyInvite(`${token}.extra`)).toBe(false)
  })

  it('rejects an expiry in the past', async () => {
    expect(await verifyInvite(await signInvite(Date.now() - 1000))).toBe(false)
  })

  it('rejects an expiry absurdly far in the future', async () => {
    const year9999 = Date.UTC(9999, 0, 1)
    expect(await verifyInvite(await signInvite(year9999))).toBe(false)
  })

  it('rejects a valid signature paired with a tampered expiry', async () => {
    const token = await signInvite(Date.now() + 30 * DAY_MS)
    const [, sig] = token.split('.')
    const pushedOut = String(Date.now() + 60 * DAY_MS)
    expect(await verifyInvite(`${pushedOut}.${sig}`)).toBe(false)
  })

  it('rejects a same-length signature with the wrong content', async () => {
    const token = await signInvite(Date.now() + 30 * DAY_MS)
    const [expiresAt, sig] = token.split('.')
    const wrongSig = 'A'.repeat(sig.length)
    expect(wrongSig).not.toBe(sig)
    expect(await verifyInvite(`${expiresAt}.${wrongSig}`)).toBe(false)
  })
})

/**
 * The two token families are the same shape over the same secret, so the only
 * thing keeping them apart is the `invite:` prefix on the signed message.
 * Both directions are asserted: a leaked invite link must not become a
 * permanent session cookie, and a stolen cookie must not redeem as an invite.
 */
describe('domain separation between session and invite tokens', () => {
  it('refuses an invite token as a session', async () => {
    const invite = await signInvite(Date.now() + 30 * DAY_MS)
    expect(await verifyInvite(invite)).toBe(true)
    expect(await verifySession(invite)).toBe(false)
  })

  it('refuses a session token as an invite', async () => {
    const session = await signSession()
    expect(await verifySession(session)).toBe(true)
    expect(await verifyInvite(session)).toBe(false)
  })

  /**
   * The check above would also pass on the expiry rule alone, since a session
   * token's timestamp is always in the past. This one signs a session at a
   * future time so the expiry window is satisfied and only the signature can
   * be doing the rejecting.
   */
  it('refuses a future-dated session token as an invite, on the signature alone', async () => {
    const futureSession = await signSessionAt(Date.now() + 10 * DAY_MS)
    expect(await verifyInvite(futureSession)).toBe(false)
  })

  it('refuses an already-expired invite as a session, on the signature alone', async () => {
    const recentInvite = await signInvite(Date.now() - 1000)
    expect(await verifySession(recentInvite)).toBe(false)
  })
})
