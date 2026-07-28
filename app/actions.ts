'use server'

import { headers } from 'next/headers'
import { signInvite } from '@/lib/auth'
import { requireSession } from '@/lib/require-session'

/**
 * Every invite works until the season ends, full stop — Joey's call
 * (2026-07-27), chosen over a rolling one-week lifetime with the security
 * trade-off understood: a link sent in week one still works for the teammate
 * who only gets around to opening it in week five.
 *
 * 23:59 Mountain on September 1st, expressed in UTC (MDT is UTC-6). When the
 * date passes, minting refuses with a message naming this constant; bump it
 * to the new season's end date. Keep it within 90 days of "now" when you do —
 * verifyInvite caps how far out an expiry may sit (MAX_INVITE_LIFETIME_MS in
 * lib/auth.ts), and a date beyond the cap mints links that are dead on
 * arrival.
 */
const INVITE_EXPIRES_AT_MS = Date.UTC(2026, 8, 2, 5, 59)

export interface InviteLink {
  /** Absolute URL to hand to a teammate. */
  url: string
  /** When the link stops working, for the caller to render in words. */
  expiresAtMs: number
}

/**
 * Mints a shareable link that logs whoever opens it straight in.
 *
 * Re-checks the session even though middleware already gates `/`: a server
 * action is a POST endpoint like any other, and this one hands out a
 * credential. Middleware covering the route today is not a reason for the
 * action to assume it.
 *
 * The origin comes from the request headers rather than a configured base URL
 * so a link generated on the deployed site points at the deployed site and
 * one generated on localhost points at localhost — nobody has to remember to
 * set a variable, and there is no way to generate a link for the wrong host.
 */
export async function createInviteLink(): Promise<InviteLink> {
  await requireSession()

  if (Date.now() >= INVITE_EXPIRES_AT_MS) {
    throw new Error(
      'The invite window ended September 1. Set the new season’s date (INVITE_EXPIRES_AT_MS in app/actions.ts) to share access again.',
    )
  }

  const headerStore = await headers()
  // `x-forwarded-*` is what a proxy (Vercel, nginx) sets; `host` is the direct
  // case. Both can arrive comma-joined through a chain of proxies, so take the
  // first hop, which is the one the browser actually asked for.
  const host = firstValue(headerStore.get('x-forwarded-host') ?? headerStore.get('host'))
  if (!host) {
    throw new Error('Could not work out this site’s address.')
  }
  const forwardedProto = firstValue(headerStore.get('x-forwarded-proto'))
  const protocol = forwardedProto ?? (isLocal(host) ? 'http' : 'https')

  const token = await signInvite(INVITE_EXPIRES_AT_MS)

  return { url: `${protocol}://${host}/i/${token}`, expiresAtMs: INVITE_EXPIRES_AT_MS }
}

function firstValue(header: string | null): string | undefined {
  const value = header?.split(',')[0]?.trim()
  return value ? value : undefined
}

function isLocal(host: string): boolean {
  const hostname = host.split(':')[0]
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
