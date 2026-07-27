'use client'

import { useRef, useState } from 'react'
import { PositionChips } from './PositionChips'
import { savePlayer, savePositions } from '@/app/roster/actions'
import type { Player, Position, Tier } from '@/lib/types'

export interface PlayerCardProps {
  /** Omit to render the "add a new player" form instead of an edit form. */
  player?: Player
}

const TOGGLE_BASE =
  'flex h-11 flex-1 items-center justify-center rounded-md border-2 text-sm font-semibold transition-colors'
const TOGGLE_ON =
  'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
const TOGGLE_OFF = 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'

/**
 * Add/edit form for a single player: name, female + sub toggles, position
 * eligibility chips, and (for existing players) an activate/deactivate
 * toggle. Deactivating never deletes the row, so game history referencing
 * this player survives.
 *
 * Saving calls two server actions in sequence — `savePlayer` (name/flags)
 * then `savePositions` (eligibility) — because the underlying queries are
 * separate tables. On success the form collapses its enclosing `<details>`
 * (if any) so the roster list reads as "tap to edit, save to close"; on
 * failure nothing collapses so the captain can fix and retry.
 */
export function PlayerCard({ player }: PlayerCardProps) {
  const isNew = !player
  const formRef = useRef<HTMLFormElement>(null)

  const [positions, setPositions] = useState<Partial<Record<Position, Tier>>>(
    player?.positions ?? {},
  )
  const [isFemale, setIsFemale] = useState(player?.isFemale ?? false)
  const [isSub, setIsSub] = useState(player?.isSub ?? false)
  const [isActive, setIsActive] = useState(player?.isActive ?? true)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setIsPending(true)
    try {
      const id = await savePlayer(formData)
      await savePositions(id, positions)

      formRef.current?.closest('details')?.removeAttribute('open')
      if (isNew) {
        formRef.current?.reset()
        setPositions({})
        setIsFemale(false)
        setIsSub(false)
        setIsActive(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  const idFor = (field: string) => `${field}-${player?.id ?? 'new'}`

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={player?.id ?? ''} />
      <input type="hidden" name="isFemale" value={isFemale ? 'on' : ''} />
      <input type="hidden" name="isSub" value={isSub ? 'on' : ''} />
      <input type="hidden" name="isActive" value={isActive ? 'on' : ''} />

      <div className="flex flex-col gap-1">
        <label htmlFor={idFor('name')} className="text-sm font-medium text-foreground">
          Name
        </label>
        <input
          id={idFor('name')}
          name="name"
          defaultValue={player?.name ?? ''}
          required
          placeholder="Player name"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-4 py-3 text-base text-foreground dark:border-zinc-700"
        />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          aria-pressed={isFemale}
          onClick={() => setIsFemale((v) => !v)}
          className={`${TOGGLE_BASE} ${isFemale ? TOGGLE_ON : TOGGLE_OFF}`}
        >
          Female
        </button>
        <button
          type="button"
          aria-pressed={isSub}
          onClick={() => setIsSub((v) => !v)}
          className={`${TOGGLE_BASE} ${isSub ? TOGGLE_ON : TOGGLE_OFF}`}
        >
          Sub
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Eligible positions</span>
        <PositionChips value={positions} onChange={setPositions} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="flex h-11 flex-1 items-center justify-center rounded-md bg-zinc-900 px-4 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={() => setIsActive((v) => !v)}
            className="flex h-11 items-center justify-center rounded-md border-2 border-zinc-300 px-4 text-base font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            {isActive ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
      </div>
    </form>
  )
}
