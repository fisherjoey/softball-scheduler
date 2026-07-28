import type { FieldingGrid, InningAssignment, Position, PresentPlayer } from '@/lib/types'
import { RULES } from '@/lib/rules/config'
import { isAvailable, inningStatus } from './buildFieldingGrid'
import { scoreGrid, countRelaxed } from './scoreGrid'

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
    // Number.isInteger also rejects NaN, which slips straight through the
    // range comparisons (NaN < 1 and NaN > length are both false) and would
    // crash on the array index below instead of returning an error.
    if (
      !Number.isInteger(cell.inning) ||
      cell.inning < 1 ||
      cell.inning > grid.assignments.length
    ) {
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

  // Both moved ids go to both checks: a player who did not land in an inning
  // simply is not among its entries, so only the one actually there is judged.
  for (const inning of new Set([a.inning, b.inning])) {
    const problem = checkInning(assignments[inning - 1], present, inning, byId, nameOf, [
      playerA,
      playerB,
    ])
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
 * Put a specific player in a specific cell, or explain why that is illegal.
 *
 * `applySwap` can only trade two people who are both already on the field,
 * which leaves the bench unreachable: the captain who wants the sub who just
 * showed up to take an inning at short has no gesture for it. This is that
 * gesture — name the cell, name the player, and whatever has to move gets
 * moved.
 *
 * Three shapes, decided by where the player already is that inning:
 *   - fielding somewhere else, so the two exchange positions and the field
 *     keeps exactly the people it had;
 *   - on the bench, so they take the cell and its occupant sits down;
 *   - already in this cell, which is not an error, just nothing to do.
 *
 * The bench case is the one that can turn a legal inning illegal, and it is
 * worth being explicit about why: a same-inning exchange cannot move the
 * gender counts, because the same ten people are on the field afterwards. A
 * bench-in replaces one person with another, so a benched man taking a woman's
 * spot drops the women on the field by one and raises the M/X count by one.
 * Both are hard rules, both are re-checked, and the refusal says which.
 *
 * Only the one affected inning is re-checked, for the same reason `applySwap`
 * checks only two: every other inning is untouched, and re-validating them
 * could only surface a problem this gesture cannot fix. Never mutates.
 */
export function assignToCell(
  grid: FieldingGrid,
  present: PresentPlayer[],
  cell: GridCell,
  playerId: string,
): SwapResult {
  const byId = new Map(present.map((p) => [p.id, p]))
  const nameOf = (id: string) => byId.get(id)?.name ?? id

  // Number.isInteger also rejects NaN, which slips straight through the range
  // comparisons (NaN < 1 and NaN > length are both false) and would crash on
  // the array index below instead of returning an error.
  if (
    !Number.isInteger(cell.inning) ||
    cell.inning < 1 ||
    cell.inning > grid.assignments.length
  ) {
    return { error: `Inning ${cell.inning} is not part of this game.` }
  }
  const occupant = grid.assignments[cell.inning - 1][cell.position]
  if (occupant === undefined) {
    // Refusing rather than filling it: a position with nobody in it is a
    // position not in play that inning, and adding an eleventh fielder to a
    // ten-slot defence is not a swap.
    return { error: `Nobody is playing ${cell.position} in inning ${cell.inning}.` }
  }

  const player = byId.get(playerId)
  if (!player) return { error: `${nameOf(playerId)} is not marked present for this game.` }

  // Checked before availability on purpose. Re-picking the name already in the
  // cell is the captain closing the picker, and closing a picker must not
  // produce an error even for somebody the grid should not have seated.
  if (occupant === playerId) return { grid }

  // `checkInning` catches this too, but its message would arrive with a
  // redundant "(inning 4)" bolted onto a sentence that already says inning 4.
  if (!isAvailable(player, cell.inning)) {
    return { error: `${player.name} is not available in inning ${cell.inning}.` }
  }

  // Deep copy first, move on the copy: a rejection has to leave the caller's
  // grid exactly as it found it.
  const assignments: InningAssignment[] = grid.assignments.map((inning) => ({ ...inning }))
  const target = assignments[cell.inning - 1]

  const elsewhere = (Object.entries(target) as [Position, string][]).find(
    ([position, id]) => id === playerId && position !== cell.position,
  )
  // Vacating their old position with the displaced player is what makes this
  // an exchange rather than a clone; leaving it would put the incoming player
  // on the field twice.
  if (elsewhere) target[elsewhere[0]] = occupant
  target[cell.position] = playerId

  const problem = checkInning(target, present, cell.inning, byId, nameOf, [playerId])
  if (problem) return { error: `${problem} (inning ${cell.inning})` }

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
 *
 * Presence and availability are judged only for `movedIds` — the players this
 * gesture actually put into the inning. The rest of the inning is whatever it
 * already was, and a pre-existing problem there (say a ghost id left behind by
 * unticking a departed player after generating) is not something this gesture
 * can fix; refusing an unrelated swap over it just strands the captain. The
 * inning-wide rules — gender counts and the duplicate check — still cover
 * everybody, since any move can push those over the line.
 */
function checkInning(
  assignment: InningAssignment,
  present: PresentPlayer[],
  inning: number,
  byId: Map<string, PresentPlayer>,
  nameOf: (id: string) => string,
  movedIds: readonly string[],
): string | null {
  const ids = Object.values(assignment) as string[]
  const moved = new Set(movedIds)
  let females = 0
  let males = 0

  for (const id of ids) {
    const player = byId.get(id)
    if (!player) {
      if (moved.has(id)) return `${nameOf(id)} is not marked present for this game`
      // An unresolvable id has no gender to count. Skipping it keeps the
      // counting rules about the players actually known to the roster.
      continue
    }
    if (moved.has(id) && !isAvailable(player, inning)) {
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
