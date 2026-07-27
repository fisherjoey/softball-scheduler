import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getGame, getLineup, listPlayers } from '@/lib/db/queries'
import { POSITIONS, type Player, type Position } from '@/lib/types'
import { PrintActions } from './PrintActions'

/**
 * The shareable view of a saved lineup: one table, no controls, no chrome.
 *
 * This is a separate route rather than a print stylesheet over the editor
 * because the two want opposite layouts. The editor is a phone-first stack of
 * per-inning cards with tap targets; what a captain hands to a scorekeeper or
 * drops in the team chat is a single wide grid. Trying to make one set of
 * markup do both would compromise both.
 *
 * PDF comes free from the browser's own print dialog, which every phone has —
 * no dependency, and it produces a real vector PDF rather than a screenshot.
 */

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  return d.toLocaleDateString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Two people called "Dan" must not both render as "Dan". Use the shortest
 * prefix of the full name that is unique across the roster.
 */
function displayNames(players: Player[]): Map<string, string> {
  const out = new Map<string, string>()
  const firstNames = new Map<string, string[]>()
  for (const p of players) {
    const first = p.name.split(/\s+/)[0] ?? p.name
    firstNames.set(first, [...(firstNames.get(first) ?? []), p.id])
  }
  for (const p of players) {
    const first = p.name.split(/\s+/)[0] ?? p.name
    const clashes = firstNames.get(first) ?? []
    out.set(p.id, clashes.length > 1 ? p.name : first)
  }
  return out
}

