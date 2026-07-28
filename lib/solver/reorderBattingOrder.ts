import type { BattingOrder, BattingSlot, PresentPlayer } from '@/lib/types'
import { RULES } from '@/lib/rules/config'
import { isValidGenderPattern, type Gender } from './genderPattern'

export type ReorderResult = { order: BattingOrder; repaired: boolean } | { error: string }

/**
 * Move one batting slot to a new position, keeping the order legal.
 *
 * The captain's placement is the fixed point: the dragged player stays exactly
 * at the drop slot. If the raw insertion is already legal, nobody else moves.
 * If it is not, the women re-space to the *nearest* legal arrangement — the
 * legal gender pattern (with the dragged player's gender pinned at the drop
 * slot) that minimises total female displacement, everyone keeping their
 * relative order. Only when no legal pattern puts that gender at that slot at
 * all does the move refuse, with a reason.
 *
 * Automatic outs are rule artifacts, not players: they cannot be dragged, and
 * whenever the women re-space they re-derive onto every
 * `RULES.autoOutEveryNthFemaleSpot`-th female slot of the new pattern, exactly
 * where `buildBattingOrder` puts them.
 *
 * Never mutates its input: the caller keeps the old order to fall back to
 * when the answer is `{ error }`.
 */
export function reorderBattingOrder(
  order: BattingOrder,
  present: PresentPlayer[],
  from: number,
  to: number,
): ReorderResult {
  const n = order.slots.length
  for (const idx of [from, to]) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) {
      return { error: `Slot ${idx + 1} is not part of this order.` }
    }
  }
  if (order.slots[from].kind === 'autoOut') {
    return { error: 'Automatic outs sit where the rules put them — move players instead.' }
  }
  if (from === to) {
    return { order, repaired: false }
  }

  const best = bestArrangement(order, present, from, to, false)
  if (!best) {
    const gender = genderAt(order, present, from)
    return {
      error:
        gender === 'F'
          ? 'No legal batting order puts a woman in that slot — the female-slot rules pin where she can go.'
          : 'No legal batting order puts a man in that slot — it would need a run of men the rules do not allow.',
    }
  }

  return {
    order: { slots: best.slots, pattern: best.pattern, warnings: [...order.warnings] },
    repaired: best.repaired,
  }
}

/**
 * Every drop index that `reorderBattingOrder` would accept for this row.
 *
 * Meant to be called once when a drag starts, so the UI can tint each
 * insertion point green or red before the captain lets go. Uses the same
 * candidate walk as the reorder itself (stopping at the first workable
 * arrangement per target), so the two can never disagree.
 */
export function legalReorderTargets(
  order: BattingOrder,
  present: PresentPlayer[],
  from: number,
): Set<number> {
  const targets = new Set<number>()
  const n = order.slots.length
  if (!Number.isInteger(from) || from < 0 || from >= n) return targets
  if (order.slots[from].kind === 'autoOut') return targets

  for (let to = 0; to < n; to++) {
    if (to === from || bestArrangement(order, present, from, to, true)) {
      targets.add(to)
    }
  }
  return targets
}

interface Arrangement {
  slots: BattingSlot[]
  pattern: Gender[]
  repaired: boolean
}

/**
 * The heart of both entry points: find the arrangement for "slot `from`
 * dropped at `to`", or null when none exists.
 *
 * `firstOnly` skips cost minimisation and returns as soon as any workable
 * candidate exists — legality is a yes/no question during a drag, and the
 * walk visits the raw (cost-zero-if-legal) arrangement like any other.
 */
