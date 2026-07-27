import type {
  FieldingGrid,
  FieldingInput,
  InningAssignment,
  Pin,
  Position,
  PresentPlayer,
} from '@/lib/types'
import { RULES, SOLVER, WEIGHTS } from '@/lib/rules/config'
import { validateRoster } from './validateRoster'
import { scoreGrid } from './scoreGrid'
import { makeRng, type Rng } from './rng'

export function isAvailable(player: PresentPlayer, inning: number): boolean {
  if (inning < player.arrivedInning) return false
  if (player.leftInning !== null && inning > player.leftInning) return false
  return true
}

interface Attempt {
  assignments: InningAssignment[]
  /** Positions nobody present was listed at. These drive the captain warning. */
  uncoverable: Set<Position>
  /** How many individual assignments ignored a player's eligibility list. */
  relaxedCount: number
}

/**
 * Build the fielding grid: seeded greedy construction, many randomised
 * restarts, keep the best-scoring legal grid.
 *
 * The search space here is tiny (7 innings x 10 slots), so brute restarts beat
 * a heavyweight constraint solver on every axis that matters: speed, bundle
 * size, and being able to explain the result.
 */
export function buildFieldingGrid(input: FieldingInput): FieldingGrid {
  const { present, innings, seed } = input
  const restarts = input.restarts ?? SOLVER.restarts
  const status = validateRoster(present)
  const positions = status.activePositions

  const lockedThrough = input.lockedThroughInning ?? 0
  const locked = input.existingGrid?.assignments.slice(0, lockedThrough) ?? []

  let best: Attempt | null = null
  let bestScore = -Infinity
  let bestSeed = seed

  for (let r = 0; r < restarts; r++) {
    const attemptSeed = seed + r
    const attempt = construct(
      input,
      positions,
      status.requiredFemalesOnField,
      locked,
      makeRng(attemptSeed),
    )
    if (!attempt) continue
    const score = scoreGrid(attempt.assignments, present, attempt.relaxedCount)
    if (score > bestScore) {
      bestScore = score
      best = attempt
      bestSeed = attemptSeed
    }
  }

  if (!best) {
    // Construction only fails when the counting problem itself is unsolvable:
    // too few bodies available in some inning to fill the active positions
    // while honouring the M/X cap and the female minimum. No amount of
    // relaxing eligibility can conjure a player out of thin air, so stop.
    throw new Error(
      'No legal fielding grid exists for this roster. Check the roster status banners.',
    )
  }

  const warnings = [...status.warnings]
  if (best.uncoverable.size > 0) {
    warnings.push(
      `Nobody present is listed at ${[...best.uncoverable].join(', ')}. Filled anyway — set someone's eligibility to fix this.`,
    )
  }

  return {
    innings,
    assignments: best.assignments,
    warnings,
    score: bestScore,
    seed: bestSeed,
  }
}

function construct(
  input: FieldingInput,
  positions: Position[],
  requiredFemales: number,
  locked: InningAssignment[],
  rng: Rng,
): Attempt | null {
  const { present, innings, pins } = input
  const byId = new Map(present.map((p) => [p.id, p]))
  const assignments: InningAssignment[] = []
  const uncoverable = new Set<Position>()
  let relaxedCount = 0
  const inningsPlayed = new Map<string, number>(present.map((p) => [p.id, 0]))
  const positionCounts = new Map<string, number>()

  const bump = (id: string, position: Position) => {
    inningsPlayed.set(id, (inningsPlayed.get(id) ?? 0) + 1)
    const key = `${id}:${position}`
    positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1)
  }

  for (let inning = 1; inning <= innings; inning++) {
    if (inning <= locked.length) {
      const copied = locked[inning - 1]
      assignments.push({ ...copied })
      for (const [position, id] of Object.entries(copied) as [Position, string][]) {
        bump(id, position)
      }
      continue
    }

    let solved: SolvedInning | null = null
    for (let retry = 0; retry < SOLVER.inningRetries && !solved; retry++) {
      solved = solveInning({
        inning,
        positions,
        requiredFemales,
        present,
        byId,
        pins,
        inningsPlayed,
        positionCounts,
        rng,
      })
    }
    if (!solved) return null

    assignments.push(solved.assignment)
    relaxedCount += solved.relaxedCount
    for (const position of solved.uncoverable) uncoverable.add(position)
    for (const [position, id] of Object.entries(solved.assignment) as [Position, string][]) {
      bump(id, position)
    }
  }

  return { assignments, uncoverable, relaxedCount }
}

