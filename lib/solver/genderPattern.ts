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
 * Valid patterns of length `n` with exactly `femaleSpots` female slots.
 *
 * Enumerates combinations of female slot indices in a seeded-random order and
 * keeps the valid ones, stopping at SOLVER.maxPatternCandidates. Slot 0 is
 * pinned to 'M' only when that still leaves a solution — see the fallback pass.
 */
export function enumerateGenderPatterns(
  n: number,
  femaleSpots: number,
  rng: Rng,
): Gender[][] {
  const found: Gender[][] = []
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

  return found
}
