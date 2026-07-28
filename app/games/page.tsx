import Link from 'next/link'
import { listGames } from '@/lib/db/queries'
import { RULES } from '@/lib/rules/config'
import { NewGameForm } from './NewGameForm'

export const metadata = {
  title: 'Games',
}

// Render per-request, never at build time. A static build would freeze the
// game list (and its attendance/lineup badges) at deploy time — and bake in
// a "today" default computed on the build machine. It also means the build
// itself no longer needs a reachable database.
export const dynamic = 'force-dynamic'

function formatDate(isoDate: string): string {
  // Append a noon UTC time so the date doesn't shift a day back in
  // timezones behind UTC when parsed as a bare "YYYY-MM-DD".
  const d = new Date(`${isoDate}T12:00:00Z`)
  return d.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default async function GamesPage() {
  const games = await listGames()
  // The team's "today", not UTC's: games are created evenings, and Calgary
  // evenings are already tomorrow in UTC — `toISOString()` here would default
  // every after-6pm game to the wrong date. en-CA formats as YYYY-MM-DD.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">Games</h1>

      <details className="rounded-lg border border-zinc-300 dark:border-zinc-700">
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 py-3 text-base font-medium text-foreground">
          + New game
        </summary>
        <NewGameForm defaultDate={today} defaultInnings={RULES.inningsPerGame} />
      </details>

      <section className="flex flex-col gap-3" aria-label="Games">
        {games.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No games yet. Create one above.
          </p>
        ) : (
          games.map((game) => (
            <div
              key={game.id}
              className="flex flex-col gap-2 rounded-lg border border-zinc-300 px-4 py-3 dark:border-zinc-700"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-base font-medium text-foreground">
                  {formatDate(game.date)}
                  {game.opponent ? ` vs ${game.opponent}` : ''}
                </span>
                <span className="shrink-0 text-sm text-zinc-600 dark:text-zinc-400">
                  {game.presentCount > 0 ? `${game.presentCount} here` : 'no attendance yet'}
                </span>
              </div>

              {/* A saved lineup is the thing you came back for, so it gets its
                  own link rather than hiding behind the attendance screen. */}
              <div className="flex flex-wrap gap-2">
                {game.hasLineup && (
                  <Link
                    href={`/games/${game.id}/lineup`}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-md border-2 border-zinc-900 bg-zinc-900 px-3 text-sm font-semibold text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    View lineup
                  </Link>
                )}
                <Link
                  href={`/games/${game.id}`}
                  className="flex min-h-11 flex-1 items-center justify-center rounded-md border-2 border-zinc-400 px-3 text-sm font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
                >
                  {game.presentCount > 0 ? 'Attendance' : 'Take attendance'}
                </Link>
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  )
}
