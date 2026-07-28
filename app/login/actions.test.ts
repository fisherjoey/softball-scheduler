import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// `server-only` (pulled in via lib/auth) throws at import time outside a
// react-server bundle; stub it the way Next's server bundler empties it.
vi.mock('server-only', () => ({}))

const cookieSet = vi.fn()

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet }),
  headers: async () => ({
    get: (name: string) => (name === 'x-forwarded-for' ? '203.0.113.7, 10.0.0.1' : null),
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    // The real redirect throws a control-flow error Next catches.
    throw new Error(`REDIRECT:${url}`)
  }),
}))

import { login } from './actions'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, verifySession } from '@/lib/auth'

function passwordForm(password: string): FormData {
  const data = new FormData()
  data.set('password', password)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-be-real'
  process.env.APP_PASSWORD = 'correct-horse-battery-staple'
})

afterEach(() => {
  delete process.env.APP_PASSWORD
})

describe('login', () => {
  it('returns an error for a wrong password and sets no cookie', async () => {
    const state = await login({}, passwordForm('wrong-password'))
    expect(state).toEqual({ error: 'Incorrect password.' })
    expect(cookieSet).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('logs the failure with the requester ip so bursts show in runtime logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await login({}, passwordForm('wrong-password'))
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0].join(' ')).toContain('203.0.113.7')
    } finally {
      warn.mockRestore()
    }
  })

  /**
   * Fail closed: an unset APP_PASSWORD must read as "nobody can log in",
   * never as "any password works". The empty-string probe matters most —
   * `'' === undefined ?? ''` bugs authenticate the empty submission.
   */
  it('never authenticates when APP_PASSWORD is not set', async () => {
    delete process.env.APP_PASSWORD
    expect(await login({}, passwordForm('anything'))).toEqual({ error: 'Incorrect password.' })
    expect(await login({}, passwordForm(''))).toEqual({ error: 'Incorrect password.' })
    expect(cookieSet).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('sets a 30-day httpOnly/secure/lax session cookie and redirects home on the right password', async () => {
    await expect(login({}, passwordForm('correct-horse-battery-staple'))).rejects.toThrow(
      'REDIRECT:/',
    )

    expect(cookieSet).toHaveBeenCalledOnce()
    const [name, token, options] = cookieSet.mock.calls[0]
    expect(name).toBe(SESSION_COOKIE)
    expect(await verifySession(token)).toBe(true)
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })
  })
})
