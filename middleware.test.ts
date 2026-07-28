import { describe, it, expect, vi } from 'vitest'

// `lib/auth` imports `server-only`, whose default (non react-server) entry
// throws at import time. Vitest resolves the default condition, so the marker
// has to be stubbed out here the same way Next's server bundler empties it.
vi.mock('server-only', () => ({}))

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

  /**
   * The exclusions are prefixes inside a regex, so each one has to be anchored
   * by hand or it swallows neighbours: a bare `login` also excluded
   * `/loginfoo`, and an unescaped `favicon.ico` dot also excluded
   * `/faviconXico`. Neither path exists today, but every excluded path is an
   * unauthenticated door — the matcher must not hold more doors open than the
   * routes it was written for.
   */
  it('does not let a path merely starting with login through', () => {
    expect(isGated('/loginfoo')).toBe(true)
    expect(isGated('/login2/anything')).toBe(true)
  })

  it('treats the dots in static-file exclusions as literal dots', () => {
    expect(isGated('/faviconXico')).toBe(true)
    expect(isGated('/iconAsvg')).toBe(true)
  })

  /**
   * Next 16 issues data requests for a route as `/login.rsc` and
   * `/login.segments/<...>.segment.rsc`. Anchoring the exclusion as
   * `login$|login/` would gate those, and a gated data request for the login
   * page redirects to the login page — a loop. `login(?:[/.]|$)` keeps them
   * excluded while still shutting out `/loginfoo`.
   */
  it('still excludes the login data-request URLs', () => {
    expect(isGated('/login.rsc')).toBe(false)
    expect(isGated('/login.segments/_tree.segment.rsc')).toBe(false)
  })
})