function bestArrangement(
  order: BattingOrder,
  present: PresentPlayer[],
  from: number,
  to: number,
  firstOnly: boolean,
): Arrangement | null {
  const moved = listMove(order.slots, from, to)
  const genders = moved.map((slot, i) =>
    slotGender(slot, present, order.pattern[movedPatternIndex(from, to, i)]),
  )
  const n = moved.length
  const femaleSpots = genders.filter((g) => g === 'F').length
  const draggedGender = genders[to]

  // Auto-outs exist only when the order was built short on women; their count
  // is a consequence of (n, femaleSpots) and the every-Nth rule, so it is
  // identical in every candidate and composition is preserved by construction.
  const autoOutActive = order.slots.some((s) => s.kind === 'autoOut')

  // The two relative-order pools, minus the dragged slot itself (it is pinned
  // at `to`, never queued). Positions remembered so displacement is measured
  // against where the captain's raw move put everybody.
  const womenPool: { slot: BattingSlot; at: number }[] = []
  const menPool: { slot: BattingSlot; at: number }[] = []
  moved.forEach((slot, i) => {
    if (i === to || slot.kind === 'autoOut') return
    ;(genders[i] === 'F' ? womenPool : menPool).push({ slot, at: i })
  })

  // A single-gender order is buildBattingOrder's deliberate degraded mode —
  // its own warning declares the pattern rules inapplicable, so no pattern
  // can validate and consulting the walker would refuse every move with a
  // reason that is false for this order. The captain's arrangement stands
  // as-is (the twin-adjacency check below still applies).
  if (femaleSpots === 0 || femaleSpots === n) {
    const filled = fill(genders, moved[to], to, womenPool, menPool, autoOutActive)
    return filled ? { ...filled.arrangement, repaired: false } : null
  }

  // The pattern walk prunes by run length as it goes, so its work scales with
  // the sparse legal patterns rather than C(n, femaleSpots) — reachable slot
  // counts (repeat/auto-out padding can push 20 players to 25+ slots) stay
  // interactive. The n cap is a backstop for degenerate inputs only.
  const patterns =
    n > MAX_WALK_SLOTS ? (isValidGenderPattern(genders) ? [genders] : []) : validPatterns(n, femaleSpots)

  let best: { arrangement: Arrangement; womenCost: number; totalCost: number } | null = null

  for (const pattern of patterns) {
    if (pattern[to] !== draggedGender) continue

    const filled = fill(pattern, moved[to], to, womenPool, menPool, autoOutActive)
    if (!filled) continue

    if (firstOnly) return filled.arrangement
    if (
      !best ||
      filled.womenCost < best.womenCost ||
      (filled.womenCost === best.womenCost && filled.totalCost < best.totalCost)
    ) {
      best = filled
    }
  }

  return best?.arrangement ?? null
}

/**
 * Seat everybody into a candidate pattern: the dragged slot pinned at `to`,
 * auto-outs on their rule-derived female ordinals, and both gender pools in
 * relative order across the remaining slots. Returns null when the pattern
 * cannot work — the drop slot falls on an auto-out ordinal, or the fill would
 * put a twice-batting player in adjacent slots (including last-wraps-to-first,
 * which the umpire walks straight into).
 */
function fill(
  pattern: Gender[],
  dragged: BattingSlot,
  to: number,
  womenPool: { slot: BattingSlot; at: number }[],
  menPool: { slot: BattingSlot; at: number }[],
  autoOutActive: boolean,
): { arrangement: Arrangement; womenCost: number; totalCost: number } | null {
  const slots: BattingSlot[] = new Array(pattern.length)
  let womenCost = 0
  let totalCost = 0
  let femaleOrdinal = 0
  let womanCursor = 0
  let manCursor = 0

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === 'F') {
      femaleOrdinal++
      if (autoOutActive && femaleOrdinal % RULES.autoOutEveryNthFemaleSpot === 0) {
        if (i === to) return null
        slots[i] = { kind: 'autoOut' }
        continue
      }
      if (i === to) {
        slots[i] = dragged
        continue
      }
      const woman = womenPool[womanCursor++]
      if (!woman) return null
      slots[i] = woman.slot
      womenCost += Math.abs(i - woman.at)
      totalCost += Math.abs(i - woman.at)
    } else {
      if (i === to) {
        slots[i] = dragged
        continue
      }
      const man = menPool[manCursor++]
      if (!man) return null
      slots[i] = man.slot
      totalCost += Math.abs(i - man.at)
    }
  }
  // Both pools must drain exactly — a mismatch means the candidate's female
  // count cannot host this roster's mix of women and auto-outs.
  if (womanCursor !== womenPool.length || manCursor !== menPool.length) return null

  // No player bats twice in a row, wrap included.
  for (let i = 0; i < slots.length; i++) {
    const here = slots[i]
    const next = slots[(i + 1) % slots.length]
    if (here.kind === 'player' && next.kind === 'player' && here.playerId === next.playerId) {
      return null
    }
  }

  return {
    arrangement: { slots, pattern: [...pattern], repaired: womenCost + totalCost > 0 },
    womenCost,
    totalCost,
  }
}

