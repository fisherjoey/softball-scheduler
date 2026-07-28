import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getGame, getLineup, listPlayers, recentSlotHistory } from '@/lib/db/queries'
import { LineupClient } from './LineupClient'
import type { PresentPlayer } from '@/lib/types'

export const metadata = {
  title: 'Lineup',
}

/** How many past games the batting order rotates against. */
const HISTORY_GAMES = 4

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default async function LineupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [game, players, history, saved] = await Promise.all([
    getGame(id),
    listPlayers(),
    // This game is excluded from its own history: once saved, its order
    // would otherwise rotate against itself on every rebuild.
    recentSlotHistory(HISTORY_GAMES, id),
    getLineup(id),
  ])
  if (!game) notFound()

  // Attendance rows are keyed by player id; walking `players` rather than the
  // attendance rows keeps the roster in its usual active-then-alphabetical
  // order everywhere in the app.
  const attendance = new Map(game.attendance.map((row) => [row.playerId, row]))
  const present: PresentPlayer[] = players
    .filter((player) => player.isActive && attendance.get(player.id)?.isPresent)
    .map((player) => {
      const row = attendance.get(player.id)!
      return { ...player, arrivedInning: row.arrivedInning, leftInning: row.leftInning }
    })

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">
            Lineup — {formatDate(game.date)}
            {game.opponent ? ` vs ${game.opponent}` : ''}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {present.length} present · {game.innings} innings
          </p>
        </div>
        {/* Only offered once something is saved: the print view reads from the
            database, so it would be blank for an unsaved lineup. */}
        {saved && (
          <Link
            href={`/games/${game.id}/lineup/print`}
            className="flex h-11 items-center justify-center rounded-md border-2 border-zinc-400 px-4 text-sm font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
          >
            Print / share
          </Link>
        )}
      </div>

      {present.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nobody is marked present for this game yet.{' '}
          <Link href={`/games/${game.id}`} className="font-semibold underline">
            Take attendance
          </Link>{' '}
          first.
        </p>
      ) : (
        <LineupClient
          gameId={game.id}
          innings={game.innings}
          present={present}
          roster={players}
          history={history}
          saved={saved}
        />
      )}
    </main>
  )
}
