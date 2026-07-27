import Link from 'next/link'
import { listGames } from '@/lib/db/queries'
import { RULES } from '@/lib/rules/config'
import { newGame } from './actions'

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
  const today = new Date().toISOString().slice(0, 10)

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">Games</h1>

      <details className="rounded-lg border border-zinc-300 dark:border-zinc-700">
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 py-3 text-base font-medium text-foreground">
          + New game
        </summary>
        <form
          action={newGame}
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
              defaultValue={today}
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
              defaultValue={RULES.inningsPerGame}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-4 py-3 text-base text-foreground dark:border-zinc-700"
            />
          </div>

          <button
            type="submit"
            className="flex h-11 items-center justify-center rounded-md bg-zinc-900 px-4 text-base font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Create game
          </button>
        </form>
      </details>

      <section className="flex flex-col gap-3" aria-label="Games">
        {games.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No games yet. Create one above.
          </p>
        ) : (
          games.map((game) => (
            <Link
              key={game.id}
              href={`/games/${game.id}`}
              className="flex min-h-11 items-center justify-between rounded-lg border border-zinc-300 px-4 py-3 dark:border-zinc-700"
            >
              <span className="text-base font-medium text-foreground">
                {formatDate(game.date)}
                {game.opponent ? ` vs ${game.opponent}` : ''}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {game.innings} inn
              </span>
            </Link>
          ))
        )}
      </section>
    </main>
  )
}
