'use client'

import { POSITIONS, type BattingOrder, type FieldingGrid, type Position, type PresentPlayer } from '@/lib/types'

export interface PlayerSummaryProps {
  present: PresentPlayer[]
  grid: FieldingGrid
  order: BattingOrder
}

interface Row {
  player: PresentPlayer
  inningsPlayed: number
  /** Positions covered, with how many innings at each. */
  positions: Array<{ position: Position; count: number }>
  /** 1-based batting spots. More than one when a woman bats twice. */
  battingSpots: number[]
}

function summarise(present: PresentPlayer[], grid: FieldingGrid, order: BattingOrder): Row[] {
  const counts = new Map<string, Map<Position, number>>()
  for (const assignment of grid.assignments) {
    for (const [position, id] of Object.entries(assignment) as [Position, string][]) {
      if (!counts.has(id)) counts.set(id, new Map())
      const perPosition = counts.get(id)!
      perPosition.set(position, (perPosition.get(position) ?? 0) + 1)
    }
  }

  const spots = new Map<string, number[]>()
  order.slots.forEach((slot, index) => {
    if (slot.kind !== 'player') return
    if (!spots.has(slot.playerId)) spots.set(slot.playerId, [])
    spots.get(slot.playerId)!.push(index + 1)
  })

  return present.map((player) => {
    const perPosition = counts.get(player.id) ?? new Map<Position, number>()
    const positions = POSITIONS.filter((p) => perPosition.has(p)).map((position) => ({
      position,
      count: perPosition.get(position)!,
    }))
    return {
      player,
      inningsPlayed: positions.reduce((total, entry) => total + entry.count, 0),
      positions,
      battingSpots: spots.get(player.id) ?? [],
    }
  })
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full border-2 border-zinc-400 px-2 text-xs font-bold text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
      {children}
    </span>
  )
}

/**
 * Per-player answer to the two questions the captain gets asked all night:
 * "how many innings am I getting?" and "when do I bat?".
 *
 * Sorted by innings played, fewest first, so whoever has the most reason to
 * complain is at the top where the captain can act on it before they ask.
 */
export function PlayerSummary({ present, grid, order }: PlayerSummaryProps) {
  const rows = summarise(present, grid, order).sort(
    (a, b) => a.inningsPlayed - b.inningsPlayed || a.player.name.localeCompare(b.player.name),
  )

  return (
    <ul className="flex flex-col gap-2" aria-label="Per-player summary">
      {rows.map(({ player, inningsPlayed, positions, battingSpots }) => (
        <li
          key={player.id}
          className="flex flex-col gap-1 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700"
        >
          <div className="flex items-center gap-2">
            <span className="flex-1 text-base font-medium text-foreground">{player.name}</span>
            {player.isFemale && <Badge>F</Badge>}
            {player.isSub && <Badge>Sub</Badge>}
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-foreground">
              {inningsPlayed} of {grid.innings} innings
            </span>
            {' · '}
            {battingSpots.length === 0
              ? 'not in the batting order'
              : `bats ${battingSpots.map((s) => `#${s}`).join(' and ')}`}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {positions.length === 0
              ? 'On the bench all game.'
              : positions
                  .map(({ position, count }) => (count > 1 ? `${position} ×${count}` : position))
                  .join(', ')}
          </p>
        </li>
      ))}
    </ul>
  )
}
