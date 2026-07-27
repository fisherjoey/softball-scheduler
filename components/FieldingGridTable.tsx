'use client'

import { useEffect, useRef } from 'react'
import { isAvailable } from '@/lib/solver/buildFieldingGrid'
import {
  POSITIONS,
  type FieldingGrid,
  type Pin,
  type Player,
  type Position,
  type PresentPlayer,
} from '@/lib/types'

/** One cell of the grid. `inning` is 1-based. */
export interface GridCellRef {
  inning: number
  position: Position
}

export interface FieldingGridTableProps {
  grid: FieldingGrid
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
  pins: Pin[]
  /** The cell whose player picker is open, if the captain has tapped one. */
  selected: GridCellRef | null
  /** Innings 1..lockedThrough have been played and are read-only. */
  lockedThrough: number
  onSelect: (cell: GridCellRef) => void
  onTogglePin: (cell: GridCellRef) => void
  onSwap: (from: GridCellRef, to: GridCellRef) => void
  /** Put this player in this cell. The picker's only outcome. */
  onAssign: (cell: GridCellRef, playerId: string) => void
  /** Close the picker without changing anything. */
  onCancel: () => void
}

const DRAG_TYPE = 'text/plain'

function sameCell(a: GridCellRef | null, b: GridCellRef): boolean {
  return a !== null && a.inning === b.inning && a.position === b.position
}

/**
 * Who is available in one inning, split by whether they are playing it.
 *
 * "Available" and "present" are not the same thing once somebody arrives in
 * the third or leaves after the fifth, and the difference matters here: a
 * player who has gone home is not on the bench, they are not at the park.
 * Offering them in the picker would only earn the captain a refusal.
 */
interface InningRoster {
  fielding: Array<{ player: PresentPlayer; position: Position }>
  bench: PresentPlayer[]
}

interface CellState {
  cell: GridCellRef
  name: string | null
  locked: boolean
  pinned: boolean
  isSelected: boolean
  isFemale: boolean
}

/** The F/Sub markers, as words, for a `<select>` option's flat text. */
function markerText(player: PresentPlayer): string {
  const marks = [player.isFemale ? 'F' : null, player.isSub ? 'Sub' : null].filter(Boolean)
  return marks.length === 0 ? '' : ` (${marks.join(', ')})`
}

/** The same markers as chips, for everywhere that is not an option element. */
function MarkerChips({ player }: { player: PresentPlayer }) {
  return (
    <>
      {player.isFemale && <Chip>F</Chip>}
      {player.isSub && <Chip>Sub</Chip>}
    </>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1 rounded-sm border border-current px-1 text-[10px] font-bold uppercase">
      {children}
    </span>
  )
}

/**
 * Everyone who could take this cell, as a native `<select>`.
 *
 * Native, not a custom sheet, for two reasons. Phones render a `<select>` as a
 * full-screen picker with system-sized rows, which is the easiest thing in the
 * world to hit one-handed on a diamond; and `<optgroup>` gives us "On the
 * field" and "Bench" without a single line of positioning code that would then
 * have to fight the grid's horizontal scroller.
 *
 * Options carry the player's current position, so choosing somebody already
 * fielding reads as the exchange it is, and the F/Sub markers, so the captain
 * can see before he taps whether the choice costs him a woman on the field.
 */