interface InningContext {
  inning: number
  positions: Position[]
  requiredFemales: number
  present: PresentPlayer[]
  byId: Map<string, PresentPlayer>
  pins: Pin[]
  inningsPlayed: Map<string, number>
  positionCounts: Map<string, number>
  rng: Rng
}

interface SolvedInning {
  assignment: InningAssignment
  relaxedCount: number
  uncoverable: Position[]
}

/**
 * Can the inning still be completed legally from here?
 *
 * This is the whole legality question reduced to counting, and it is the
 * guard the greedy leans on. `slotsLeft` slots remain; we hold `chosenF`
 * women and `chosenM` M/X players; `freeF`/`freeM` are still on the bench.
 * Every one of these five ways to fail is reachable with a real roster.
 */
function countsFeasible(
  chosenF: number,
  chosenM: number,
  chosenCount: number,
  freeF: number,
  freeM: number,
  size: number,
  requiredFemales: number,
): boolean {
  const slotsLeft = size - chosenCount
  if (slotsLeft < 0) return false
  if (chosenM > RULES.maxMalesOnField) return false

  // Women still owed, and whether the remaining slots and bench can pay it.
  const femalesNeeded = Math.max(0, requiredFemales - chosenF)
  if (femalesNeeded > slotsLeft) return false
  if (femalesNeeded > freeF) return false

  // Enough bodies to finish at all, once the M/X cap is applied to the bench.
  const malesAllowed = RULES.maxMalesOnField - chosenM
  if (freeF + Math.min(freeM, malesAllowed) < slotsLeft) return false

  return true
}

