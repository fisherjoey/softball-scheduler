import type { BattingInput, BattingOrder, BattingSlot, PresentPlayer } from '@/lib/types'
import { RULES, WEIGHTS } from '@/lib/rules/config'
import { femaleSpotsRequired } from '@/lib/rules/femaleSpots'
import { enumerateGenderPatterns, type Gender } from './genderPattern'
import { makeRng, type Rng } from './rng'

/**
 * Build the batting order.
 *
 * Everyone present bats. When the required number of female slots exceeds the
 * women available, the extra slots either repeat a woman (3+ women present) or
 * become automatic outs (fewer than 3 women present) — per CSSC rules.
 */
export function buildBattingOrder(input: BattingInput): BattingOrder {
  const { present, history, seed } = input
  const rng = makeRng(seed)
  const warnings: string[] = []

  const women = present.filter((p) => p.isFemale)
  const men = present.filter((p) => !p.isFemale)

  // Whichever gender is scarcer is the one that may need to pad out its
  // slot count (via repeats, or automatic outs when it's women below the
  // league minimum) so the more numerous gender never runs longer than the
  // legal max. The abundant gender always gets exactly one slot per person
  // — it never repeats or sits out.
  //
  // femaleSpotsRequired(n) is defined in terms of the order's own final
  // length, which is exactly what we're solving for, so converge on it: try
  // the scarce gender's real headcount, see how many slots that implies the
  // order needs in total, re-derive the requirement for that length, and
  // repeat until it stops moving. This always settles in a few steps because
  // each step's requirement only grows with the (fixed) abundant headcount.
  const womenAreScarcer = women.length <= men.length
  const abundantCount = womenAreScarcer ? men.length : women.length
  const scarceCount = womenAreScarcer ? women.length : men.length

  let scarceSpots = scarceCount
  for (let i = 0; i < 8; i++) {
    const candidateN = abundantCount + scarceSpots
    const required = femaleSpotsRequired(candidateN)
    const next = Math.max(scarceCount, required)
    if (next === scarceSpots) break
    scarceSpots = next
  }

  const n = abundantCount + scarceSpots
  const femaleSpots = womenAreScarcer ? scarceSpots : abundantCount

  const patterns = enumerateGenderPatterns(n, femaleSpots, rng)
  if (patterns.length === 0) {
    // Should be unreachable: femaleSpotsRequired guarantees a pattern exists.
    warnings.push('Could not find a legal batting-order pattern. Falling back to alternating.')
    const fallback: Gender[] = Array.from({ length: n }, (_, i) => (i % 3 === 2 ? 'F' : 'M'))
    return fillPattern(fallback, women, men, history, rng, warnings)
  }

  let best: BattingOrder | null = null
  let bestScore = -Infinity
  for (const pattern of patterns) {
    const candidate = fillPattern(pattern, women, men, history, rng, [...warnings])
    const score = scoreOrder(candidate, history)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best!
}

/** Place real players into a gender pattern's slots. */
function fillPattern(
  pattern: Gender[],
  women: PresentPlayer[],
  men: PresentPlayer[],
  history: BattingInput['history'],
  rng: Rng,
  warnings: string[],
): BattingOrder {
  const slots: BattingSlot[] = new Array(pattern.length)

  const shortOnWomen = women.length < RULES.minFemalesOnField
  const womenPool = rng.shuffle(women)
  const menPool = rng.shuffle(men)

  let femaleSpotIndex = 0
  let womanCursor = 0
  let manCursor = 0
  let autoOuts = 0

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === 'F') {
      femaleSpotIndex++
      if (shortOnWomen && femaleSpotIndex % RULES.autoOutEveryNthFemaleSpot === 0) {
        slots[i] = { kind: 'autoOut' }
        autoOuts++
        continue
      }
      // Women repeat in rotation once the pool is exhausted.
      slots[i] = { kind: 'player', playerId: womenPool[womanCursor % womenPool.length].id }
      womanCursor++
    } else {
      slots[i] = { kind: 'player', playerId: menPool[manCursor % menPool.length].id }
      manCursor++
    }
  }

  if (autoOuts > 0) {
    warnings.push(
      `Only ${women.length} female players — every ${RULES.autoOutEveryNthFemaleSpot}rd female slot is an automatic out (${autoOuts} this order).`,
    )
  }
  const repeats = womanCursor - womenPool.length
  if (repeats > 0) {
    warnings.push(
      `${repeats} female slot${repeats === 1 ? '' : 's'} filled by repeating a woman already in the order, as the rules allow.`,
    )
  }

  return { slots, pattern, warnings }
}

/** Higher is better. Penalises reusing a slot a player held recently. */
function scoreOrder(order: BattingOrder, history: BattingInput['history']): number {
  let score = 0
  const byPlayer = new Map(history.map((h) => [h.playerId, h.slots]))
  order.slots.forEach((slot, index) => {
    if (slot.kind !== 'player') return
    const recent = byPlayer.get(slot.playerId)
    if (!recent) return
    // Recency-weighted: the most recent game counts most.
    recent.forEach((prev, age) => {
      if (prev === index) score -= WEIGHTS.battingSlotRepeat / (age + 1)
    })
  })
  return score
}
