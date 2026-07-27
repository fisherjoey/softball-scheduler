import type {
  FieldingGrid,
  FieldingInput,
  InningAssignment,
  Pin,
  Position,
  PresentPlayer,
  RosterStatus,
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

/**
 * Roster status restricted to the players actually available in one inning.
 *
 * The whole-game status answers "how many can we field tonight?", which is the
 * wrong question the moment somebody leaves early: a roster of 12 validates
 * clean at 10 fielders, but if five of them go home after the third inning
 * there is no legal way to put 10 on the field in the fourth. Recomputing per
 * inning off the same `validateRoster` logic drops the field size for exactly
 * the innings that need it, and leaves every other inning untouched.
 */
export function inningStatus(present: PresentPlayer[], inning: number): RosterStatus {
  return validateRoster(present.filter((p) => isAvailable(p, inning)))
}

interface Attempt {
  assignments: InningAssignment[]
  /** Positions nobody available was listed at. These drive the captain warning. */
  uncoverable: Set<Position>
  /** Positions only a sub can cover, so a sub has to field. */
  subOnly: Set<Position>
  /** How many individual assignments ignored a player's eligibility list. */
  relaxedCount: number
}

/**
 * Spread the restart seeds for one input seed across the whole 32-bit range.
 *
 * The obvious `seed + r` makes consecutive input seeds explore almost the same
 * restarts — with 300 restarts, seed 9 and seed 10 share 299 of them and
 * almost always return the identical grid. That makes a Reshuffle button that
 * increments the seed look broken. Hashing the pair gives each input seed a
 * disjoint-looking set of restarts.
 */
function mixSeed(seed: number, restart: number): number {
  let h = (Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(restart + 1, 0x85ebca6b)) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12
  return h >>> 0
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
  const { present, innings, pins, seed } = input
  const restarts = input.restarts ?? SOLVER.restarts
  const full = validateRoster(present)

  const perInning = Array.from({ length: innings }, (_, i) => inningStatus(present, i + 1))

  const lockedThrough = input.lockedThroughInning ?? 0
  const locked = input.existingGrid?.assignments.slice(0, lockedThrough) ?? []

  let best: Attempt | null = null
  let bestScore = -Infinity

  for (let r = 0; r < restarts; r++) {
    // Every restart is run under both selection policies, and `scoreGrid`
    // picks. Neither policy is right on every roster: reserving for coverage
    // buys covered positions at 1000 points each but can cost innings
    // fairness, and where both are achievable the reservation is pure loss.
    // Running both — rather than splitting the restart budget between them —
    // means the search is never worse than either policy alone at full budget.
    for (const reserveCoverage of [true, false]) {
      const rng = makeRng(mixSeed(seed, r * 2 + (reserveCoverage ? 1 : 0)))
      const attempt = construct(input, perInning, locked, rng, reserveCoverage)
      if (!attempt) continue
      const score = scoreGrid(attempt.assignments, present, attempt.relaxedCount)
      if (score > bestScore) {
        bestScore = score
        best = attempt
      }
    }
  }

  if (!best) {
    // Construction only fails when the counting problem itself is unsolvable
    // for some inning even after the field size has been dropped to fit. No
    // amount of relaxing eligibility can conjure a player out of thin air.
    throw new Error(
      'No legal fielding grid exists for this roster. Check the roster status banners.',
    )
  }

  const warnings = [
    ...full.warnings,
    ...fieldSizeWarnings(perInning, full),
    ...pinWarnings(present, perInning, pins, innings, locked.length),
  ]
  if (best.uncoverable.size > 0) {
    warnings.push(
      `Nobody present is listed at ${[...best.uncoverable].join(', ')}. Filled anyway — set someone's eligibility to fix this.`,
    )
  }
  if (best.subOnly.size > 0) {
    warnings.push(
      `Only a sub is listed at ${[...best.subOnly].join(', ')}, so a sub has to field. Add a roster player there to fix this.`,
    )
  }

  return {
    innings,
    assignments: best.assignments,
    warnings,
    score: bestScore,
    // The input seed, not the winning restart's derived seed: this is the
    // value a caller passes back in to reproduce this exact grid.
    seed,
  }
}

/** Tell the captain which innings field short, and why, in consecutive runs. */
function fieldSizeWarnings(perInning: RosterStatus[], full: RosterStatus): string[] {
  const out: string[] = []
  const fullSize = full.activePositions.length
  let i = 0
  while (i < perInning.length) {
    const size = perInning[i].activePositions.length
    if (size === fullSize) {
      i++
      continue
    }
    let j = i
    while (j + 1 < perInning.length && perInning[j + 1].activePositions.length === size) j++
    const label = i === j ? `Inning ${i + 1} fields` : `Innings ${i + 1}-${j + 1} field`
    out.push(
      `${label} ${size}, not ${fullSize} — only ${perInning[i].playerCount} of the ${full.playerCount} present are available then.`,
    )
    i = j + 1
  }
  return out
}

/**
 * Explain every pin that could not be honoured.
 *
 * Dropping an impossible pin is right; dropping it silently is not. The
 * captain typed a name into a slot, and if somebody else ends up standing
 * there they need to know which pin was dropped and what beat it.
 */
function pinWarnings(
  present: PresentPlayer[],
  perInning: RosterStatus[],
  pins: Pin[],
  innings: number,
  lockedCount: number,
): string[] {
  const byId = new Map(present.map((p) => [p.id, p]))
  const out: string[] = []
  const nameOf = (id: string) => byId.get(id)?.name ?? id

  // Pins for an inning this game does not have. Realistic when 7-inning league
  // pins are carried into a 6-inning tournament game, and invisible to the
  // per-inning walk below because no inning number ever matches them.
  for (const pin of pins) {
    if (pin.inning >= 1 && pin.inning <= innings) continue
    out.push(
      `Could not honour the pin of ${nameOf(pin.playerId)} at ${pin.position} in inning ${pin.inning}: this game only has ${innings} innings.`,
    )
  }

  for (let inning = 1; inning <= innings; inning++) {
    const status = perInning[inning - 1]
    const seated = new Map<Position, string>()
    const taken = new Set<string>()
    let chosenF = 0
    let chosenM = 0
    const available = present.filter((p) => isAvailable(p, inning))
    let freeF = available.filter((p) => p.isFemale).length
    let freeM = available.length - freeF
    const size = status.activePositions.length

    const reject = (pin: Pin, why: string) =>
      out.push(
        `Could not honour the pin of ${nameOf(pin.playerId)} at ${pin.position} in inning ${inning}: ${why}.`,
      )

    for (const pin of pins) {
      if (pin.inning !== inning) continue

      if (inning <= lockedCount) {
        reject(pin, 'that inning is locked and was copied from the existing grid')
        continue
      }
      if (!status.activePositions.includes(pin.position)) {
        reject(pin, `${pin.position} is not in play that inning`)
        continue
      }
      const already = seated.get(pin.position)
      if (already !== undefined) {
        reject(pin, `${pin.position} is already pinned to ${nameOf(already)}`)
        continue
      }
      const player = byId.get(pin.playerId)
      if (!player) {
        reject(pin, 'that player is not on tonight’s roster')
        continue
      }
      if (!isAvailable(player, inning)) {
        reject(pin, 'they are not available that inning')
        continue
      }
      if (taken.has(player.id)) {
        reject(pin, 'they are already pinned to another position that inning')
        continue
      }
      const problem = countsProblem(
        chosenF + (player.isFemale ? 1 : 0),
        chosenM + (player.isFemale ? 0 : 1),
        taken.size + 1,
        freeF - (player.isFemale ? 1 : 0),
        freeM - (player.isFemale ? 0 : 1),
        size,
        status.requiredFemalesOnField,
      )
      if (problem) {
        reject(pin, describeProblem(problem, status.requiredFemalesOnField))
        continue
      }

      seated.set(pin.position, player.id)
      taken.add(player.id)
      if (player.isFemale) {
        chosenF++
        freeF--
      } else {
        chosenM++
        freeM--
      }
    }
  }
  return out
}

function construct(
  input: FieldingInput,
  perInning: RosterStatus[],
  locked: InningAssignment[],
  rng: Rng,
  reserveCoverage: boolean,
): Attempt | null {
  const { present, innings, pins } = input
  const byId = new Map(present.map((p) => [p.id, p]))
  const assignments: InningAssignment[] = []
  const uncoverable = new Set<Position>()
  const subOnly = new Set<Position>()
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

    const status = perInning[inning - 1]
    let solved: SolvedInning | null = null
    for (let retry = 0; retry < SOLVER.inningRetries && !solved; retry++) {
      solved = solveInning({
        inning,
        positions: status.activePositions,
        requiredFemales: status.requiredFemalesOnField,
        present,
        byId,
        pins,
        inningsPlayed,
        positionCounts,
        rng,
        reserveCoverage,
      })
    }
    if (!solved) return null

    assignments.push(solved.assignment)
    relaxedCount += solved.relaxedCount
    for (const position of solved.uncoverable) uncoverable.add(position)
    for (const position of solved.subOnly) subOnly.add(position)
    for (const [position, id] of Object.entries(solved.assignment) as [Position, string][]) {
      bump(id, position)
    }
  }

  return { assignments, uncoverable, subOnly, relaxedCount }
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
  /** Reserve the players maximum coverage needs before fairness spends slots. */
  reserveCoverage: boolean
}

