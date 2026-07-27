'use client'

import { useActionState } from 'react'
import { login, type LoginState } from './actions'

const initialState: LoginState = {}

export interface LoginFormProps {
  /** Shown above the field when an invite link failed to redeem. */
  notice?: string
}

export function LoginForm({ notice }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(login, initialState)

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <form action={formAction} className="flex w-full max-w-xs flex-col gap-4">
        <h1 className="text-center text-xl font-semibold text-foreground">Team Login</h1>
        {notice && (
          <p
            role="status"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm leading-6 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            {notice}
          </p>
        )}
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          inputMode="text"
          autoComplete="current-password"
          autoFocus
          required
          placeholder="Password"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-4 py-3 text-base text-foreground dark:border-zinc-700"
        />
        {state.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-zinc-900 px-4 py-3 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
