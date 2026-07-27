'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, signSession } from '@/lib/auth'

export interface LoginState {
  error?: string
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const password = formData.get('password')
  const appPassword = process.env.APP_PASSWORD

  if (!appPassword || typeof password !== 'string' || password !== appPassword) {
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
