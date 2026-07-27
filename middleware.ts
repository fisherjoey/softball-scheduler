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
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'],
}
