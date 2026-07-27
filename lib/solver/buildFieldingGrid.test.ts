import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildFieldingGrid, isAvailable } from './buildFieldingGrid'
import { validateRoster } from './validateRoster'
import { mkPlayer, mkRoster } from './validateRoster.test'
import { RULES } from '@/lib/rules/config'
import { POSITIONS, type FieldingGrid, type PresentPlayer, type Position } from '@/lib/types'

/** Assert every hard constraint. Throws with a readable reason on failure. */
function assertLegal(grid: FieldingGrid, present: PresentPlayer[]) {
  const status = validateRoster(present)
  const byId = new Map(present.map((p) => [p.id, p]))

  grid.assignments.forEach((inningMap, idx) => {
    const inning = idx + 1
    const entries = Object.entries(inningMap) as [Position, string][]

    // Exactly the active positions are filled.
    expect(entries.map(([pos]) => pos).sort()).toEqual([...status.activePositions].sort())

    // No player appears twice in one inning.
    const ids = entries.map(([, id]) => id)
    expect(new Set(ids).size, `inning ${inning} double-assigns a player`).toBe(ids.length)

    // Availability.
    for (const id of ids) {
      expect(isAvailable(byId.get(id)!, inning), `${id} unavailable in inning ${inning}`).toBe(true)
    }

    // Gender counts.
    const females = ids.filter((id) => byId.get(id)!.isFemale).length
    const males = ids.length - females
    expect(males, `inning ${inning} has ${males} M/X`).toBeLessThanOrEqual(RULES.maxMalesOnField)
    expect(females, `inning ${inning} has ${females} women`).toBeGreaterThanOrEqual(
      status.requiredFemalesOnField,
    )
  })
}

describe('buildFieldingGrid', () => {
  it('fills every active position in every inning', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 1 })
    expect(grid.assignments).toHaveLength(7)
    assertLegal(grid, present)
  })

  it('fields 9 and never a 10th when only 2 women are present', () => {
    const present = mkRoster(13, 2)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 2 })
    for (const inning of grid.assignments) {
      expect(Object.keys(inning)).toHaveLength(9)
      expect(inning.ROVER).toBeUndefined()
    }
    assertLegal(grid, present)
  })

  it('keeps roster players off the bench before subs', () => {
    // 10 roster players + 2 subs, plenty of women. Subs should never field.
    const roster = Array.from({ length: 10 }, (_, i) =>
      mkPlayer(`r${i}`, { isFemale: i < 4 }),
    )
    const subs = [mkPlayer('s0', { isSub: true }), mkPlayer('s1', { isSub: true, isFemale: true })]
    const present = [...roster, ...subs]
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 3 })
    const subInnings = grid.assignments.flatMap((i) =>
      Object.values(i).filter((id) => id.startsWith('s')),
    )
    expect(subInnings).toHaveLength(0)
    assertLegal(grid, present)
  })

  it('puts a female sub on the field when the roster cannot supply 3 women', () => {
    // 12 roster players, only 2 female. One female sub.
    const roster = Array.from({ length: 12 }, (_, i) => mkPlayer(`r${i}`, { isFemale: i < 2 }))
    const sub = mkPlayer('sub1', { isFemale: true, isSub: true })
    const present = [...roster, sub]
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 4 })
    for (const inning of grid.assignments) {
      expect(Object.keys(inning)).toHaveLength(10)
      expect(Object.values(inning)).toContain('sub1')
    }
    assertLegal(grid, present)
  })

  it('spreads innings evenly across roster players', () => {
    const present = mkRoster(13, 5) // 13 present, 10 field, 3 sit each inning
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 5 })
    const counts = new Map<string, number>(present.map((p) => [p.id, 0]))
    for (const inning of grid.assignments) {
      for (const id of Object.values(inning)) counts.set(id, counts.get(id)! + 1)
    }
    const values = [...counts.values()]
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
  })

  it('does not park anyone at one position all game', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 6 })
    const seen = new Map<string, number>()
    for (const inning of grid.assignments) {
      for (const [pos, id] of Object.entries(inning)) {
        const key = `${id}:${pos}`
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
    }
    expect(Math.max(...seen.values())).toBeLessThanOrEqual(3)
  })

  it('honours pins exactly', () => {
    const present = mkRoster(13, 5)
    const pins = [
      { inning: 1, position: 'P' as Position, playerId: 'p5' },
      { inning: 2, position: 'P' as Position, playerId: 'p5' },
      { inning: 3, position: 'C' as Position, playerId: 'p6' },
    ]
    const grid = buildFieldingGrid({ present, innings: 7, pins, seed: 7 })
    expect(grid.assignments[0].P).toBe('p5')
    expect(grid.assignments[1].P).toBe('p5')
    expect(grid.assignments[2].C).toBe('p6')
    assertLegal(grid, present)
  })

  it('respects arrival and departure innings', () => {
    const present = mkRoster(13, 5)
    present[0] = { ...present[0], arrivedInning: 4 }
    present[1] = { ...present[1], leftInning: 3 }
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 8 })
    expect(Object.values(grid.assignments[0])).not.toContain(present[0].id)
    expect(Object.values(grid.assignments[2])).not.toContain(present[0].id)
    expect(Object.values(grid.assignments[3])).not.toContain(present[1].id)
    assertLegal(grid, present)
  })

  it('copies locked innings verbatim when regenerating mid-game', () => {
    const present = mkRoster(13, 5)
    const first = buildFieldingGrid({ present, innings: 7, pins: [], seed: 9 })
    const second = buildFieldingGrid({
      present,
      innings: 7,
      pins: [],
      seed: 99,
      lockedThroughInning: 3,
      existingGrid: first,
    })
    expect(second.assignments.slice(0, 3)).toEqual(first.assignments.slice(0, 3))
    assertLegal(second, present)
  })

  it('relaxes eligibility rather than failing when nobody can cover a position', () => {
    // Nobody is eligible at catcher.
    const positionsWithoutC = Object.fromEntries(
      POSITIONS.filter((p) => p !== 'C').map((p) => [p, 'primary' as const]),
    )
    const present = Array.from({ length: 13 }, (_, i) =>
      mkPlayer(`p${i}`, { isFemale: i < 5, positions: positionsWithoutC }),
    )
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 10 })
    for (const inning of grid.assignments) expect(inning.C).toBeDefined()
    expect(grid.warnings.join(' ')).toMatch(/C\b/)
    assertLegal(grid, present)
  })

  it('is deterministic for a given seed', () => {
    const present = mkRoster(14, 5)
    const a = buildFieldingGrid({ present, innings: 7, pins: [], seed: 11 })
    const b = buildFieldingGrid({ present, innings: 7, pins: [], seed: 11 })
    expect(a).toEqual(b)
  })

  it('produces a legal grid for any legal roster', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 7, max: 20 }),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 1000 }),
        (n, rawFemales, rawSubs, seed) => {
          const females = Math.min(rawFemales, n)
          const subs = Math.min(rawSubs, n - 1)
          const present = mkRoster(n, females, subs)
          const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed, restarts: 40 })
          assertLegal(grid, present)
          return true
        },
      ),
      { numRuns: 120 },
    )
  })
})
