import type { FieldingGrid, InningAssignment, Position, PresentPlayer } from '@/lib/types'
import { RULES } from '@/lib/rules/config'
import { isAvailable, inningStatus } from './buildFieldingGrid'
import { scoreGrid } from './scoreGrid'

/** One cell of the fielding grid. `inning` is 1-based. */
export interface GridCell {
  inning: number
  position: Position
}

export type SwapResult = { grid: FieldingGrid } | { error: string }

/**
 * Exchange the occupants of two grid cells, or explain why that is illegal.
 *
 * The captain overriding the solver is a first-class move — somebody is
 * nursing an ankle, somebody wants an inning at short — but an override that
 * quietly forfeits the game is not. So this re-checks the same *hard* rules
 * `buildFieldingGrid` enforces (availability, no duplicate fielder, the M/X
 * cap, the female minimum) and refuses the swap with a reason rather than
 * handing back an illegal grid.
 *
 * Only the affected innings are re-checked: every other inning is byte-for-byte
 * the grid the solver already proved legal, and re-validating them could only
 * surface a pre-existing problem the captain cannot act on from this gesture.
 *
 * Soft goals — eligibility tiers, fairness, position variety — are deliberately
 * NOT enforced. The solver optimises those; the captain is allowed to overrule
 * them, and the recomputed `score` shows what the override cost.
 *
 * Never mutates its input: the caller keeps the old grid to fall back to when
 * the answer is `{ error }`.
 */
export function applySwap(
  grid: FieldingGrid,
  present: PresentPlayer[],
  a: GridCell,
  b: GridCell,
): SwapResult {
  if (a.inning === b.inning && a.position === b.position) {
    return { error: 'That is the same slot — pick two different slots to swap.' }
  }

  const byId = new Map(present.map((p) => [p.id, p]))
  const nameOf = (id: string) => byId.get(id)?.name ?? id

  for (const cell of [a, b]) {
    if (cell.inning < 1 || cell.inning > grid.assignments.length) {
      return { error: `Inning ${cell.inning} is not part of this game.` }
    }
    if (grid.assignments[cell.inning - 1][cell.position] === undefined) {
      return { error: `Nobody is playing ${cell.position} in inning ${cell.inning}.` }
    }
  }

  // Deep copy first, swap on the copy: the input grid must survive a rejection
  // untouched, and the caller renders straight off it.
  const assignments: InningAssignment[] = grid.assignments.map((inning) => ({ ...inning }))
  const playerA = assignments[a.inning - 1][a.position]!
  const playerB = assignments[b.inning - 1][b.position]!
  assignments[a.inning - 1][a.position] = playerB
  assignments[b.inning - 1][b.position] = playerA

  for (const inning of new Set([a.inning, b.inning])) {
    const problem = checkInning(assignments[inning - 1], present, inning, byId, nameOf)
    if (problem) return { error: `${problem} (inning ${inning})` }
  }

  return {
    grid: {
      ...grid,
      assignments,
      score: scoreGrid(assignments, present, countRelaxed(assignments, byId)),
    },
  }
}

/**
 * Every hard rule one inning has to satisfy. Returns null when it is legal.
 *
 * Order matters, because a single cross-inning drag routinely breaks more than
 * one rule at once and the captain only reads the first line. Roster problems
 * come first (somebody who has gone home cannot play, full stop), then the two
 * counting rules that decide whether the team may legally take the field, then
 * the duplicate. A drag that both unbalances the counts and clones a fielder
 * is, from the captain's side of it, a drag that would not fit in that inning
 * — the count is the reason, the clone is a symptom.
 */
function checkInning(
  assignment: InningAssignment,
  present: PresentPlayer[],
  inning: number,
  byId: Map<string, PresentPlayer>,
  nameOf: (id: string) => string,
): string | null {
  const ids = Object.values(assignment) as string[]
  let females = 0
  let males = 0

  for (const id of ids) {
    const player = byId.get(id)
    if (!player) return `${nameOf(id)} is not marked present for this game`
    if (!isAvailable(player, inning)) {
      return `${player.name} is not available in inning ${inning}`
    }
    if (player.isFemale) females++
    else males++
  }

  // Per-inning, not whole-game: the requirement drops when people have gone
  // home, and holding an inning to the full-roster number would reject swaps
  // that are perfectly legal in that inning.
  const required = inningStatus(present, inning).requiredFemalesOnField
  if (females < required) {
    return `That would leave only ${females} women on the field, and ${required} are required`
  }
  if (males > RULES.maxMalesOnField) {
    return `That would put ${males} M/X players on the field, over the ${RULES.maxMalesOnField} cap`
  }

  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      return `${nameOf(id)} is already on the field at another position that inning`
    }
    seen.add(id)
  }

  return null
}

/**
 * Assignments that ignore the player's eligibility list, which is exactly what
 * `buildFieldingGrid` counts as `relaxedCount`. Recomputing it from the grid
 * keeps the score comparable to the solver's own, so a manual swap that
 * strands somebody at a position they have never played shows up as the large
 * score drop it is.
 */
function countRelaxed(
  assignments: InningAssignment[],
  byId: Map<string, PresentPlayer>,
): number {
  let count = 0
  for (const inning of assignments) {
    for (const [position, id] of Object.entries(inning) as [Position, string][]) {
      const player = byId.get(id)
      if (player && player.positions[position] === undefined) count++
    }
  }
  return count
}