interface SolvedInning {
  assignment: InningAssignment
  relaxedCount: number
  uncoverable: Position[]
  subOnly: Position[]
}

type Infeasibility = 'malesCap' | 'femaleMinimum' | 'tooFewPlayers' | null

/**
 * Can the inning still be completed legally from here, and if not, why?
 *
 * This is the whole legality question reduced to counting, and it is the
 * guard the greedy leans on. `slotsLeft` slots remain; we hold `chosenF`
 * women and `chosenM` M/X players; `freeF`/`freeM` are still on the bench.
 * Every one of these ways to fail is reachable with a real roster.
 */
function countsProblem(
  chosenF: number,
  chosenM: number,
  chosenCount: number,
  freeF: number,
  freeM: number,
  size: number,
  requiredFemales: number,
): Infeasibility {
  const slotsLeft = size - chosenCount
  if (slotsLeft < 0) return 'tooFewPlayers'
  if (chosenM > RULES.maxMalesOnField) return 'malesCap'

  // Women still owed, and whether the remaining slots and bench can pay it.
  const femalesNeeded = Math.max(0, requiredFemales - chosenF)
  if (femalesNeeded > slotsLeft) return 'femaleMinimum'
  if (femalesNeeded > freeF) return 'femaleMinimum'

  // Enough bodies to finish at all, once the M/X cap is applied to the bench.
  const malesAllowed = RULES.maxMalesOnField - chosenM
  if (freeF + Math.min(freeM, malesAllowed) < slotsLeft) return 'tooFewPlayers'

  return null
}

