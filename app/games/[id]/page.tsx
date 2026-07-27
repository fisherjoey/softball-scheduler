import { notFound } from 'next/navigation'
import { getGame, listPlayers } from '@/lib/db/queries'
import { AttendanceList } from '@/components/AttendanceList'

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  return d.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [game, players] = await Promise.all([getGame(id), listPlayers()])
  if (!game) notFound()

  const active = players.filter((p) => p.isActive)

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">
        {formatDate(game.date)}
        {game.opponent ? ` vs ${game.opponent}` : ''}
      </h1>

      {active.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No active players on the roster yet. Add players on the Roster tab first.
        </p>
      ) : (
        <AttendanceList
          gameId={game.id}
          innings={game.innings}
          players={active}
          initialAttendance={game.attendance}
        />
      )}
    </main>
  )
}
