'use client'

import type { BattingOrder, PresentPlayer, Player } from '@/lib/types'

export interface BattingOrderListProps {
  order: BattingOrder
  present: PresentPlayer[]
  /**
   * The full roster, used only to resolve names.
   *
   * Deliberately NOT `present`: a saved lineup references whoever was ticked
   * present when it was generated, and attendance can change afterwards.
   * Looking names up in `present` made those players render as raw UUIDs.
   * Solver logic still uses `present` — this is display only.
   */
  roster: Player[]
}

/**
 * The batting order, one numbered row per slot.
 *
 * Automatic outs get a row of their own rather than a gap: the league awards
 * the other team an out at that spot in the order, and a captain who sees a
 * blank line assumes the app lost somebody. It reads "Automatic out", carries
 * an OUT chip and a dashed border, and still shows its slot number, because
 * the umpire counts slots.
 */
export function BattingOrderList({ order, present, roster }: BattingOrderListProps) {
  const byId = new Map(roster.map((p) => [p.id, p]))
  // Women may legally bat twice when the order needs more female slots than
  // there are women, so a name can repeat. Flag the repeat where it happens.
  const seen = new Set<string>()

  return (
    <ol className="flex flex-col gap-2" aria-label="Batting order">
      {order.slots.map((slot, index) => {
        const spot = index + 1
        const gender = order.pattern[index]

        if (slot.kind === 'autoOut') {
          return (
            <li
              key={index}
              className="flex min-h-11 items-center gap-3 rounded-lg border-2 border-dashed border-zinc-400 px-3 py-2 dark:border-zinc-500"
            >
              <span className="w-6 shrink-0 text-sm font-bold text-zinc-700 dark:text-zinc-300">
                {spot}
              </span>
              <span className="flex-1 text-base font-medium text-foreground">Automatic out</span>
              <span className="rounded-full border-2 border-zinc-700 px-2 py-0.5 text-xs font-bold text-zinc-700 dark:border-zinc-300 dark:text-zinc-300">
                Out
              </span>
            </li>
          )
        }

        const player = byId.get(slot.playerId)
        const name = player?.name ?? slot.playerId
        const repeat = seen.has(slot.playerId)
        seen.add(slot.playerId)

        return (
          <li
            key={index}
            className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          >
            <span className="w-6 shrink-0 text-sm font-bold text-zinc-700 dark:text-zinc-300">
              {spot}
            </span>
            <span className="flex-1 text-base font-medium text-foreground">{name}</span>
            {repeat && (
              <span className="rounded-full border-2 border-zinc-400 px-2 py-0.5 text-xs font-bold text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
                2nd at-bat
              </span>
            )}
            {gender && (
              <span
                className="w-5 shrink-0 text-center text-xs font-bold text-zinc-700 dark:text-zinc-300"
                aria-label={gender === 'F' ? 'female slot' : 'male or X slot'}
              >
                {gender}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