function describeProblem(problem: Infeasibility, requiredFemales: number): string {
  if (problem === 'malesCap') return `it would break the ${RULES.maxMalesOnField} M/X cap`
  if (problem === 'femaleMinimum') {
    return `the inning could then not field ${requiredFemales} women`
  }
  return 'too few players are available that inning'
}

/**
 * Maximum bipartite matching by Kuhn's augmenting path.
 *
 * Greedy alone can strand a position whose only eligible players were already
 * claimed; augmenting lets those earlier positions shuffle sideways so
 * everyone still fits. Feeding it preference-ordered adjacency means it takes
 * the preferred player whenever the choice is free, while still guaranteeing
 * maximum coverage.
 */
function maximumMatching(
  ordered: Position[],
  adjacency: Map<Position, string[]>,
): { matched: Map<Position, string>; unmatched: Position[] } {
  const byPlayer = new Map<string, Position>()
  const matched = new Map<Position, string>()

  const assign = (position: Position, visited: Set<string>): boolean => {
    for (const id of adjacency.get(position) ?? []) {
      if (visited.has(id)) continue
      visited.add(id)
      const holder = byPlayer.get(id)
      if (holder === undefined || assign(holder, visited)) {
        byPlayer.set(id, position)
        matched.set(position, id)
        return true
      }
    }
    return false
  }

  const unmatched: Position[] = []
  for (const position of ordered) {
    if (!assign(position, new Set())) unmatched.push(position)
  }
  return { matched, unmatched }
}

/** Hardest position first, ties broken randomly. */
function byScarcity(
  positions: Position[],
  adjacency: Map<Position, string[]>,
  rng: Rng,
): Position[] {
  return rng
    .shuffle(positions)
    .sort((a, b) => (adjacency.get(a)?.length ?? 0) - (adjacency.get(b)?.length ?? 0))
}

/**
 * The fairest set of players that still covers everything coverable.
 *
 * Coverage has to constrain who plays, not choose who plays. Reserving every
 * player a maximum matching happens to name fills the whole defence and leaves
 * fairness no vote at all, because Kuhn's maximises cardinality and is
 * indifferent to which of several equally-covering players it picks.
 *
 * The sets of players that can be simultaneously matched to distinct eligible
 * positions are the independent sets of a transversal matroid, and greedy is
 * optimal on a matroid: walk players best-first and keep each one whose
 * addition preserves matchability. That yields a set of maximum size — so no
 * coverage is lost — and of maximum total fairness weight among all such sets.
 * Players it does not reserve are genuinely interchangeable for coverage, so
 * fairness alone decides them.
 *
 * A player is reserved only when every maximum matching must contain them:
 * the sole eligible catcher is reserved and plays; the ninth interchangeable
 * outfielder is not.
 */
