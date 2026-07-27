import type { BattingInput, BattingOrder, BattingSlot, PresentPlayer } from '@/lib/types'
import { RULES, WEIGHTS } from '@/lib/rules/config'
import { enumerateGenderPatterns, isValidGenderPattern, type Gender } from './genderPattern'
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
  // With S scarce-gender slots dividing the order into S gaps, the abundant
  // gender's total is capped at S*(maxSameGenderRun - 1) + maxRunsAtMaxLength
  // (every gap but the permitted maxRunsAtMaxLength ones sits one below the
  // max run length). Solving that bound for S gives the closed form below —
  // no iteration needed, since the abundant headcount is fixed up front and
  // doesn't depend on S.
  const womenAreScarcer = women.length <= men.length
  const abundantCount = womenAreScarcer ? men.length : women.length
  const scarceCount = womenAreScarcer ? women.length : men.length

  const runLengthMinimum = Math.ceil(
    (abundantCount - RULES.maxRunsAtMaxLength) / (RULES.maxSameGenderRun - 1),
  )
  // The opening-window female-representation floor is a second, independent
  // constraint (isValidGenderPattern enforces it unconditionally on the
  // gender literally labelled 'F') — it only binds here when women are the
  // side being padded.
  const openingFloor = womenAreScarcer ? RULES.femaleSpotsInOpening.count : 0
  const scarceSpots = Math.max(scarceCount, runLengthMinimum, openingFloor)

  const n = abundantCount + scarceSpots
  const femaleSpots = womenAreScarcer ? scarceSpots : abundantCount

  let patterns = enumerateGenderPatterns(n, femaleSpots, rng)
  if (patterns.length === 0) {
    // enumerateGenderPatterns is only exhaustive below
    // SOLVER.exhaustiveEnumerationLimit combinations; above that it falls
    // back to randomised sampling, which can legitimately miss a pattern
    // that exists — valid patterns become a vanishing fraction of a huge
    // combination space right at this closed form's tight minimum. (Not
    // hypothetical: enumerateGenderPatterns(28, 9, rng) — reachable from a
    // real roster of 19 men + 2 women — found 0 patterns for 7 of 8 sampled
    // seeds, even though a legal pattern demonstrably exists.)
    //
    // So an empty result here does not yet mean the roster is impossible.
    // Construct the arrangement the slot-count bound was derived from
    // directly: spread the scarce gender as evenly as possible through the
    // order. That is provably the loosest-possible placement for the
    // legal-run bound above, so it is legal whenever these slot counts are
    // (verified against isValidGenderPattern for every men/women split
    // reachable from a present.length of 7..22 — see the fix-round report).
    const scarceGender: Gender = womenAreScarcer ? 'F' : 'M'
    const abundantGender: Gender = womenAreScarcer ? 'M' : 'F'
    const constructed: Gender[] = Array.from({ length: n }, () => abundantGender)
    for (let i = 0; i < scarceSpots; i++) {
      constructed[Math.floor((i * n) / scarceSpots)] = scarceGender
    }
    if (!isValidGenderPattern(constructed)) {
      // The construction is proven legal within the reachable domain above;
      // reaching here means the roster is a genuine, unanticipated
      // contradiction. Fail loudly rather than silently return an illegal
      // order or drop a player, as the old naive fallback used to.
      throw new Error(
        `No legal batting order exists for this roster: ${men.length} men, ${women.length} women ` +
          `(computed ${n} total slots — ${femaleSpots} female, ${n - femaleSpots} male).`,
      )
    }
    patterns = [constructed]
  }

  let best: BattingOrder | null = null
  let bestScore = -Infinity
  for (const pattern of patterns) {
    const candidate = fillPattern(pattern, women, men, rng, [...warnings])
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
