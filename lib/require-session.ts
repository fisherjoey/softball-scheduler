// This module reads request cookies, which only exists in the Node server
// runtime — the marker keeps it out of client bundles at build time.
import 'server-only'

import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySession } from './auth'

/**
 * Throws unless the request carries a valid session cookie. Call it first in
 * every mutating server action.
 *
 * A server action is a POST endpoint like any other — middleware gating the
 * page that renders the form says nothing about who can invoke the action
 * directly. Each action re-checks for itself.
 *
 * Lives in its own module rather than `lib/auth` because `next/headers` does
 * not exist in the Edge runtime, and `lib/auth` is bundled into middleware —
 * importing this from there would break the middleware build. `lib/auth`
 * stays runtime-neutral; the request-reading side lives here.
 */
export async function requireSession(): Promise<void> {
  const cookieStore = await cookies()
  if (!(await verifySession(cookieStore.get(SESSION_COOKIE)?.value))) {
    throw new Error('Not signed in.')
  }
}
