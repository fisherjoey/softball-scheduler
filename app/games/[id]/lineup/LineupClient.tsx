'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { BattingOrderList } from '@/components/BattingOrderList'
import { FieldingGridTable, type GridCellRef } from '@/components/FieldingGridTable'
import { PlayerSummary } from '@/components/PlayerSummary'
import { RosterStatusBanner } from '@/components/RosterStatusBanner'
import { persistLineup } from './actions'
import { applySwap, assignToCell } from '@/lib/solver/applySwap'
import { buildBattingOrder } from '@/lib/solver/buildBattingOrder'
import { legalReorderTargets, reorderBattingOrder } from '@/lib/solver/reorderBattingOrder'
import { buildFieldingGrid, isAvailable } from '@/lib/solver/buildFieldingGrid'
import { validateRoster } from '@/lib/solver/validateRoster'
import type {
  BattingOrder,
  FieldingGrid,
  Pin,
  Position,
  Player,
  PresentPlayer,
  SlotHistory,
} from '@/lib/types'

export interface LineupClientProps {
  gameId: string
  innings: number
  /** Everyone ticked present, with their arrived/left innings. */
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
  /** Batting slots from recent games, so the order rotates. */
  history: SlotHistory[]
  /** A previously saved lineup, shown instead of generating a fresh one. */
  saved: { grid: FieldingGrid; order: BattingOrder } | null
}

interface Lineup {
  grid: FieldingGrid
  order: BattingOrder
  seed: number
}

/**
 * Ceiling on the starting seed. `lineup_meta.grid_seed` is a Postgres
 * `integer`, so a full 32-bit unsigned hash would overflow it and blow up on
 * Save; leaving four decimal orders of headroom means no realistic number of
 * Reshuffles (each of which adds one) can reach the limit either.
 */
const MAX_SEED = 1_000_000

/**
 * A stable starting seed per game.
 *
 * Seeding every game at 1 would hand the same roster the same lineup week
 * after week, which is the one thing this app exists to avoid. Hashing the
 * game id keeps it deterministic — the server render and the hydrating client
 * must agree — while giving each game its own starting point.
 */
