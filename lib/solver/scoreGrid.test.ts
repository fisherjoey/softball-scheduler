import { describe, it, expect } from 'vitest'
import { scoreGrid } from './scoreGrid'
import { mkPlayer } from './fixtures'
import { WEIGHTS } from '@/lib/rules/config'
import type { InningAssignment } from '@/lib/types'

/** A player eligible nowhere, so fit rewards never muddy a test's arithmetic. */
const nobody = (id: string, opts: Parameters<typeof mkPlayer>[1] = {}) =>
  mkPlayer(id, { ...opts, positions: {} })

describe('scoreGrid', () => {
  it('scores an empty grid as zero', () => {
    expect(scoreGrid([], [nobody('a')], 0)).toBe(0)
  })

  it('ignores ids that are not in the present list', () => {
    expect(scoreGrid([{ P: 'ghost' }], [nobody('a')], 0)).toBe(0)
  })

  it('rewards a placement by its eligibility tier', () => {
    const grid: InningAssignment[] = [{ P: 'a' }]
    const primary = mkPlayer('a', { positions: { P: 'primary' } })
    const backup = mkPlayer('a', { positions: { P: 'backup' } })

    expect(scoreGrid(grid, [primary], 0)).toBe(WEIGHTS.primaryFit)
    expect(scoreGrid(grid, [backup], 0)).toBe(WEIGHTS.backupFit)
  })

  it('gives no fit reward for an out-of-position placement', () => {
    const player = mkPlayer('a', { positions: { C: 'primary' } })
    expect(scoreGrid([{ P: 'a' }], [player], 0)).toBe(0)
  })

  it('charges the relaxed-eligibility penalty once per relaxed assignment', () => {
    expect(scoreGrid([{ P: 'a' }], [nobody('a')], 3)).toBe(-3 * WEIGHTS.eligibilityRelaxed)
  })

  it('charges a sub for every inning they spend on the field', () => {
    const sub = nobody('s', { isSub: true })
    expect(scoreGrid([{ P: 's' }, { P: 's' }], [sub], 0)).toBe(-2 * WEIGHTS.subOnField)
  })

  it('leaves subs out of the equal-innings variance entirely', () => {
    // Roster player r is the only one counted for variance, and holds a
    // variance of 0 in both grids. The sole difference is the sub penalty —
    // if subs were counted, the two grids would differ by more than that.
    const roster = nobody('r')
    const sub = nobody('s', { isSub: true })
    const withSub = scoreGrid([{ P: 'r' }, { P: 's' }], [roster, sub], 0)
    const withoutSub = scoreGrid([{ P: 'r' }, { P: 'r' }], [roster, sub], 0)

    expect(withoutSub).toBe(0)
    expect(withSub).toBe(withoutSub - WEIGHTS.subOnField)
  })

  it('penalises uneven innings across roster players', () => {
    const a = nobody('a')
    const b = nobody('b')
    // Counts 1 and 1: variance 0. Counts 2 and 0: mean 1, variance 1.
    expect(scoreGrid([{ P: 'a' }, { P: 'b' }], [a, b], 0)).toBe(0)
    expect(scoreGrid([{ P: 'a' }, { P: 'a' }], [a, b], 0)).toBe(-1 * WEIGHTS.equalInnings)
  })

  it('does not penalise a position held exactly up to the repeat threshold', () => {
    const grid: InningAssignment[] = Array.from(
      { length: WEIGHTS.positionRepeatThreshold },
      () => ({ P: 'a' }),
    )
    expect(scoreGrid(grid, [nobody('a')], 0)).toBe(0)
  })

  it('penalises each appearance beyond the position-repeat threshold', () => {
    const grid: InningAssignment[] = Array.from(
      { length: WEIGHTS.positionRepeatThreshold + 2 },
      () => ({ P: 'a' }),
    )
    expect(scoreGrid(grid, [nobody('a')], 0)).toBe(-2 * WEIGHTS.positionRepeat)
  })

  it('counts each position separately when spreading a player around', () => {
    // Four innings split across two positions stays under the threshold at
    // both, so a player who moves around is never charged for repetition.
    const grid: InningAssignment[] = [{ P: 'a' }, { P: 'a' }, { C: 'a' }, { C: 'a' }]
    expect(scoreGrid(grid, [nobody('a')], 0)).toBe(0)
  })
})
