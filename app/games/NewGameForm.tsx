'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { newGame, type NewGameState } from './actions'

const initialState: NewGameState = {}

/**
 * Lives inside the form so `useFormStatus` sees it; disabling while pending
 * is double-tap protection — on diamond wifi the round trip is long enough
 * that a second tap lands before the redirect, and each tap is a game.
 */
function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-11 items-center justify-center rounded-md bg-zinc-900 px-4 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
    >
      {pending ? 'Creating…' : 'Create game'}
    </button>
  )
}

export interface NewGameFormProps {
  /** YYYY-MM-DD to preload the date field with, computed server-side. */
  defaultDate: string
  defaultInnings: number
}

/** The "new game" form. Client component so validation errors from `newGame`
 * render in place instead of surfacing as an unhandled action error. */
export function NewGameForm({ defaultDate, defaultInnings }: NewGameFormProps) {
  const [state, formAction] = useActionState(newGame, initialState)

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 border-t border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="date" className="text-sm font-medium text-foreground">
          Date
        </label>
        <input
          id="date"
          name="date"
          type="date"
          required
          defaultValue={defaultDate}
          className="w-full rounded-md border border-zinc-300 bg-transparent px-4 py-3 text-base text-foreground dark:border-zinc-700"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="opponent" className="text-sm font-medium text-foreground">
          Opponent
        </label>
        <input
          id="opponent"
          name="opponent"
          placeholder="Opponent (optional)"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-4 py-3 text-base text-foreground dark:border-zinc-700"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="innings" className="text-sm font-medium text-foreground">
          Innings
        </label>
        <input
          id="innings"
          name="innings"
          type="number"
          min={1}
          max={9}
          defaultValue={defaultInnings}
          className="w-full rounded-md border border-zinc-300 bg-transparent px-4 py-3 text-base text-foreground dark:border-zinc-700"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  )
}