function PlayerPicker({
  cell,
  current,
  roster,
  onAssign,
  onCancel,
}: {
  cell: GridCellRef
  current: string
  roster: InningRoster
  onAssign: (cell: GridCellRef, playerId: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    const select = ref.current
    if (!select) return
    select.focus()
    // The tap that opened this picker is still transient user activation, so
    // browsers that implement showPicker() open the list immediately and the
    // captain spends one tap instead of two. The rest just get focus, and a
    // second tap opens it the ordinary way.
    try {
      ;(select as HTMLSelectElement & { showPicker?: () => void }).showPicker?.()
    } catch {
      // Not allowed here — focus is enough.
    }
  }, [])

  return (
    <>
      <select
        ref={ref}
        value={current}
        aria-label={`Who plays ${cell.position} in inning ${cell.inning}`}
        onChange={(event) => onAssign(cell, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
        className="min-h-11 w-full min-w-0 max-w-56 flex-1 rounded-md border-2 border-zinc-900 bg-background px-2 py-1 text-sm font-medium text-foreground dark:border-zinc-100"
      >
        <optgroup label="On the field">
          {roster.fielding.map(({ player, position }) => (
            <option key={player.id} value={player.id}>
              {player.name}
              {markerText(player)} — {position}
            </option>
          ))}
        </optgroup>
        {roster.bench.length > 0 && (
          <optgroup label="Bench">
            {roster.bench.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
                {markerText(player)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button
        type="button"
        onClick={onCancel}
        aria-label={`Cancel changing ${cell.position} in inning ${cell.inning}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-zinc-300 text-base font-bold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </>
  )
}

/** Who is sitting this inning, or a word to say that nobody is. */
function BenchList({ bench }: { bench: PresentPlayer[] }) {
  if (bench.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Nobody — everybody available is on the field.
      </p>
    )
  }
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
      {bench.map((player) => (
        <li key={player.id} className="flex items-center">
          {player.name}
          <MarkerChips player={player} />
        </li>
      ))}
    </ul>
  )
}

/** The empty-cell placeholder: a position not in play that inning. */
function EmptyCell({ cell }: { cell: GridCellRef }) {
  return (
    <span className="flex min-h-11 flex-1 items-center px-2 text-sm text-zinc-600 dark:text-zinc-400">
      <span aria-hidden="true">—</span>
      <span className="sr-only">
        {cell.position} is not in play in inning {cell.inning}
      </span>
    </span>
  )
}

/**
 * One fielder. Tapping opens the picker for that cell. Also a drag source and
 * drop target, for mice: dragging one fielder onto another still swaps them
 * directly, which is quicker than the picker when both are already on the
 * field, and never collides with it because a cell showing the picker is no
 * longer showing this button.
 *
 * Selection, pinning and having-already-been-played are each carried by a
 * border treatment AND a word, never by colour alone.
 */
function PlayerButton({
  state,
  onSelect,
  onSwap,
}: {
  state: CellState
  onSelect: (cell: GridCellRef) => void
  onSwap: (from: GridCellRef, to: GridCellRef) => void
}) {
  const { cell, name, locked, pinned, isSelected, isFemale } = state
  if (name === null) return <EmptyCell cell={cell} />

  const look = locked
    ? 'border-dashed border-zinc-400 text-zinc-700 dark:border-zinc-500 dark:text-zinc-300'
    : isSelected
      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
      : pinned
        ? 'border-zinc-900 text-foreground dark:border-zinc-100'
        : 'border-zinc-300 text-foreground dark:border-zinc-700'

  return (
    <button
      type="button"
      draggable={!locked}
      aria-pressed={isSelected}
      aria-disabled={locked || undefined}
      aria-label={[
        name,
        cell.position,
        `inning ${cell.inning}`,
        pinned ? 'pinned' : null,
        locked ? 'already played, locked' : null,
      ]
        .filter(Boolean)
        .join(', ')}
      onDragStart={(event) => {
        if (locked) {
          event.preventDefault()
          return
        }
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(cell))
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        if (!locked) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (locked) return
        const raw = event.dataTransfer.getData(DRAG_TYPE)
        if (!raw) return
        let from: GridCellRef
        try {
          from = JSON.parse(raw) as GridCellRef
        } catch {
          return // A drag from outside the grid.
        }
        if (typeof from?.inning !== 'number' || typeof from?.position !== 'string') return
        if (sameCell(from, cell)) return
        onSwap(from, cell)
      }}
      onClick={() => {
        if (!locked) onSelect(cell)
      }}
      className={`flex min-h-11 flex-1 items-center gap-1 rounded-md border-2 px-2 py-1 text-left text-sm font-medium ${look}`}
    >
      <span className="flex-1 break-words">{name}</span>
      {isFemale && (
        <span className="shrink-0 text-xs font-bold" aria-hidden="true">
          F
        </span>
      )}
      {pinned && (
        <span className="shrink-0 rounded-sm border border-current px-1 text-[10px] font-bold uppercase">
          Pin
        </span>
      )}
    </button>
  )
}

/** Pin toggle. A pinned cell survives Reshuffle. */
function PinButton({
  state,
  onTogglePin,
}: {
  state: CellState
  onTogglePin: (cell: GridCellRef) => void
}) {
  const { cell, name, locked, pinned } = state
  if (name === null || locked) return null
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${name} at ${cell.position} in inning ${cell.inning}`}
      onClick={() => onTogglePin(cell)}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 text-base font-bold ${
        pinned
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
          : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'
      }`}
    >
      <span aria-hidden="true">{pinned ? '◉' : '○'}</span>
    </button>
  )
}

/**
 * The 7x10 grid, twice.
 *
 * Ten positions across seven innings does not fit a 390px phone in any
 * arrangement that stays readable, and a captain thumbing through it between
 * innings cares about one inning at a time. So phones get a stack of
 * per-inning cards — the unit they actually think in — and the
 * innings-as-columns table only appears from `md` up, inside its own
 * horizontal scroller so the page itself never slides sideways.
 *
 * Both views are the same cells with the same handlers: tap a cell to open the
 * picker, choose anyone — bench included — to put them there. Dragging works
 * too, for mice, but tap is the primary gesture because HTML5 drag-and-drop
 * never fires on touch.
 */
export function FieldingGridTable({
  grid,
  present,
  roster,
  pins,
  selected,
  lockedThrough,
  onSelect,
  onTogglePin,
  onSwap,
  onAssign,
  onCancel,
}: FieldingGridTableProps) {
  const nameOf = new Map(roster.map((p) => [p.id, p.name]))
  const femaleIds = new Set(present.filter((p) => p.isFemale).map((p) => p.id))

  const innings = Array.from({ length: grid.innings }, (_, i) => i + 1)

  // One pass per inning, shared by the picker and the bench display so the two
  // can never disagree about who is sitting.
  const rosters = new Map<number, InningRoster>(
    innings.map((inning) => {
      const assignment = grid.assignments[inning - 1]
      const positionOf = new Map<string, Position>()
      for (const [position, id] of Object.entries(assignment) as [Position, string][]) {
        positionOf.set(id, position)
      }
      const available = present.filter((player) => isAvailable(player, inning))
      return [
        inning,
        {
          fielding: available
            .filter((player) => positionOf.has(player.id))
            .map((player) => ({ player, position: positionOf.get(player.id)! }))
            .sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)),
          bench: available
            .filter((player) => !positionOf.has(player.id))
            .sort((a, b) => a.name.localeCompare(b.name)),
        },
      ]
    }),
  )
  // Positions actually in play at some point tonight. A short roster drops
  // positions, and a row for a position nobody plays all game is noise.
  const rows = POSITIONS.filter((position) =>
    grid.assignments.some((assignment) => assignment[position] !== undefined),
  )

  const stateFor = (cell: GridCellRef): CellState => {
    const playerId = grid.assignments[cell.inning - 1][cell.position]
    return {
      cell,
      name: playerId ? (nameOf.get(playerId) ?? playerId) : null,
      locked: cell.inning <= lockedThrough,
      // A pin whose player the solver could not seat is not shown as honoured
      // — `grid.warnings` explains which pin was dropped and why.
      pinned:
        playerId !== undefined &&
        pins.some(
          (pin) =>
            pin.inning === cell.inning &&
            pin.position === cell.position &&
            pin.playerId === playerId,
        ),
      isSelected: sameCell(selected, cell),
      isFemale: playerId !== undefined && femaleIds.has(playerId),
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Phones: one card per inning. */}
      <div className="flex flex-col gap-4 md:hidden">
        {innings.map((inning) => (
          <section
            key={inning}
            aria-label={`Inning ${inning} fielding`}
            className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Inning {inning}</h3>
              {inning <= lockedThrough && (
                <span className="rounded-full border-2 border-zinc-400 px-2 py-0.5 text-xs font-bold text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
                  Played
                </span>
              )}
            </div>
            {rows
              .filter((position) => grid.assignments[inning - 1][position] !== undefined)
              .map((position) => {
                const state = stateFor({ inning, position })
                return (
                  <div key={position} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-sm font-bold text-zinc-700 dark:text-zinc-300">
                      {position}
                    </span>
                    {state.isSelected ? (
                      <PlayerPicker
                        cell={state.cell}
                        current={grid.assignments[inning - 1][position]!}
                        roster={rosters.get(inning)!}
                        onAssign={onAssign}
                        onCancel={onCancel}
                      />
                    ) : (
                      <>
                        <PlayerButton state={state} onSelect={onSelect} onSwap={onSwap} />
                        <PinButton state={state} onTogglePin={onTogglePin} />
                      </>
                    )}
                  </div>
                )
              })}

            <div className="mt-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <h4 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Bench</h4>
              <BenchList bench={rosters.get(inning)!.bench} />
            </div>
          </section>
        ))}
      </div>

      {/* Tablets and up: innings as columns, in their own scroller so the
          page itself never scrolls sideways. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">Fielding positions by inning</caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-2 text-left text-zinc-700 dark:text-zinc-300">
                Pos
              </th>
              {innings.map((inning) => (
                <th
                  key={inning}
                  scope="col"
                  className="px-2 py-2 text-left text-zinc-700 dark:text-zinc-300"
                >
                  Inn {inning}
                  {inning <= lockedThrough && (
                    <span className="ml-1 text-xs font-normal">(played)</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((position) => (
              <tr key={position} className="border-t border-zinc-200 dark:border-zinc-800">
                <th
                  scope="row"
                  className="px-2 py-1 text-left font-bold text-zinc-700 dark:text-zinc-300"
                >
                  {position}
                </th>
                {innings.map((inning) => {
                  const state = stateFor({ inning, position })
                  return (
                    <td key={inning} className="px-1 py-1 align-middle">
                      <div className="flex items-center gap-1">
                        {state.isSelected ? (
                          <PlayerPicker
                            cell={state.cell}
                            current={grid.assignments[inning - 1][position]!}
                            roster={rosters.get(inning)!}
                            onAssign={onAssign}
                            onCancel={onCancel}
                          />
                        ) : (
                          <>
                            <PlayerButton state={state} onSelect={onSelect} onSwap={onSwap} />
                            <PinButton state={state} onTogglePin={onTogglePin} />
                          </>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
            {/* The bench belongs on the same axis as the innings it belongs
                to, so it reads as a last row of the defence rather than as a
                separate list the captain has to line up by eye. */}
            <tr className="border-t-2 border-zinc-300 dark:border-zinc-700">
              <th
                scope="row"
                className="px-2 py-2 text-left align-top font-bold text-zinc-700 dark:text-zinc-300"
              >
                Bench
              </th>
              {innings.map((inning) => (
                <td key={inning} className="px-2 py-2 align-top">
                  {/* The table sizes to its content, so the width has to live
                      on a block inside the cell or a long bench would stretch
                      the whole column. */}
                  <div className="w-40">
                    <BenchList bench={rosters.get(inning)!.bench} />
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