export default async function PrintLineupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [game, players, saved] = await Promise.all([getGame(id), listPlayers(), getLineup(id)])
  if (!game) notFound()

  const byId = new Map(players.map((p) => [p.id, p]))
  const names = displayNames(players)

  if (!saved) {
    return (
      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        <h1 className="text-xl font-semibold text-foreground">Nothing to print yet</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This game has no saved lineup.{' '}
          <Link href={`/games/${id}/lineup`} className="font-semibold underline">
            Generate and save one
          </Link>{' '}
          first.
        </p>
      </main>
    )
  }

  const { grid, order } = saved
  const inningNumbers = Array.from({ length: grid.innings }, (_, i) => i + 1)

  // Only show rows for positions actually in play — a short-handed game drops
  // ROVER and RF, and printing empty rows for them invites someone to fill
  // them in.
  const activePositions: Position[] = POSITIONS.filter((pos) =>
    grid.assignments.some((inning) => inning[pos] !== undefined),
  )

  const batting = players.filter((p) =>
    order.slots.some((s) => s.kind === 'player' && s.playerId === p.id),
  )

  const benchByInning = inningNumbers.map((inning) => {
    const onField = new Set(Object.values(grid.assignments[inning - 1] ?? {}))
    return batting.filter((p) => !onField.has(p.id))
  })

  const heading = `${formatDate(game.date)}${game.opponent ? ` vs ${game.opponent}` : ''}`

  // Flattened here rather than in the client component: the renderer should
  // draw, not go looking things up.
  const table = {
    title: heading,
    subtitle: `${grid.innings} innings · ${order.slots.length} batting · ${batting.length} players`,
    innings: grid.innings,
    rows: activePositions.map((pos) => ({
      position: pos,
      cells: inningNumbers.map((i) => {
        const playerId = grid.assignments[i - 1]?.[pos]
        return playerId ? (names.get(playerId) ?? '?') : '—'
      }),
    })),
    batting: order.slots.map((slot, index) => ({
      slot: index + 1,
      label:
        slot.kind === 'autoOut'
          ? 'AUTOMATIC OUT'
          : `${byId.get(slot.playerId)?.name ?? 'unknown'}${
              byId.get(slot.playerId)?.isFemale ? ' (F)' : ''
            }${byId.get(slot.playerId)?.isSub ? ' (sub)' : ''}`,
    })),
    bench: benchByInning.map((bench, index) => ({
      inning: index + 1,
      sitting: bench.length === 0 ? '—' : bench.map((p) => names.get(p.id) ?? p.name).join(', '),
    })),
    notes: [...grid.warnings, ...order.warnings],
  }

  const fileName = `lineup-${game.date.slice(0, 10)}${
    game.opponent ? `-vs-${game.opponent.replace(/[^a-zA-Z0-9]+/g, '-')}` : ''
  }`

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-6 print:px-0 print:py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Print / save</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Print gives you a PDF. On a phone: share sheet → Print → pinch out to save.
          </p>
        </div>
        <PrintActions table={table} fileName={fileName} />
      </div>

      <section className="flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 text-black dark:border-zinc-700 print:rounded-none print:border-0 print:p-0 print:text-black">
        <header className="flex flex-col gap-0.5">
          <h2 className="text-lg font-bold text-foreground print:text-black">
            {heading}
          </h2>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 print:text-black">
            {grid.innings} innings · {order.slots.length} batting ·{' '}
            {players.filter((p) => order.slots.some((s) => s.kind === 'player' && s.playerId === p.id))
              .length}{' '}
            players
          </p>
        </header>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-sm print:text-[10pt]">
            <caption className="pb-1 text-left text-sm font-bold text-foreground print:text-black">
              Fielding
            </caption>
            <thead>
              <tr>
                <th className="border border-zinc-400 bg-zinc-100 px-2 py-1 text-left font-bold text-black print:bg-white">
                  Pos
                </th>
                {inningNumbers.map((i) => (
                  <th
                    key={i}
                    className="border border-zinc-400 bg-zinc-100 px-2 py-1 text-left font-bold text-black print:bg-white"
                  >
                    {i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activePositions.map((pos) => (
                <tr key={pos}>
                  <th className="border border-zinc-400 bg-zinc-100 px-2 py-1 text-left font-bold text-black print:bg-white">
                    {pos}
                  </th>
                  {inningNumbers.map((i) => {
                    const playerId = grid.assignments[i - 1]?.[pos]
                    const player = playerId ? byId.get(playerId) : undefined
                    return (
                      <td
                        key={i}
                        className="border border-zinc-400 px-2 py-1 text-black"
                        title={player?.name}
                      >
                        {player ? names.get(player.id) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <table className="w-full border-collapse text-sm print:text-[10pt]">
            <caption className="pb-1 text-left text-sm font-bold text-foreground print:text-black">
              Batting order
            </caption>
            <thead>
              <tr>
                <th className="border border-zinc-400 bg-zinc-100 px-2 py-1 text-left font-bold text-black print:bg-white">
                  #
                </th>
                <th className="border border-zinc-400 bg-zinc-100 px-2 py-1 text-left font-bold text-black print:bg-white">
                  Batter
                </th>
              </tr>
            </thead>
            <tbody>
              {order.slots.map((slot, index) => {
                const player = slot.kind === 'player' ? byId.get(slot.playerId) : undefined
                return (
                  <tr key={index}>
                    <td className="border border-zinc-400 px-2 py-1 text-black">{index + 1}</td>
                    <td className="border border-zinc-400 px-2 py-1 text-black">
                      {slot.kind === 'autoOut' ? (
                        <span className="font-bold">AUTOMATIC OUT</span>
                      ) : (
                        <>
                          {player?.name ?? 'unknown'}
                          {player?.isFemale ? ' (F)' : ''}
                          {player?.isSub ? ' (sub)' : ''}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <table className="w-full border-collapse text-sm print:text-[10pt]">
            <caption className="pb-1 text-left text-sm font-bold text-foreground print:text-black">
              Bench by inning
            </caption>
            <thead>
              <tr>
                <th className="border border-zinc-400 bg-zinc-100 px-2 py-1 text-left font-bold text-black print:bg-white">
                  Inn
                </th>
                <th className="border border-zinc-400 bg-zinc-100 px-2 py-1 text-left font-bold text-black print:bg-white">
                  Sitting
                </th>
              </tr>
            </thead>
            <tbody>
              {benchByInning.map((bench, index) => (
                <tr key={index}>
                  <td className="border border-zinc-400 px-2 py-1 text-black">{index + 1}</td>
                  <td className="border border-zinc-400 px-2 py-1 text-black">
                    {bench.length === 0
                      ? '—'
                      : bench.map((p) => names.get(p.id) ?? p.name).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(grid.warnings.length > 0 || order.warnings.length > 0) && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-foreground print:text-black">Notes</h3>
            <ul className="list-disc pl-5 text-sm text-black">
              {[...grid.warnings, ...order.warnings].map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="text-sm print:hidden">
        <Link href={`/games/${id}/lineup`} className="font-semibold underline">
          Back to the lineup
        </Link>
      </p>
    </main>
  )
}
