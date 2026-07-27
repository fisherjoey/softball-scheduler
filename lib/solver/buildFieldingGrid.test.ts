import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildFieldingGrid, inningStatus, isAvailable } from './buildFieldingGrid'
import { scoreGrid } from './scoreGrid'
import { validateRoster } from './validateRoster'
import { mkPlayer, mkRoster } from './validateRoster.test'
import { RULES } from '@/lib/rules/config'
import { POSITIONS, type FieldingGrid, type PresentPlayer, type Position } from '@/lib/types'

/**
 * p0 is the only player listed at P and the only one listed at C. Both
 * positions are covered on paper, but one of them must be staffed out of
 * position every inning because p0 can only stand in one place.
 */
function crowdedOutRoster(): PresentPlayer[] {
  const others = Object.fromEntries(
    POSITIONS.filter((p) => p !== 'P' && p !== 'C').map((p) => [p, 'primary' as const]),
  )
  const everything = Object.fromEntries(POSITIONS.map((p) => [p, 'primary' as const]))
  return Array.from({ length: 13 }, (_, i) =>
    mkPlayer(`p${i}`, { isFemale: i < 5, positions: i === 0 ? everything : others }),
  )
}

/**
 * Assert every hard constraint. Throws with a readable reason on failure.
 *
 * Rules 1 and 5 are checked against the status of the inning in question, not
 * of the whole game. Those two differ only when somebody arrives late or
 * leaves early: a roster of 12 fields 10, but once five of them go home after
 * the third inning the fourth can only legally field 7.
 */
