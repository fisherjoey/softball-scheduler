import { RULES } from './config'

/**
 * How many female slots a batting order of `n` players must contain.
 *
 * The order is circular. F female slots split it into F gaps of consecutive
 * males. Every gap must be at most 2, except one gap of exactly 3. So for M
 * males: M <= 2F + 1, and with M = n - F that solves to F >= (n - 1) / 3.
 *
 * This reproduces the CSSC published chart exactly.
 */
export function femaleSpotsRequired(n: number): number {
  const floor = RULES.femaleSpotsInOpening.count
  return Math.max(floor, Math.ceil((n - 1) / RULES.maxSameGenderRun))
}
