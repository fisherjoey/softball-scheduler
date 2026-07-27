import { listPlayers } from '@/lib/db/queries'
import { PlayerCard } from '@/components/PlayerCard'
import type { Player } from '@/lib/types'

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full border-2 border-zinc-400 px-2 text-xs font-bold text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
      {children}
    </span>
  )
}

function PlayerRow({ player }: { player: Player }) {
  return (
    <details className="rounded-lg border border-zinc-300 dark:border-zinc-700">
      <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 px-4 py-3">
        <span className="flex-1 text-base font-medium text-foreground">{player.name}</span>
        {player.isFemale && <Badge>F</Badge>}
        {player.isSub && <Badge>Sub</Badge>}
      </summary>
      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        <PlayerCard player={player} />
      </div>
    </details>
  )
}

export default async function RosterPage() {
  const players = await listPlayers()
  const active = players.filter((p) => p.isActive)
  const inactive = players.filter((p) => !p.isActive)

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">Roster</h1>

      <details className="rounded-lg border border-zinc-300 dark:border-zinc-700">
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 py-3 text-base font-medium text-foreground">
          + Add player
        </summary>
        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <PlayerCard />
        </div>
      </details>

      <section className="flex flex-col gap-3" aria-label="Active players">
        {active.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No active players yet. Add one above.
          </p>
        ) : (
          active.map((player) => <PlayerRow key={player.id} player={player} />)
        )}
      </section>

      {inactive.length > 0 && (
        <details className="rounded-lg border border-zinc-300 dark:border-zinc-700">
          <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 py-3 text-base font-medium text-zinc-500 dark:text-zinc-400">
            Inactive players ({inactive.length})
          </summary>
          <div className="flex flex-col gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
            {inactive.map((player) => (
              <PlayerRow key={player.id} player={player} />
            ))}
          </div>
        </details>
      )}
    </main>
  )
}
