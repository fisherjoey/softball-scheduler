import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildBattingOrder } from './buildBattingOrder'
import { isValidGenderPattern } from './genderPattern'
import { mkPlayer, mkRoster } from './validateRoster.test'
import type { BattingOrder, BattingSlot, PresentPlayer } from '@/lib/types'

/** Narrows a BattingSlot to the 'player' variant without an `any` cast. */
const isPlayerSlot = (s: BattingSlot): s is Extract<BattingSlot, { kind: 'player' }> =>
  s.kind === 'player'

const genderOf = (order: BattingOrder, present: PresentPlayer[]) =>
  order.slots.map((s) => {
    if (s.kind === 'autoOut') return 'F' as const
    return present.find((p) => p.id === s.playerId)!.isFemale ? ('F' as const) : ('M' as const)
  })

describe('buildBattingOrder', () => {
  it('bats every player present exactly once when there are enough women', () => {
    const present = mkRoster(13, 5)
    const order = buildBattingOrder({ present, history: [], seed: 1 })
    const ids = order.slots.filter(isPlayerSlot).map((s) => s.playerId)
    expect(new Set(ids).size).toBe(13)
    expect(order.slots).toHaveLength(13)
  })

  it('produces a legal gender pattern', () => {
    const present = mkRoster(13, 5)
    const order = buildBattingOrder({ present, history: [], seed: 1 })
    expect(isValidGenderPattern(genderOf(order, present))).toBe(true)
  })

  it('repeats women when exactly 3 are present and more female spots are needed', () => {
    // With 10 men present, a legal order needs at least 5 female slots (any
    // fewer and the men can't be split into runs of 3 or less), but only 3
    // women are present.
    const present = mkRoster(13, 3)
    const order = buildBattingOrder({ present, history: [], seed: 2 })
    expect(order.slots.filter((s) => s.kind === 'autoOut')).toHaveLength(0)
    const femaleIds = order.slots
      .filter(isPlayerSlot)
      .map((s) => s.playerId)
      .filter((id) => present.find((p) => p.id === id)!.isFemale)
    expect(femaleIds).toHaveLength(5)
    expect(new Set(femaleIds).size).toBe(3) // the women repeat to cover the extra slots
    // Every man still bats exactly once.
    const maleIds = order.slots
      .filter(isPlayerSlot)
      .map((s) => s.playerId)
      .filter((id) => !present.find((p) => p.id === id)!.isFemale)
    expect(new Set(maleIds).size).toBe(10)
  })

  it('inserts an automatic out at every 3rd female spot when only 2 women are present', () => {
    // 8 men present need at least 4 female slots to keep any run legal
    // (ceil((8-1)/2) = 4); with only 2 women, every 3rd of those 4 female
    // slots is an out, leaving 3 real female slots for 2 women (one repeats).
    const present = mkRoster(10, 2)
    const order = buildBattingOrder({ present, history: [], seed: 3 })
    expect(order.slots.filter((s) => s.kind === 'autoOut')).toHaveLength(1)
    expect(order.warnings.join(' ')).toMatch(/automatic out/i)

    // Every man present bats exactly once, and both women appear.
    const playerIds = order.slots.filter(isPlayerSlot).map((s) => s.playerId)
    const maleIds = playerIds.filter((id) => !present.find((p) => p.id === id)!.isFemale)
    const femaleIds = playerIds.filter((id) => present.find((p) => p.id === id)!.isFemale)
    expect(new Set(maleIds).size).toBe(present.filter((p) => !p.isFemale).length)
    expect(maleIds).toHaveLength(new Set(maleIds).size)
    expect(new Set(femaleIds).size).toBe(2)
  })

  it('rotates players off slots they held in recent games', () => {
    const present = mkRoster(12, 4)
    // p4 (male) led off the last three games.
    const history = [{ playerId: 'p4', slots: [0, 0, 0] }]
    const withHistory = buildBattingOrder({ present, history, seed: 4 })
    const slotOfP4 = withHistory.slots.findIndex(
      (s) => s.kind === 'player' && s.playerId === 'p4',
    )
    expect(slotOfP4).not.toBe(0)
  })

  it('is deterministic for a given seed', () => {
    const present = mkRoster(14, 5)
    const a = buildBattingOrder({ present, history: [], seed: 9 })
    const b = buildBattingOrder({ present, history: [], seed: 9 })
    expect(a).toEqual(b)
  })

  it('always returns a legal order for any legal roster', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 7, max: 22 }),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 1000 }),
        (n, rawFemales, seed) => {
          const females = Math.min(rawFemales, n)
          if (n - females < 1) return true // need at least one man to be realistic
          const present = mkRoster(n, females)
          const order = buildBattingOrder({ present, history: [], seed })
          const pattern = genderOf(order, present)
          return isValidGenderPattern(pattern)
        },
      ),
      { numRuns: 300 },
    )
  }, 30000)
})
