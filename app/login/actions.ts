'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { safeEqual, SESSION_COOKIE, signSession } from '@/lib/auth'

export interface LoginState {
  error?: string
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

/**
 * Flat delay on every failed attempt. This is defense-in-depth, not rate
 * limiting: on serverless, instance-scoped state (an attempts counter, a
 * token bucket) evaporates between invocations and never sees the attempts
 * that landed on other instances, so real throttling has to live in front of
 * the function — the Vercel WAF rate-limit rule on POST /login (see the
 * README's deploy notes) — with password entropy as the actual control. The
 * delay just makes a naive single-connection guessing loop ~4/s instead of
 * hundreds/s, for the cost of a quarter second nobody typing by hand notices.
 */
const FAILURE_DELAY_MS = 250

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const password = formData.get('password')
  const appPassword = process.env.APP_PASSWORD

  // No APP_PASSWORD configured fails closed: nobody can log in, rather than
  // anybody. The comparison itself is timing-safe — see safeEqual.
  const isCorrect =
    typeof appPassword === 'string' &&
    appPassword.length > 0 &&
    typeof password === 'string' &&
    (await safeEqual(password, appPassword))

  if (!isCorrect) {
    // One warn line per failure, with the caller's IP (first hop of
    // x-forwarded-for is what Vercel's proxy saw), so a guessing burst is
    // visible in the runtime logs — which is also what a WAF rule or a
    // secret rotation would be judged against after the fact.
    const headerStore = await headers()
    const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    console.warn(`login: failed attempt from ${ip}`)

    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS))
    return { error: 'Incorrect password.' }
  }

  const token = await signSession()
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: THIRTY_DAYS_SECONDS,
    path: '/',
  })

  redirect('/')
}
