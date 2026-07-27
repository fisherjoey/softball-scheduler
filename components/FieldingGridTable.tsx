'use client'

import { POSITIONS, type FieldingGrid, type Pin, type Position, type PresentPlayer } from '@/lib/types'

/** One cell of the grid. `inning` is 1-based. */
export interface GridCellRef {
  inning: number
  position: Position
}

export interface FieldingGridTableProps {
  grid: FieldingGrid
  present: PresentPlayer[]
  pins: Pin[]
  /** The cell waiting for a swap partner, if the captain has picked one. */
  selected: GridCellRef | null
  /** Innings 1..lockedThrough have been played and are read-only. */
  lockedThrough: number
  onSelect: (cell: GridCellRef) => void
  onTogglePin: (cell: GridCellRef) => void
  onSwap: (from: GridCellRef, to: GridCellRef) => void
}

const DRAG_TYPE = 'text/plain'

function sameCell(a: GridCellRef | null, b: GridCellRef): boolean {
  return a !== null && a.inning === b.inning && a.position === b.position
}

interface CellState {
  cell: GridCellRef
  name: string | null
  locked: boolean
  pinned: boolean
  isSelected: boolean
  isFemale: boolean
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
 * One fielder. Tapping picks them up for a swap; tapping a second one
 * completes it. Also a drag source and drop target, for mice.
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
 * Both views are the same cells with the same handlers: tap once to pick a
 * player, tap a second cell to swap them. Dragging works too, for mice, but
 * tap is the primary gesture because HTML5 drag-and-drop never fires on touch.
 */
export function FieldingGridTable({
  grid,
  present,
  pins,
  selected,
  lockedThrough,
  onSelect,
  onTogglePin,
  onSwap,
}: FieldingGridTableProps) {
  const nameOf = new Map(present.map((p) => [p.id, p.name]))
  const femaleIds = new Set(present.filter((p) => p.isFemale).map((p) => p.id))

  const innings = Array.from({ length: grid.innings }, (_, i) => i + 1)
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
                    <PlayerButton state={state} onSelect={onSelect} onSwap={onSwap} />
                    <PinButton state={state} onTogglePin={onTogglePin} />
                  </div>
                )
              })}
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
                        <PlayerButton state={state} onSelect={onSelect} onSwap={onSwap} />
                        <PinButton state={state} onTogglePin={onTogglePin} />
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
