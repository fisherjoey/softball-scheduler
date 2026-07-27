import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, signSession, verifyInvite } from '@/lib/auth'

/**
 * Redeems an invite link for a normal session.
 *
 * The whole point is that the teammate never sees a password prompt, so this
 * is a plain GET: they tap the link in a text message and land logged in. It
 * always answers with a redirect and never renders a page of its own — the
 * token is in the URL, and a 200 here would leave it sitting in the address
 * bar to be bookmarked, screenshotted, or handed to the next person who
 * borrows the phone. Redirecting immediately replaces it with `/`.
 *
 * On success it mints a *fresh* session token rather than reusing anything
 * from the invite, and sets it with exactly the flags `login` uses, so a
 * redeemed session is indistinguishable from a typed-password one. The
 * invite's own expiry does not carry over: the link stops working on its
 * date, the session it handed out lasts the usual 30 days.
 */

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (!(await verifyInvite(token))) {
    // Says which way it failed only in general terms — expired and forged are
    // one message on purpose — but says *something*, because dumping someone
    // at a bare password box with no explanation reads as "the app is broken".
    return NextResponse.redirect(new URL('/login?invite=invalid', request.url))
  }

  const response = NextResponse.redirect(new URL('/', request.url))
  response.cookies.set(SESSION_COOKIE, await signSession(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: THIRTY_DAYS_SECONDS,
    path: '/',
  })
  return response
}
