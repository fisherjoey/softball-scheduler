import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/auth'

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const hasValidSession = await verifySession(token)

  if (!hasValidSession) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

// `login` is excluded here (not inside the middleware body) so the redirect
// target never re-enters middleware — there is no request path that could
// loop, because Next never invokes this function for /login at all.
//
// Every alternative in the lookahead is an unauthenticated door, so each one
// is pinned down by hand — the compiled matcher is a regex, and regexes hold
// doors open in ways path lists don't:
//
// - The static-file dots are escaped: an unescaped `favicon.ico` also
//   excluded `/faviconXico`, or any other single character in the dot's spot.
// - `login` is anchored as `login(?:[/.]|$)` so `/loginfoo` is gated. Not the
//   tighter `login$|login/`: Next 16 fetches a route's data as `/login.rsc`
//   and `/login.segments/<...>.segment.rsc`, and gating those would redirect
//   a login-page data request back to the login page — a loop.
// - `i/` is the invite-redemption route and must be reachable with no cookie
//   at all, otherwise the link a teammate is sent redirects to /login and the
//   whole feature is dead. It is written with the trailing slash on purpose:
//   a bare `i` in this lookahead would exclude every path merely *starting*
//   with the letter i — `/innings`, `/import` — and quietly unauthenticate
//   them. With the slash, only `/i/<token>` gets through, and that route
//   verifies the token itself before it hands out a session.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest|login(?:[/.]|$)|i/).*)',
  ],
}