function reserveForCoverage(
  benchInFairnessOrder: PresentPlayer[],
  openPositions: Position[],
  byId: Map<string, PresentPlayer>,
  eligible: (position: Position, player: PresentPlayer) => boolean,
): Set<string> {
  const holder = new Map<Position, string>()
  const reserved = new Set<string>()

  const augment = (player: PresentPlayer, visited: Set<Position>): boolean => {
    for (const position of openPositions) {
      if (visited.has(position)) continue
      if (!eligible(position, player)) continue
      visited.add(position)
      const current = holder.get(position)
      const currentPlayer = current === undefined ? undefined : byId.get(current)
      if (currentPlayer === undefined || augment(currentPlayer, visited)) {
        holder.set(position, player.id)
        return true
      }
    }
    return false
  }

  for (const player of benchInFairnessOrder) {
    if (augment(player, new Set())) reserved.add(player.id)
  }
  return reserved
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
    reserveCoverage,
  } = ctx

  const size = positions.length
  const available = present.filter((p) => isAvailable(p, inning))
  const eligible = (position: Position, player: PresentPlayer) =>
    player.positions[position] !== undefined

  const assignment: InningAssignment = {}
  const chosen: PresentPlayer[] = []
  const pinnedIds = new Set<string>()
  const taken = new Set<string>()

  let chosenF = 0
  let chosenM = 0
  let freeF = available.filter((p) => p.isFemale).length
  let freeM = available.length - freeF

  if (countsProblem(0, 0, 0, freeF, freeM, size, requiredFemales)) return null

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
    countsProblem(
      chosenF + (player.isFemale ? 1 : 0),
      chosenM + (player.isFemale ? 0 : 1),
      chosen.length + 1,
      freeF - (player.isFemale ? 1 : 0),
      freeM - (player.isFemale ? 0 : 1),
      size,
      requiredFemales,
    ) === null

  // --- Pins. Honoured unless honouring one would make the inning illegal.
  // Every rejection here is explained to the captain by `pinWarnings`, which
  // walks the same sequence of checks over the same state.
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

  const openPositions = positions.filter((p) => assignment[p] === undefined)

  // One fairness ordering, used by both halves of the selection so they agree
  // on who is most owed an inning.
  const bench = available
    .filter((p) => !taken.has(p.id))
    .map((p) => ({ player: p, rank: fieldingRank(p, inningsPlayed, rng) }))
    .sort((a, b) => b.rank - a.rank)
    .map((entry) => entry.player)

  // --- Phase A: who fields this inning. ---
  // Fairness is the selector; coverage is only a constraint on it. Reserve the
  // players coverage genuinely requires, then let fairness spend every slot
  // coverage did not claim. The feasibility guard gates every take, so the
  // greedy can never paint itself into a corner: it refuses any pick that
  // would create one, and legality outranks both other goals.
  const reserved = reserveCoverage
    ? reserveForCoverage(bench, openPositions, byId, eligible)
    : new Set<string>()
  let freeSlots = openPositions.length - reserved.size

  for (const player of bench) {
    if (chosen.length >= size) break
    if (!keepsFeasible(player)) continue
    if (!reserved.has(player.id)) {
      if (freeSlots <= 0) continue
      freeSlots--
    }
    take(player)
  }

  // A reserved player refused on legality leaves a hole. Fill it with the next
  // fair, legal body — a covered position is worth less than a legal inning.
  while (chosen.length < size) {
    const next = bench.find((player) => !taken.has(player.id) && keepsFeasible(player))
    if (!next) return null
    take(next)
  }

  // --- Phase B: which position each of them plays. ---
  const freePlayers = chosen.filter((p) => !pinnedIds.has(p.id))

  const adjacency = new Map<Position, string[]>()
  for (const position of openPositions) {
    adjacency.set(
      position,
      freePlayers
        .filter((p) => eligible(position, p))
        .map((p) => ({ id: p.id, rank: positionRank(p, position, positionCounts, rng) }))
        .sort((a, b) => b.rank - a.rank)
        .map((c) => c.id),
    )
  }

  const { matched, unmatched } = maximumMatching(
    byScarcity(openPositions, adjacency, rng),
    adjacency,
  )
  const placed = new Set<string>()
  for (const [position, id] of matched) {
    assignment[position] = id
    placed.add(id)
  }

  // Nobody eligible is left for these. Fill them anyway — an unfilled
  // position is a forfeit, an out-of-position fielder is just a bad inning.
  for (const position of unmatched) {
    const leftovers = freePlayers.filter((p) => !placed.has(p.id))
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
    placed.add(pick.id)
    assignment[position] = pick.id
  }

  // Roster-data problems worth telling the captain about, judged against the
  // whole available bench rather than against who happened to be picked: a
  // position merely crowded out this inning is not the captain's problem.
  const uncoverable: Position[] = []
  const subOnly: Position[] = []
  for (const position of openPositions) {
    const listed = available.filter((p) => eligible(position, p))
    if (listed.length === 0) uncoverable.push(position)
    else if (listed.every((p) => p.isSub)) subOnly.push(position)
  }

  return { assignment, relaxedCount: unmatched.length, uncoverable, subOnly }
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