function solveInning(ctx: InningContext): SolvedInning | null {
  const {
    inning,
    positions,
    requiredFemales,
    present,
    byId,
    pins,
    inningsPlayed,
    positionCounts,
    rng,
  } = ctx

  const size = positions.length
  const available = present.filter((p) => isAvailable(p, inning))

  const assignment: InningAssignment = {}
  const chosen: PresentPlayer[] = []
  const pinnedIds = new Set<string>()
  const taken = new Set<string>()

  let chosenF = 0
  let chosenM = 0
  let freeF = available.filter((p) => p.isFemale).length
  let freeM = available.length - freeF

  if (!countsFeasible(0, 0, 0, freeF, freeM, size, requiredFemales)) return null

  const take = (player: PresentPlayer) => {
    chosen.push(player)
    taken.add(player.id)
    if (player.isFemale) {
      chosenF++
      freeF--
    } else {
      chosenM++
      freeM--
    }
  }

  /** Would taking this player leave the rest of the inning completable? */
  const keepsFeasible = (player: PresentPlayer): boolean =>
    countsFeasible(
      chosenF + (player.isFemale ? 1 : 0),
      chosenM + (player.isFemale ? 0 : 1),
      chosen.length + 1,
      freeF - (player.isFemale ? 1 : 0),
      freeM - (player.isFemale ? 0 : 1),
      size,
      requiredFemales,
    )

  // --- Pins. Honoured unless honouring one would make the inning illegal. ---
  for (const pin of pins) {
    if (pin.inning !== inning) continue
    if (!positions.includes(pin.position)) continue
    if (assignment[pin.position] !== undefined) continue
    const player = byId.get(pin.playerId)
    if (!player || !isAvailable(player, inning) || taken.has(player.id)) continue
    if (!keepsFeasible(player)) continue

    assignment[pin.position] = player.id
    pinnedIds.add(player.id)
    take(player)
  }

  // --- Phase A: who fields this inning. ---
  // Preference is fixed for the whole inning, so rank once and then walk the
  // ranking taking the first player who keeps the inning completable. The
  // feasibility guard is what makes this safe: the greedy can never paint
  // itself into a corner, because it refuses any pick that would create one.
  const bench = available
    .filter((p) => !taken.has(p.id))
    .map((p) => ({ player: p, rank: fieldingRank(p, inningsPlayed, rng) }))
    .sort((a, b) => b.rank - a.rank)

  while (chosen.length < size) {
    const next = bench.find(({ player }) => !taken.has(player.id) && keepsFeasible(player))
    if (!next) return null
    take(next.player)
  }

  // --- Phase B: which position each of them plays. ---
  const openPositions = positions.filter((p) => assignment[p] === undefined)
  const freePlayers = chosen.filter((p) => !pinnedIds.has(p.id))

  const eligible = (position: Position, player: PresentPlayer) =>
    player.positions[position] !== undefined

  // Adjacency, best candidate first, so the matching prefers Primary
  // positions and players who have not been parked there already.
  const adjacency = new Map<Position, string[]>()
  for (const position of openPositions) {
    const candidates = freePlayers
      .filter((p) => eligible(position, p))
      .map((p) => ({ id: p.id, rank: positionRank(p, position, positionCounts, rng) }))
      .sort((a, b) => b.rank - a.rank)
      .map((c) => c.id)
    adjacency.set(position, candidates)
  }

  // A position nobody present is listed at is a roster-data problem worth
  // telling the captain about. A position merely crowded out this inning is
  // not — the restart search will usually route around it.
  const uncoverable = openPositions.filter(
    (position) => !available.some((p) => eligible(position, p)),
  )

  // Hardest position first, ties broken randomly.
  const ordered = rng
    .shuffle(openPositions)
    .sort((a, b) => (adjacency.get(a)?.length ?? 0) - (adjacency.get(b)?.length ?? 0))

  const byPlayer = new Map<string, Position>()
  const unmatched: Position[] = []

  // Kuhn's augmenting path. Greedy alone can strand a position whose only
  // eligible players were already claimed; augmenting lets those earlier
  // positions shuffle sideways so everyone still fits. It finds a perfect
  // assignment whenever one exists for this set of fielders.
  const assign = (position: Position, visited: Set<string>): boolean => {
    for (const id of adjacency.get(position) ?? []) {
      if (visited.has(id)) continue
      visited.add(id)
      const holder = byPlayer.get(id)
      if (holder === undefined || assign(holder, visited)) {
        byPlayer.set(id, position)
        assignment[position] = id
        return true
      }
    }
    return false
  }

  for (const position of ordered) {
    if (!assign(position, new Set())) unmatched.push(position)
  }

  // Nobody eligible is left for these. Fill them anyway — an unfilled
  // position is a forfeit, an out-of-position fielder is just a bad inning.
  for (const position of unmatched) {
    const leftovers = freePlayers.filter((p) => !byPlayer.has(p.id))
    if (leftovers.length === 0) return null
    let pick = leftovers[0]
    let pickRank = -Infinity
    for (const player of leftovers) {
      const rank = positionRank(player, position, positionCounts, rng)
      if (rank > pickRank) {
        pickRank = rank
        pick = player
      }
    }
    byPlayer.set(pick.id, position)
    assignment[position] = pick.id
  }

  return {
    assignment,
    relaxedCount: unmatched.length,
    uncoverable,
  }
}

/**
 * Who gets an inning. Roster players before subs, then whoever has played
 * least. Jitter only ever separates exact ties, which is what lets restarts
 * explore different lineups without disturbing the fairness ordering.
 */
function fieldingRank(
  player: PresentPlayer,
  inningsPlayed: Map<string, number>,
  rng: Rng,
): number {
  let rank = 0
  if (player.isSub) rank -= WEIGHTS.greedy.subOnField
  rank -= (inningsPlayed.get(player.id) ?? 0) * WEIGHTS.greedy.inningsPlayed
  rank += rng.next() * WEIGHTS.greedy.jitter
  return rank
}

/** Where they play it. Spread positions around first, then honour the tiers. */
function positionRank(
  player: PresentPlayer,
  position: Position,
  positionCounts: Map<string, number>,
  rng: Rng,
): number {
  let rank = 0
  rank -= (positionCounts.get(`${player.id}:${position}`) ?? 0) * WEIGHTS.greedy.positionRepeat
  const tier = player.positions[position]
  if (tier === 'primary') rank += WEIGHTS.greedy.primaryFit
  else if (tier === 'backup') rank += WEIGHTS.greedy.backupFit
  rank += rng.next() * WEIGHTS.greedy.jitter
  return rank
}