/** The slots array with one element moved, remove-then-insert. */
function listMove(slots: BattingSlot[], from: number, to: number): BattingSlot[] {
  const copy = [...slots]
  const [slot] = copy.splice(from, 1)
  copy.splice(to, 0, slot)
  return copy
}

/** Where index `i` of the moved array sat in the original, for pattern lookups. */
function movedPatternIndex(from: number, to: number, i: number): number {
  if (i === to) return from
  // Removing `from` shifts everything after it left; inserting at `to` shifts
  // everything at or after `to` right. Undo both to find the original index.
  const afterRemoval = i < to ? i : i - 1
  return afterRemoval < from ? afterRemoval : afterRemoval + 1
}

function genderAt(order: BattingOrder, present: PresentPlayer[], index: number): Gender {
  return slotGender(order.slots[index], present, order.pattern[index])
}

/** A slot's gender: auto-outs are female slots by definition; a player not in
 * `present` (a saved order whose attendance changed) falls back to the gender
 * the pattern recorded for wherever the slot originally sat. */
function slotGender(slot: BattingSlot, present: PresentPlayer[], recorded: Gender): Gender {
  if (slot.kind === 'autoOut') return 'F'
  const player = present.find((p) => p.id === slot.playerId)
  if (player) return player.isFemale ? 'F' : 'M'
  return recorded
}

/** Slot counts past this refuse repair outright. Real orders top out around
 * 30 slots (22 players plus repeat/auto-out padding); anything bigger is a
 * corrupt input, not a roster. */
const MAX_WALK_SLOTS = 40

// Module-scope pattern cache. Reordering hammers the same (n, femaleSpots)
// pair — once per hover target at drag start — and the pattern walk is the
// only expensive step, so cache the small handful of shapes a session
// actually sees. Deterministic, so caching cannot change results.
const patternCache = new Map<string, Gender[][]>()

/**
 * Every valid gender pattern for (n, femaleSpots), by pruned depth-first
 * construction rather than filtering all C(n, femaleSpots) combinations —
 * that filter walk hits a million combinations at real rosters (17 men +
 * 3 women is 25 slots, C(25,8) > 1e6) and would force a size gate that
 * silently turns repairable drags into refusals.
 *
 * Prunes are strict supersets of validity, so the leaf check keeps the
 * final say (it alone knows the circular wrap and the opening window):
 * - a run past maxSameGenderRun can only merge longer at the wrap, never
 *   shorter, so it is dead linearly or circularly;
 * - two linear runs at max length either stay two (over the run budget) or
 *   merge at the wrap into one longer-than-max run — dead either way;
 * - a gender whose remaining count cannot fit between the other gender's
 *   remaining separators can never complete.
 */
function validPatterns(n: number, femaleSpots: number): Gender[][] {
  const key = `${n}:${femaleSpots}`
  const cached = patternCache.get(key)
  if (cached) return cached

  const maxRun = RULES.maxSameGenderRun
  const found: Gender[][] = []
  const pattern: Gender[] = new Array(n)

  const walk = (
    i: number,
    femalesUsed: number,
    runGender: Gender | null,
    runLength: number,
    maxRunsUsed: number,
  ) => {
    if (i === n) {
      if (isValidGenderPattern(pattern)) found.push([...pattern])
      return
    }
    const remaining = n - i
    const fLeft = femaleSpots - femalesUsed
    const mLeft = remaining - fLeft
    if (fLeft < 0 || mLeft < 0) return
    if (fLeft > (mLeft + 1) * maxRun || mLeft > (fLeft + 1) * maxRun) return

    for (const g of ['F', 'M'] as const) {
      if (g === 'F' ? fLeft === 0 : mLeft === 0) continue
      const newRun = g === runGender ? runLength + 1 : 1
      if (newRun > maxRun) continue
      const newMaxRuns = maxRunsUsed + (newRun === maxRun ? 1 : 0)
      if (newMaxRuns > RULES.maxRunsAtMaxLength) continue
      pattern[i] = g
      walk(i + 1, femalesUsed + (g === 'F' ? 1 : 0), g, newRun, newMaxRuns)
    }
  }
  walk(0, 0, null, 0, 0)

  if (patternCache.size >= 8) patternCache.clear()
  patternCache.set(key, found)
  return found
}
