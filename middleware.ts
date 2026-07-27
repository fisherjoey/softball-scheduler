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
// `i/` is the invite-redemption route and must be reachable with no cookie at
// all, otherwise the link a teammate is sent redirects to /login and the whole
// feature is dead. It is written with the trailing slash on purpose: a bare
// `i` in this lookahead would exclude every path merely *starting* with the
// letter i — `/innings`, `/import` — and quietly unauthenticate them. With the
// slash, only `/i/<token>` gets through, and that route verifies the token
// itself before it hands out a session.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|i/).*)'],
}
