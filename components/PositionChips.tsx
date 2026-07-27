'use client'

import { POSITIONS, type Position, type Tier } from '@/lib/types'

export interface PositionChipsProps {
  value: Partial<Record<Position, Tier>>
  onChange: (next: Partial<Record<Position, Tier>>) => void
}

/** undefined -> backup -> primary -> undefined */
function nextTier(current: Tier | undefined): Tier | undefined {
  if (current === undefined) return 'backup'
  if (current === 'backup') return 'primary'
  return undefined
}

const TIER_LABEL: Record<'unset' | Tier, string> = {
  unset: 'not selected',
  backup: 'backup',
  primary: 'primary',
}

/**
 * One tappable chip per fielding position. Tapping cycles a player's
 * eligibility tier for that position. Never mutates `value` — always
 * builds and hands back a new object, and removing a position deletes the
 * key entirely rather than setting it to `undefined` (callers, and the
 * tests, compare with deep equality against `{}`).
 */
export function PositionChips({ value, onChange }: PositionChipsProps) {
  function handleTap(position: Position) {
    const current = value[position]
    const next = nextTier(current)
    const updated: Partial<Record<Position, Tier>> = { ...value }
    if (next === undefined) {
      delete updated[position]
    } else {
      updated[position] = next
    }
    onChange(updated)
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Position eligibility">
      {POSITIONS.map((position) => {
        const tier = value[position]
        // Tri-state, so aria-pressed uses the "mixed" value for the middle
        // (backup) state rather than collapsing it to true/false.
        const ariaPressed: 'true' | 'false' | 'mixed' =
          tier === 'primary' ? 'true' : tier === 'backup' ? 'mixed' : 'false'
        const label = `${position}, ${TIER_LABEL[tier ?? 'unset']}`

        const baseClasses =
          'flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border-2 px-3 text-sm font-semibold transition-colors'

        const tierClasses =
          tier === 'primary'
            ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
            : tier === 'backup'
              ? 'border-zinc-900 bg-transparent text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
              : 'border-zinc-300 bg-transparent text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'

        return (
          <button
            key={position}
            type="button"
            aria-pressed={ariaPressed}
            aria-label={label}
            onClick={() => handleTap(position)}
            className={`${baseClasses} ${tierClasses}`}
          >
            {tier === 'primary' && <span aria-hidden="true">★</span>}
            {tier === 'backup' && <span aria-hidden="true">○</span>}
            {position}
          </button>
        )
      })}
    </div>
  )
}