function assertLegal(grid: FieldingGrid, present: PresentPlayer[]) {
  const byId = new Map(present.map((p) => [p.id, p]))

  grid.assignments.forEach((inningMap, idx) => {
    const inning = idx + 1
    const status = inningStatus(present, inning)
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

  it('gives a different grid for the next seed, so Reshuffle visibly changes something', () => {
    // Restart r uses hash(seed, r), not seed + r. With `seed + r` and 300
    // restarts, seed N and seed N+1 share 299 of their 300 restarts and
    // almost always return the identical best grid.
    const present = mkRoster(16, 6)
    for (const n of [1, 2, 3, 4, 5]) {
      const a = buildFieldingGrid({ present, innings: 7, pins: [], seed: n })
      const b = buildFieldingGrid({ present, innings: 7, pins: [], seed: n + 1 })
      expect(a.assignments, `seeds ${n} and ${n + 1} produced the same grid`).not.toEqual(
        b.assignments,
      )
    }
  })

  it('fields the only player who can cover a position, even when they are a sub', () => {
    // Twelve roster players cover everything except C; one sub covers only C.
    // Fairness alone would bench the sub and staff C out of position all game,
    // which scoreGrid rates ~7000 points worse than just playing him.
    const withoutC = Object.fromEntries(
      POSITIONS.filter((p) => p !== 'C').map((p) => [p, 'primary' as const]),
    )
    const roster = Array.from({ length: 12 }, (_, i) =>
      mkPlayer(`r${i}`, { isFemale: i < 5, positions: withoutC }),
    )
    const sub = mkPlayer('catcher', { isSub: true, positions: { C: 'primary' } })
    const present = [...roster, sub]

    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 26 })

    expect(grid.assignments.map((i) => i.C)).toEqual(Array(7).fill('catcher'))
    expect(grid.warnings.join(' ')).toMatch(/Only a sub is listed at C/)
    assertLegal(grid, present)
  })

  it('fields the only player who can cover a position from a deep bench', () => {
    // 17 present, 10 field: a 7-deep bench for fairness to rotate through.
    // p0 is the only catcher, so he catches all seven innings regardless.
    const withoutC = Object.fromEntries(
      POSITIONS.filter((p) => p !== 'C').map((p) => [p, 'primary' as const]),
    )
    const everything = Object.fromEntries(POSITIONS.map((p) => [p, 'primary' as const]))
    const present = Array.from({ length: 17 }, (_, i) =>
      mkPlayer(`p${i}`, { isFemale: i < 6, positions: i === 0 ? everything : withoutC }),
    )

    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 27 })

    expect(grid.assignments.map((i) => i.C)).toEqual(Array(7).fill('p0'))
    assertLegal(grid, present)
  })

  it('drops a pin that would break the M/X cap, and says which one', () => {
    // p0-p4 are female, p5-p12 male. Pin eight men into one inning.
    const present = mkRoster(13, 5)
    const pins = POSITIONS.slice(0, 8).map((position, i) => ({
      inning: 1,
      position: position as Position,
      playerId: `p${5 + i}`,
    }))

    const grid = buildFieldingGrid({ present, innings: 7, pins, seed: 20 })

    // The first seven are honoured; only the eighth is impossible.
    expect(grid.assignments[0].P).toBe('p5')
    expect(grid.assignments[0].LF).toBe('p11')
    const dropped = grid.warnings.filter((w) => /Could not honour the pin/.test(w))
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toMatch(/p12/)
    expect(dropped[0]).toMatch(/CF/)
    expect(dropped[0]).toMatch(/inning 1/)
    expect(dropped[0]).toMatch(/M\/X cap/)
    assertLegal(grid, present)
  })

  it('keeps the first of two pins on one position and consumes only that player', () => {
    // 10 present and 10 fielded, so there is no spare body: a player consumed
    // by a dropped pin without being placed would make the inning unfillable.
    const present = mkRoster(10, 3)
    const pins = [
      { inning: 1, position: 'P' as Position, playerId: 'p5' },
      { inning: 1, position: 'P' as Position, playerId: 'p6' },
    ]

    const grid = buildFieldingGrid({ present, innings: 7, pins, seed: 21 })

    expect(grid.assignments[0].P).toBe('p5')
    expect(Object.keys(grid.assignments[0])).toHaveLength(10)
    expect(Object.values(grid.assignments[0])).toContain('p6')
    const dropped = grid.warnings.filter((w) => /Could not honour the pin/.test(w))
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toMatch(/already pinned/)
    assertLegal(grid, present)
  })

  it('explains a pin on a player who has not arrived yet', () => {
    const present = mkRoster(13, 5)
    present[7] = { ...present[7], arrivedInning: 4 }
    const pins = [{ inning: 2, position: 'P' as Position, playerId: present[7].id }]

    const grid = buildFieldingGrid({ present, innings: 7, pins, seed: 22 })

    const dropped = grid.warnings.filter((w) => /Could not honour the pin/.test(w))
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toMatch(/not available/)
    assertLegal(grid, present)
  })

  it('explains a pin on somebody who is not present at all', () => {
    const present = mkRoster(13, 5)
    const pins = [{ inning: 1, position: 'P' as Position, playerId: 'ghost' }]

    const grid = buildFieldingGrid({ present, innings: 7, pins, seed: 23 })

    expect(grid.warnings.join(' ')).toMatch(/pin of ghost at P in inning 1/)
    assertLegal(grid, present)
  })

  it('does not claim a position is uncovered when somebody is listed but crowded out', () => {
    // p0 is the only player listed at P and the only one listed at C, so one
    // of the two must be filled out of position every inning. Both ARE covered
    // on paper, so the roster-data warning must stay silent.
    const present = crowdedOutRoster()
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 24 })

    expect(grid.warnings.filter((w) => /Nobody present is listed/.test(w))).toEqual([])
    assertLegal(grid, present)
  })

  it('scores the true number of out-of-position assignments', () => {
    // Exactly one of P/C is relaxed each inning, so the honest count is 7.
    // Charging per relaxed POSITION for every inning would bill 14 instead.
    const present = crowdedOutRoster()
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 24 })
    const byId = new Map(present.map((p) => [p.id, p]))

    let relaxed = 0
    for (const inning of grid.assignments) {
      for (const [pos, id] of Object.entries(inning) as [Position, string][]) {
        if (byId.get(id)!.positions[pos] === undefined) relaxed++
      }
    }

    expect(relaxed).toBe(7)
    expect(grid.score).toBe(scoreGrid(grid.assignments, present, relaxed))
  })

  it('fields fewer players after people leave, instead of throwing', () => {
    // 12 present (4F/8M); five of the men leave after inning 3. The whole-game
    // roster validates clean at 10 fielders, but innings 4-7 have only seven
    // people available and can only legally field seven.
    const present = Array.from({ length: 12 }, (_, i) =>
      mkPlayer(`p${i}`, { isFemale: i < 4, leftInning: i >= 7 ? 3 : null }),
    )
    expect(validateRoster(present).activePositions).toHaveLength(10)
    expect(validateRoster(present).blockers).toEqual([])

    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 25 })

    expect(Object.keys(grid.assignments[0])).toHaveLength(10)
    expect(Object.keys(grid.assignments[2])).toHaveLength(10)
    expect(Object.keys(grid.assignments[3])).toHaveLength(7)
    expect(Object.keys(grid.assignments[6])).toHaveLength(7)
    expect(grid.warnings.join(' ')).toMatch(/Innings 4-7 field 7, not 10/)
    assertLegal(grid, present)
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
