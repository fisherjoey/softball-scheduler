import { RULES, SOLVER } from '@/lib/rules/config'
import type { Rng } from './rng'

export type Gender = 'F' | 'M'

/**
 * Run lengths around the circular batting order. The order wraps, so the
 * players at the bottom and the top are adjacent.
 */
export function circularRuns(pattern: Gender[]): number[] {
  const n = pattern.length
  if (n === 0) return []
  const allSame = pattern.every((g) => g === pattern[0])
  if (allSame) return [n]

  // Rotate to a boundary so runs are not split across the array edge.
  let start = 0
  while (pattern[start] === pattern[(start - 1 + n) % n]) start++

  const runs: number[] = []
  let current = 1
  for (let k = 1; k <= n; k++) {
    const idx = (start + k) % n
    const prev = (start + k - 1) % n
    if (k < n && pattern[idx] === pattern[prev]) {
      current++
    } else {
      runs.push(current)
      current = 1
    }
  }
  return runs
}

/**
 * A pattern is legal when:
 *  - at most one run reaches maxSameGenderRun, and none exceeds it (either gender)
 *  - the opening slots contain the required number of female spots
 */
export function isValidGenderPattern(pattern: Gender[]): boolean {
  if (pattern.length === 0) return false

  const runs = circularRuns(pattern)
  if (runs.some((r) => r > RULES.maxSameGenderRun)) return false
  if (runs.filter((r) => r === RULES.maxSameGenderRun).length > RULES.maxRunsAtMaxLength) {
    return false
  }

  const { count, within } = RULES.femaleSpotsInOpening
  const window = Math.min(within, pattern.length)
  const femalesInOpening = pattern.slice(0, window).filter((g) => g === 'F').length
  if (femalesInOpening < count) return false

  return true
}

/**
 * C(n, k), computed multiplicatively so it never touches a factorial. Bails
 * out to Infinity as soon as the running total exceeds `limit`, since callers
 * only care whether the true count is at or below that limit.
 *
 * Exported for tests only.
 */
export function combinationCountUpTo(n: number, k: number, limit: number): number {
  if (k < 0 || k > n) return 0
  // C(n, k) = C(n, n - k), and only the smaller side is safe to walk with an
  // early bail-out: for k <= n/2 the running product C(n,1), C(n,2), ... is
  // nondecreasing, so no intermediate can exceed `limit` unless the true
  // count does. Walking the larger side can — C(24, 16) passes ~2.7M
  // mid-loop on its way down to 735,471 — which falsely reported Infinity
  // and silently degraded enumeration to sampling.
  k = Math.min(k, n - k)
  let result = 1
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1)
    if (result > limit) return Infinity
  }
  return result
}

/**
 * Every combination of `k` indices out of `[0, n)`, in deterministic
 * lexicographic order. Iterative "next combination" stepping rather than a
 * recursive generator — recursive `yield*` delegation is too slow in V8 at
 * the combination counts this walks (hundreds of thousands per call).
 */
function* combinations(n: number, k: number): Generator<number[]> {
  if (k < 0 || k > n) return
  const combo = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield [...combo]
    let i = k - 1
    while (i >= 0 && combo[i] === i + n - k) i--
    if (i < 0) return
    combo[i]++
    for (let j = i + 1; j < k; j++) combo[j] = combo[j - 1] + 1
  }
}

/**
 * Valid patterns of length `n` with exactly `femaleSpots` female slots.
 *
 * When the combination space C(n, femaleSpots) is small enough to walk
 * (at or below SOLVER.exhaustiveEnumerationLimit), every combination is
 * checked exhaustively and every valid pattern is collected — valid patterns
 * become a vanishing fraction of the space at tight roster sizes, so random
 * sampling can miss them entirely. Otherwise, falls back to randomised
 * combination sampling: shuffle indices, take the first `femaleSpots`. Either
 * way, the result is shuffled with the injected Rng before being capped at
 * SOLVER.maxPatternCandidates, so the output stays seed-deterministic.
 */
export function enumerateGenderPatterns(
  n: number,
  femaleSpots: number,
  rng: Rng,
): Gender[][] {
  const found: Gender[][] = []

  const spaceSize = combinationCountUpTo(n, femaleSpots, SOLVER.exhaustiveEnumerationLimit)

  if (spaceSize <= SOLVER.exhaustiveEnumerationLimit) {
    // Reuse a single buffer across combinations instead of allocating a
    // fresh n-length array per candidate — the combination count can run
    // into the hundreds of thousands, so per-iteration allocation matters.
    const pattern: Gender[] = Array.from({ length: n }, () => 'M')
    for (const picked of combinations(n, femaleSpots)) {
      for (const i of picked) pattern[i] = 'F'
      if (isValidGenderPattern(pattern)) found.push([...pattern])
      for (const i of picked) pattern[i] = 'M'
    }
  } else {
    const seen = new Set<string>()
    const indices = Array.from({ length: n }, (_, i) => i)
    // Randomised combination sampling: shuffle, take the first `femaleSpots`.
    // Cheap, unbiased enough, and avoids materialising C(n, f) combinations.
    const attempts = Math.min(50_000, SOLVER.maxPatternCandidates * 25)
    for (let a = 0; a < attempts && found.length < SOLVER.maxPatternCandidates; a++) {
      const picked = rng.shuffle(indices).slice(0, femaleSpots)
      const key = [...picked].sort((x, y) => x - y).join(',')
      if (seen.has(key)) continue
      seen.add(key)

      const pattern: Gender[] = Array.from({ length: n }, () => 'M')
      for (const i of picked) pattern[i] = 'F'
      if (isValidGenderPattern(pattern)) found.push(pattern)
    }
  }

  return rng.shuffle(found).slice(0, SOLVER.maxPatternCandidates)
}
