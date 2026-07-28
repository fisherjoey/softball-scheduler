'use server'

import { headers } from 'next/headers'
import { signInvite } from '@/lib/auth'
import { requireSession } from '@/lib/require-session'

// A week, not the session's 30 days: the link is a credential that travels
// in plaintext (text messages, chat logs, server logs), so its blast radius
// is kept small. It exists to onboard the other captain, not to be a
// standing key — a fresh one is one tap away.
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

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

  const expiresAtMs = Date.now() + INVITE_LIFETIME_MS
  const token = await signInvite(expiresAtMs)

  return { url: `${protocol}://${host}/i/${token}`, expiresAtMs }
}

function firstValue(header: string | null): string | undefined {
  const value = header?.split(',')[0]?.trim()
  return value ? value : undefined
}

function isLocal(host: string): boolean {
  const hostname = host.split(':')[0]
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