function seedFor(gameId: string): number {
  let h = 2166136261
  for (let i = 0; i < gameId.length; i++) {
    h ^= gameId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % MAX_SEED
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong generating the lineup.'
}

/**
 * The lineup screen.
 *
 * The solver runs here, in the browser, not on the server: Reshuffle is the
 * button the captain hits five times in a row while people are still arriving,
 * and a diamond in Calgary is exactly where the cell signal is worst. It is
 * pure TypeScript with no I/O, so the only thing a round trip would buy is
 * latency. The server action is reserved for the one thing that genuinely
 * needs the database — saving.
 */
export function LineupClient({
  gameId,
  innings,
  present,
  roster,
  history,
  saved,
}: LineupClientProps) {
  const status = useMemo(() => validateRoster(present), [present])



  const [pins, setPins] = useState<Pin[]>([])
  const [lockedThrough, setLockedThrough] = useState(0)
  const [selected, setSelected] = useState<GridCellRef | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  // Generated once, in a lazy initialiser, so the server render and the
  // hydrating client produce the same grid from the same seed instead of the
  // screen flashing an empty state and then filling in.
  const [initial] = useState(() => {
    if (saved) return { lineup: { ...saved, seed: saved.grid.seed }, error: null as string | null }
    const seed = seedFor(gameId)
    try {
      return {
        lineup: {
          grid: buildFieldingGrid({ present, innings, pins: [], seed }),
          order: buildBattingOrder({ present, history, seed }),
          seed,
        },
        error: null as string | null,
      }
    } catch (error) {
      // `buildFieldingGrid` throws when the roster admits no legal grid at
      // all. Showing the reason beats a white screen.
      return { lineup: null, error: messageOf(error) }
    }
  })

  const [lineup, setLineup] = useState<Lineup | null>(initial.lineup)

  /**
   * A saved lineup is a snapshot: it names whoever was ticked present when it
   * was generated. Change attendance afterwards and the saved grid still shows
   * the old names, which silently disagrees with the roster the captain is
   * looking at. Name them and say what to do rather than leaving it to be
   * noticed at the diamond.
   */
  const stale = useMemo(() => {
    // Checked against the lineup ON SCREEN, not the saved one: after a rebuild
    // the visible lineup is already correct, and a warning that outlives the
    // fix teaches the captain to ignore it.
    if (!lineup) return null
    const presentIds = new Set(present.map((p) => p.id))
    const nameOf = new Map(roster.map((p) => [p.id, p.name]))
    const inOrder = new Set(
      lineup.order.slots.flatMap((slot) => (slot.kind === 'player' ? [slot.playerId] : [])),
    )
    const byName = (a: string, b: string) => a.localeCompare(b)

    // Departures are judged only against the surfaces the Rebuild button can
    // still change. Innings already played legitimately keep whoever played
    // them, and mid-game the batting order is deliberately kept too — counting
    // either would leave this banner surviving its own fix forever. Pre-game
    // nothing is locked, a rebuild replaces the order as well, so the order
    // counts then; mid-game the departed player's rows carry their own
    // "Not here" badge instead.
    const changeable = new Set<string>(
      lineup.grid.assignments.slice(lockedThrough).flatMap((inning) => Object.values(inning)),
    )
    if (lockedThrough === 0) for (const id of inOrder) changeable.add(id)
    const gone = [...changeable]
      .filter((id) => !presentIds.has(id))
      .map((id) => nameOf.get(id) ?? id)
      .sort(byName)

    // The dangerous direction: everyone present must bat, and the order is the
    // only surface that guarantees it — `buildBattingOrder` seats every present
    // player, so order membership IS the everyone-bats invariant. Checking a
    // union with the grid instead hid exactly the mid-game arrival this
    // warning exists for: reshuffled into the remaining innings, absent from
    // the deliberately-kept order, and never coming up to bat.
    const missing = present
      .filter((p) => !inOrder.has(p.id))
      .map((p) => p.name)
      .sort(byName)

    // Present is not the whole story either: edit somebody's arrived/left
    // window after saving and the grid may still field them in innings they
    // are not at the park for. Played innings are skipped for the same reason
    // they are skipped above — a rebuild cannot unplay them.
    const misfielded = present
      .flatMap((player) => {
        const innings = lineup.grid.assignments.flatMap((assignment, i) =>
          i + 1 > lockedThrough &&
          Object.values(assignment).includes(player.id) &&
          !isAvailable(player, i + 1)
            ? [i + 1]
            : [],
        )
        return innings.length ? [{ name: player.name, innings }] : []
      })
      .sort((a, b) => byName(a.name, b.name))

    return gone.length || missing.length || misfielded.length
      ? { gone, missing, misfielded }
      : null
  }, [lineup, present, roster, lockedThrough])
  const [genError, setGenError] = useState<string | null>(initial.error)
  const [dirty, setDirty] = useState(saved === null && initial.lineup !== null)

  /**
   * Swaps, pins and reshuffles live only in this component until Save runs.
   * In-app links can be intercepted, but closing the tab or navigating away
   * cannot — so while there is unsaved work, ask the browser to put up its
   * are-you-sure dialog on the way out.
   */
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Chrome ignores preventDefault() alone; the legacy returnValue channel
      // is what actually triggers its dialog.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /**
   * Re-solve with the next seed.
   *
   * The seed handed back on a grid is the INPUT seed, so reshuffling means
   * incrementing it — feeding the same one back reproduces the same lineup,
   * which is the point of it being reproducible.
   *
   * Once innings have been played, only the innings still to come are
   * re-solved, and the batting order is left completely alone: a batting order
   * that changes mid-game is an out.
   */
  function reshuffle() {
    const nextSeed = (lineup?.seed ?? seedFor(gameId)) + 1
    const locked = lineup !== null && lockedThrough > 0
    try {
      const grid = buildFieldingGrid({
        present,
        innings,
        pins,
        seed: nextSeed,
        lockedThroughInning: locked ? lockedThrough : undefined,
        existingGrid: locked ? lineup.grid : undefined,
      })
      const order = locked ? lineup.order : buildBattingOrder({ present, history, seed: nextSeed })
      setLineup({ grid, order, seed: nextSeed })
      setGenError(null)
      setSwapError(null)
      setSelected(null)
      setDirty(true)
    } catch (error) {
      setGenError(messageOf(error))
    }
  }

  function togglePin(cell: GridCellRef) {
    if (!lineup) return
    const playerId = lineup.grid.assignments[cell.inning - 1][cell.position]
    if (!playerId) return
    setSwapError(null)
    setPins((current) => {
      const existing = current.find(
        (pin) => pin.inning === cell.inning && pin.position === cell.position,
      )
      if (existing && existing.playerId === playerId) {
        return current.filter((pin) => pin !== existing)
      }
      return [
        ...current.filter((pin) => pin !== existing),
        { inning: cell.inning, position: cell.position, playerId },
      ]
    })
  }

  function swap(from: GridCellRef, to: GridCellRef) {
    if (!lineup) return
    // The UI refuses drags on locked cells and closes pickers when innings
    // get locked, but a drag can be airborne while "Innings already played"
    // changes underneath it — no handler may mutate an inning already played.
    if (from.inning <= lockedThrough || to.inning <= lockedThrough) return
    const before = {
      from: lineup.grid.assignments[from.inning - 1][from.position],
      to: lineup.grid.assignments[to.inning - 1][to.position],
    }
    const result = applySwap(lineup.grid, present, from, to)
    setSelected(null)
    if ('error' in result) {
      // The grid is left exactly as it was: an illegal swap is refused, not
      // half-applied.
      setSwapError(result.error)
      return
    }
    setSwapError(null)
    // A pin follows its player. The captain pinned a person to a spot, and
    // then moved that person; leaving the pin behind would silently undo the
    // move on the next Reshuffle.
    setPins((current) =>
      current.map((pin) => {
        if (pin.inning === from.inning && pin.position === from.position && pin.playerId === before.from) {
          return { ...to, playerId: pin.playerId }
        }
        if (pin.inning === to.inning && pin.position === to.position && pin.playerId === before.to) {
          return { ...from, playerId: pin.playerId }
        }
        return pin
      }),
    )
    setLineup({ ...lineup, grid: result.grid })
    setDirty(true)
  }

  /**
   * Put a named player in a cell, whoever has to move for it.
   *
   * A choice from the picker is one of three things, and only the third needs
   * `assignToCell`: re-choosing the player already there is the captain
   * closing the picker, and choosing somebody already fielding that inning is
   * a plain two-cell swap, which `swap` already handles — pins and all — and
   * which must keep handling, or a pin would stop following its player the
   * moment the captain used the picker instead of a drag.
   */
  function assign(cell: GridCellRef, playerId: string) {
    if (!lineup) return
    // Same belt-and-braces as swap(): a picker that somehow survived its
    // inning being declared played must not write into it.
    if (cell.inning <= lockedThrough) return
    const assignment = lineup.grid.assignments[cell.inning - 1]
    const displaced = assignment[cell.position]

    if (playerId === displaced) {
      setSelected(null)
      setSwapError(null)
      return
    }

    const from = (Object.entries(assignment) as [Position, string][]).find(
      ([position, id]) => id === playerId && position !== cell.position,
    )
    if (from) {
      swap({ inning: cell.inning, position: from[0] }, cell)
      return
    }

    const result = assignToCell(lineup.grid, present, cell, playerId)
    setSelected(null)
    if ('error' in result) {
      // Refused, not half-applied: the grid the captain is looking at is
      // exactly the grid he had before he opened the picker.
      setSwapError(result.error)
      return
    }
    setSwapError(null)
    // The player who lost the spot is on the bench now, and a pin cannot point
    // at the bench. Dropping theirs beats leaving Reshuffle to honour a pin
    // the captain has just overruled.
    setPins((current) =>
      current.filter(
        (pin) =>
          !(
            pin.inning === cell.inning &&
            pin.position === cell.position &&
            pin.playerId === displaced
          ),
      ),
    )
    setLineup({ ...lineup, grid: result.grid })
    setDirty(true)
  }

  /**
   * A batting-order drag dropped at a new slot. The solver keeps the order
   * legal — re-spacing the women minimally when it has to — or explains the
   * refusal, which the list renders under the rows.
   */
  function reorderBatter(from: number, to: number): { error: string } | void {
    if (!lineup) return { error: 'Generate a lineup first.' }
    const result = reorderBattingOrder(lineup.order, present, from, to)
    if ('error' in result) return result
    // When the drop re-spaced the women, say so somewhere that outlives the
    // glide animation — with reduced motion the glide never even plays, and
    // the app moving players the captain did not touch must not be silent.
    const note = 'The women re-spaced to keep the batting order legal after that move.'
    const order =
      result.repaired && !result.order.warnings.includes(note)
        ? { ...result.order, warnings: [...result.order.warnings, note] }
        : result.order
    setLineup({ ...lineup, order })
    setDirty(true)
  }

  /** Legal drop slots for a lifted batting row, for the drag's green/red tint. */
  function legalBatterTargets(from: number): Set<number> {
    if (!lineup) return new Set()
    return legalReorderTargets(lineup.order, present, from)
  }

  // Warm the reorder engine's pattern cache off the interaction path: the
  // first walk for a shape is the only expensive one, and paying it inside
  // the drag's lift would freeze the row right as the long-press matures on
  // a slow phone. One idle call per order makes every lift a cache hit.
  useEffect(() => {
    if (!lineup || lockedThrough > 0) return
    const warm = () => {
      const first = lineup.order.slots.findIndex((s) => s.kind === 'player')
      if (first >= 0) legalReorderTargets(lineup.order, present, first)
    }
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(warm)
      return () => window.cancelIdleCallback(handle)
    }
    const timer = setTimeout(warm, 250)
    return () => clearTimeout(timer)
  }, [lineup, present, lockedThrough])

  /** Tap a cell to open its picker; tap it again to close it. */
  function selectCell(cell: GridCellRef) {
    setSwapError(null)
    if (selected !== null && selected.inning === cell.inning && selected.position === cell.position) {
      setSelected(null)
      return
    }
    setSelected(cell)
  }

  function save() {
    if (!lineup) return
    setSaveError(null)
    startSaving(async () => {
      try {
        await persistLineup(gameId, lineup.grid, lineup.order)
        setDirty(false)
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Could not save. Try again.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reshuffle}
          className="flex h-11 min-w-32 flex-1 items-center justify-center rounded-md border-2 border-zinc-900 px-4 text-base font-semibold text-foreground dark:border-zinc-100"
        >
          {lockedThrough > 0 ? `Reshuffle innings ${lockedThrough + 1}–${innings}` : 'Reshuffle'}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isSaving || lineup === null}
          className="flex h-11 min-w-32 flex-1 items-center justify-center rounded-md bg-zinc-900 px-4 text-base font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isSaving ? 'Saving…' : dirty ? 'Save lineup' : 'Saved'}
        </button>
      </div>

      {stale && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border-2 border-amber-600 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100"
        >
          <p className="font-semibold">This saved lineup no longer matches who is here.</p>
          {stale.missing.length > 0 && (
            <p>
              <span className="font-semibold">
                {stale.missing.join(', ')}{' '}
                {stale.missing.length === 1 ? 'is' : 'are'} present but not in the batting order
              </span>{' '}
              — they would not bat at all.
            </p>
          )}
          {stale.gone.length > 0 && (
            <p>
              It still uses {stale.gone.join(', ')}, who{' '}
              {stale.gone.length === 1 ? 'is' : 'are'} no longer marked present.
            </p>
          )}
          {stale.misfielded.map(({ name, innings: badInnings }) => (
            <p key={name}>
              It fields {name} in inning{badInnings.length === 1 ? '' : 's'}{' '}
              {badInnings.join(', ')}, which they are not here for.
            </p>
          ))}
          {saved !== null && lockedThrough === 0 && (
            // Rebuilding with nothing locked replaces every inning and the
            // batting order. Mid-game that would throw away innings that have
            // actually been played — and re-ordering batters mid-game is an
            // out — so point at the lock before the captain reaches the button.
            <p>
              If the game is already underway, set “Innings already played” first, so the
              innings you have played are kept as they were.
            </p>
          )}
          <button
            type="button"
            onClick={reshuffle}
            className="flex h-11 items-center justify-center self-start rounded-md border-2 border-amber-700 px-4 text-sm font-semibold text-amber-900 dark:border-amber-400 dark:text-amber-100"
          >
            Rebuild from who is here
          </button>
        </div>
      )}

      <RosterStatusBanner
        status={{
          ...status,
          // The grid's warnings already contain the roster's, plus the ones
          // only the solver can know — a dropped pin, a sub forced to field.
          warnings: lineup
            ? [...new Set([...lineup.grid.warnings, ...lineup.order.warnings])]
            : status.warnings,
        }}
      />

      {genError && (
        <div
          role="alert"
          className="rounded-lg border-2 border-red-600 bg-red-50 p-4 text-sm font-medium text-red-800 dark:border-red-500 dark:bg-red-950 dark:text-red-200"
        >
          <p>{genError}</p>
          <p className="mt-2">
            <Link href={`/games/${gameId}`} className="underline">
              Back to attendance
            </Link>{' '}
            to change who is playing.
          </p>
        </div>
      )}

      {lineup && (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="fielding-heading">
            <h2 id="fielding-heading" className="text-lg font-semibold text-foreground">
              Fielding
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Tap a player to pick who plays that spot — anyone on the field, or anyone on the
              bench. Tap ○ to pin somebody in place so Reshuffle leaves them alone.
            </p>

            {swapError && (
              <p
                role="alert"
                className="rounded-lg border-2 border-red-600 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-500 dark:bg-red-950 dark:text-red-200"
              >
                Swap refused: {swapError}
              </p>
            )}

            <FieldingGridTable
              roster={roster}
              grid={lineup.grid}
              present={present}
              pins={pins}
              selected={selected}
              lockedThrough={lockedThrough}
              onSelect={selectCell}
              onTogglePin={togglePin}
              onSwap={swap}
              onAssign={assign}
              onCancel={() => setSelected(null)}
            />
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="midgame-heading">
            <h2 id="midgame-heading" className="text-lg font-semibold text-foreground">
              Mid-game
            </h2>
            <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              Innings already played
              <select
                value={lockedThrough}
                onChange={(event) => {
                  setLockedThrough(Number(event.target.value))
                  // A picker already open on a newly-locked inning would keep
                  // taking assignments into an inning that has been played,
                  // and a refusal message about the old lock state is noise.
                  setSelected(null)
                  setSwapError(null)
                }}
                className="h-11 rounded-md border border-zinc-300 bg-transparent px-2 text-base text-foreground dark:border-zinc-700"
              >
                <option value={0}>None yet</option>
                {/* Capped one short: the lock exists to protect finished
                    innings while the rest are reshuffled, and locking every
                    inning leaves no rest — just a no-op Reshuffle that still
                    marks the lineup unsaved. */}
                {Array.from({ length: innings - 1 }, (_, i) => i + 1).map((inning) => (
                  <option key={inning} value={inning}>
                    Through inning {inning}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Somebody just showed up, or just left? Save the lineup, then{' '}
              <Link
                href={`/games/${gameId}`}
                className="font-semibold underline"
                onClick={() => {
                  // Leaving for the attendance screen with unsaved swaps or
                  // pins would silently discard them. Saving is idempotent and
                  // the captain is standing on a diamond mid-game: fire the
                  // save rather than interrupting with a confirm dialog. The
                  // rejection is swallowed because navigation is already
                  // underway and there is nobody left on this screen to tell.
                  if (dirty && lineup) {
                    void persistLineup(gameId, lineup.grid, lineup.order).catch(() => {})
                  }
                }}
              >
                update attendance
              </Link>
              , come back, set how many innings you have played, and Reshuffle. Those innings are
              copied across untouched.
            </p>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="batting-heading">
            <h2 id="batting-heading" className="text-lg font-semibold text-foreground">
              Batting order
            </h2>
            {lockedThrough === 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Drag a batter to move them. If the spot needs the women re-spaced, they slide to
                the closest legal slots on their own; a spot the rules cannot allow shows red.
              </p>
            )}
            <BattingOrderList
              order={lineup.order}
              present={present}
              roster={roster}
              // Re-ordering batters mid-game is an out under the rules, so the
              // drag is only offered before any innings are locked.
              onReorder={lockedThrough === 0 ? reorderBatter : undefined}
              legalTargetsFor={lockedThrough === 0 ? legalBatterTargets : undefined}
            />
          </section>

          <section className="flex flex-col gap-3 pb-4" aria-labelledby="summary-heading">
            <h2 id="summary-heading" className="text-lg font-semibold text-foreground">
              Who plays what
            </h2>
            <PlayerSummary present={present} grid={lineup.grid} order={lineup.order} />
          </section>
        </>
      )}

      {saveError && (
        <p
          role="alert"
          className="rounded-lg border-2 border-red-600 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-500 dark:bg-red-950 dark:text-red-200"
        >
          {saveError}
        </p>
      )}
    </div>
  )
}
