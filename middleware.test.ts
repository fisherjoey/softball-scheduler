import { describe, it, expect } from 'vitest'
import { config } from './middleware'

/**
 * Guards the matcher, which is the single point where this feature can die
 * silently: too tight and the invite link redirects to /login before the
 * redemption route ever runs, too loose and a page that should need a session
 * stops needing one. Neither failure shows up in a route or auth test.
 *
 * Next compiles the matcher with path-to-regexp; anchoring it here is a close
 * enough stand-in to catch a prefix that swallows more paths than intended.
 */
const matcher = new RegExp(`^${config.matcher[0]}$`)

/** True when middleware runs for the path — i.e. the path is behind the gate. */
function isGated(path: string): boolean {
  return matcher.test(path)
}

describe('middleware matcher', () => {
  it.each(['/', '/roster', '/games', '/games/abc-123', '/games/abc-123/lineup', '/i', '/invite'])(
    'gates %s',
    (path) => {
      expect(isGated(path)).toBe(true)
    },
  )

  it.each(['/login', '/_next/static/chunks/main.js', '/_next/image', '/favicon.ico'])(
    'lets %s through',
    (path) => {
      expect(isGated(path)).toBe(false)
    },
  )

  it('lets the invite redemption route through unauthenticated', () => {
    expect(isGated('/i/1790000000000.abcDEF-_123')).toBe(false)
  })

  it('does not let a path merely starting with i through', () => {
    expect(isGated('/import')).toBe(true)
    expect(isGated('/innings/3')).toBe(true)
  })
})
