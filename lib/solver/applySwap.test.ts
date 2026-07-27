import { describe, it, expect } from 'vitest'
import { applySwap, assignToCell } from './applySwap'
import { buildFieldingGrid } from './buildFieldingGrid'
// Fixtures live in their own module — importing them from another *.test.ts
// file would run that file's suite as a side effect.
import { mkPlayer, mkRoster } from './fixtures'
import type { Position } from '@/lib/types'

describe('applySwap', () => {
  it('swaps two players within an inning', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 1 })
    const a = { inning: 1, position: 'P' as Position }
    const b = { inning: 1, position: 'C' as Position }
    const before = { p: grid.assignments[0].P, c: grid.assignments[0].C }
    const result = applySwap(grid, present, a, b)
    expect('grid' in result).toBe(true)
    if (!('grid' in result)) return
    expect(result.grid.assignments[0].P).toBe(before.c)
    expect(result.grid.assignments[0].C).toBe(before.p)
  })

  it('does not mutate the original grid', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 2 })
    const snapshot = JSON.stringify(grid.assignments)
    applySwap(grid, present, { inning: 1, position: 'P' }, { inning: 1, position: 'C' })
    expect(JSON.stringify(grid.assignments)).toBe(snapshot)
  })

  // A cross-inning swap exchanges two cells and nothing else, so it only
  // succeeds when each player is free in the inning they are moving into.
  // That is exactly the gesture worth supporting: trading a fielder for
  // somebody sitting out that inning. Dragging a cell onto a player who is
  // already on the field in the target inning would clone them, and is
  // rejected by the duplicate test below.
  it('swaps across innings', () => {
    const present = mkRoster(13, 5)
    const byId = new Map(present.map((p) => [p.id, p]))
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 3 })
    const [first, second] = grid.assignments
    const inFirst = new Set(Object.values(first))
    const inSecond = new Set(Object.values(second))

    // Both players sit out the inning they are moving into, and share a
    // gender so neither inning's female minimum or M/X cap moves.
    let a: { inning: number; position: Position } | null = null
    let b: { inning: number; position: Position } | null = null
    for (const [positionA, x] of Object.entries(first) as [Position, string][]) {
      if (inSecond.has(x)) continue
      for (const [positionB, y] of Object.entries(second) as [Position, string][]) {
        if (inFirst.has(y)) continue
        if (byId.get(x)!.isFemale !== byId.get(y)!.isFemale) continue
        a = { inning: 1, position: positionA }
        b = { inning: 2, position: positionB }
      }
    }
    expect(a).not.toBeNull()

    const before = { a: first[a!.position], b: second[b!.position] }
    const result = applySwap(grid, present, a!, b!)
    expect(result).not.toHaveProperty('error')
    if (!('grid' in result)) return
    expect(result.grid.assignments[0][a!.position]).toBe(before.b)
    expect(result.grid.assignments[1][b!.position]).toBe(before.a)
  })

  it('rejects a cross-inning swap that would break the M/X cap', () => {
    // 13 present: 10 men, 3 women. Every inning fields exactly 3 women and
    // 7 men — the cap is saturated, so moving a woman out of any inning and a
    // man in is always illegal.
    const present = [
      ...Array.from({ length: 10 }, (_, i) => mkPlayer(`m${i}`)),
      ...Array.from({ length: 3 }, (_, i) => mkPlayer(`f${i}`, { isFemale: true })),
    ]
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 4 })
    const womanSlot = (Object.entries(grid.assignments[0]) as [Position, string][]).find(
      ([, id]) => id.startsWith('f'),
    )!
    const manSlot = (Object.entries(grid.assignments[1]) as [Position, string][]).find(
      ([, id]) => id.startsWith('m'),
    )!
    const result = applySwap(
      grid,
      present,
      { inning: 1, position: womanSlot[0] },
      { inning: 2, position: manSlot[0] },
    )
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/women|M\/X/i)
  })

  it('rejects a swap involving an unavailable player', () => {
    const present = mkRoster(13, 5)
    present[0] = { ...present[0], arrivedInning: 5 }
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 5 })
    // Put p0 into inning 5, then try to move them into inning 1.
    const fifth = grid.assignments[4]
    const slot = (Object.entries(fifth) as [Position, string][]).find(([, id]) => id === 'p0')
    if (!slot) return // solver may have benched them; nothing to assert
    const result = applySwap(
      grid,
      present,
      { inning: 5, position: slot[0] },
      { inning: 1, position: slot[0] },
    )
    expect('error' in result).toBe(true)
  })

  it('rejects a swap that would duplicate a player within one inning', () => {
    const present = mkRoster(13, 5)
    const byId = new Map(present.map((p) => [p.id, p]))
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 6 })
    const inning1 = grid.assignments[0]
    const pitcher = inning1.P!
    // Somebody already fielding in inning 1, of the same gender as its
    // pitcher, so the counts stay legal and the duplicate is the only rule
    // the swap breaks.
    const duplicate = (Object.entries(grid.assignments[1]) as [Position, string][]).find(
      ([, id]) =>
        id !== pitcher &&
        Object.values(inning1).includes(id) &&
        byId.get(id)!.isFemale === byId.get(pitcher)!.isFemale,
    )
    expect(duplicate).toBeDefined()
    const result = applySwap(
      grid,
      present,
      { inning: 1, position: 'P' },
      { inning: 2, position: duplicate![0] },
    )
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/already/i)
  })

  it('reports an empty cell rather than silently dropping a fielder', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 7 })
    const copy = { ...grid, assignments: grid.assignments.map((a) => ({ ...a })) }
    delete copy.assignments[0].P
    const result = applySwap(copy, present, { inning: 1, position: 'P' }, { inning: 1, position: 'C' })
    expect('error' in result).toBe(true)
  })
})

describe('assignToCell', () => {
  it('exchanges two players already fielding in that inning', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 11 })
    const before = { p: grid.assignments[0].P!, c: grid.assignments[0].C! }
    const result = assignToCell(grid, present, { inning: 1, position: 'P' }, before.c)
    expect(result).not.toHaveProperty('error')
    if (!('grid' in result)) return
    expect(result.grid.assignments[0].P).toBe(before.c)
    expect(result.grid.assignments[0].C).toBe(before.p)
  })

  it('brings a benched player in and sits the player they replace', () => {
    const present = mkRoster(13, 5)
    const byId = new Map(present.map((p) => [p.id, p]))
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 12 })
    const onField = new Set(Object.values(grid.assignments[0]))
    const benched = present.find((p) => !onField.has(p.id))!
    expect(benched).toBeDefined()
    // Replace somebody of the same gender, so the counting rules cannot be
    // what decides this test — the bench-in itself is what is under test.
    const slot = (Object.entries(grid.assignments[0]) as [Position, string][]).find(
      ([, id]) => byId.get(id)!.isFemale === benched.isFemale,
    )!
    expect(slot).toBeDefined()
    const displaced = slot[1]

    const result = assignToCell(grid, present, { inning: 1, position: slot[0] }, benched.id)
    expect(result).not.toHaveProperty('error')
    if (!('grid' in result)) return
    expect(result.grid.assignments[0][slot[0]]).toBe(benched.id)
    // The player they replaced is on the bench, not hiding at another position.
    expect(Object.values(result.grid.assignments[0])).not.toContain(displaced)
    // Every other inning is untouched.
    expect(JSON.stringify(result.grid.assignments.slice(1))).toBe(
      JSON.stringify(grid.assignments.slice(1)),
    )
  })

  it('is a no-op when the player already has that cell', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 13 })
    const pitcher = grid.assignments[0].P!
    const result = assignToCell(grid, present, { inning: 1, position: 'P' }, pitcher)
    expect(result).not.toHaveProperty('error')
    if (!('grid' in result)) return
    expect(JSON.stringify(result.grid.assignments)).toBe(JSON.stringify(grid.assignments))
  })

  it('refuses a bench replacement that would break the female minimum', () => {
    // 10 men, 3 women. Every inning fields 10 — necessarily all 3 women and 7
    // men — so the bench is three men and swapping any of them in for a woman
    // leaves the field a woman short.
    const present = [
      ...Array.from({ length: 10 }, (_, i) => mkPlayer(`m${i}`)),
      ...Array.from({ length: 3 }, (_, i) => mkPlayer(`f${i}`, { isFemale: true })),
    ]
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 14 })
    const onField = new Set(Object.values(grid.assignments[0]))
    const benchedMan = present.find((p) => !p.isFemale && !onField.has(p.id))!
    const womanSlot = (Object.entries(grid.assignments[0]) as [Position, string][]).find(
      ([, id]) => id.startsWith('f'),
    )!

    const result = assignToCell(
      grid,
      present,
      { inning: 1, position: womanSlot[0] },
      benchedMan.id,
    )
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error).toBe(
      'That would leave only 2 women on the field, and 3 are required (inning 1)',
    )
  })

  it('refuses a bench replacement that would put an eighth M/X player on the field', () => {
    // 2 women, 9 men. The M/X cap holds the defence to 9, which is 2 women and
    // 7 men, so the cap is saturated and a benched man taking a woman's spot
    // would make it 8.
    //
    // The reported reason is the female minimum, and that is not a bug: with
    // these rule numbers a bench-in can never break the cap ALONE. Saturating
    // the cap means the field holds exactly `size - 7` women, and `size` is
    // itself `min(10, present, women + 7)`, which makes `size - 7` exactly the
    // required number of women. So the woman leaving always takes the minimum
    // with her, and `checkInning` reports the counting rule the captain can act
    // on first.
    const present = [
      ...Array.from({ length: 9 }, (_, i) => mkPlayer(`m${i}`)),
      ...Array.from({ length: 2 }, (_, i) => mkPlayer(`f${i}`, { isFemale: true })),
    ]
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 15 })
    const inning1 = grid.assignments[0]
    expect(Object.values(inning1)).toHaveLength(9)
    expect(Object.values(inning1).filter((id) => !id.startsWith('f'))).toHaveLength(7)

    const onField = new Set(Object.values(inning1))
    const benchedMan = present.find((p) => !p.isFemale && !onField.has(p.id))!
    const womanSlot = (Object.entries(inning1) as [Position, string][]).find(([, id]) =>
      id.startsWith('f'),
    )!

    const result = assignToCell(
      grid,
      present,
      { inning: 1, position: womanSlot[0] },
      benchedMan.id,
    )
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error).toMatch(/women|M\/X/i)
    expect(result.error).toMatch(/inning 1/)
  })

  it('refuses a player who is not available that inning', () => {
    const present = mkRoster(13, 5)
    // p12 is male and turns up in the fifth, so he cannot be fielding in the
    // first and is never a legal choice there.
    present[12] = { ...present[12], arrivedInning: 5 }
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 16 })
    const result = assignToCell(grid, present, { inning: 1, position: 'P' }, 'p12')
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not available in inning 1/)
  })

  it('refuses a player who is not on tonight’s roster', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 17 })
    const result = assignToCell(grid, present, { inning: 1, position: 'P' }, 'ghost')
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not marked present/)
  })

  it('reports a position nobody is playing rather than growing the defence', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 18 })
    const copy = { ...grid, assignments: grid.assignments.map((a) => ({ ...a })) }
    delete copy.assignments[0].P
    const onField = new Set(Object.values(copy.assignments[0]))
    const benched = present.find((p) => !onField.has(p.id))!
    const result = assignToCell(copy, present, { inning: 1, position: 'P' }, benched.id)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/Nobody is playing P in inning 1/)
  })

  it('does not mutate the original grid, on success or on refusal', () => {
    const present = mkRoster(13, 5)
    const byId = new Map(present.map((p) => [p.id, p]))
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 19 })
    const snapshot = JSON.stringify(grid.assignments)
    const onField = new Set(Object.values(grid.assignments[0]))
    const benched = present.find((p) => !onField.has(p.id))!
    const slot = (Object.entries(grid.assignments[0]) as [Position, string][]).find(
      ([, id]) => byId.get(id)!.isFemale === benched.isFemale,
    )!

    assignToCell(grid, present, { inning: 1, position: slot[0] }, benched.id)
    assignToCell(grid, present, { inning: 1, position: slot[0] }, 'ghost')
    expect(JSON.stringify(grid.assignments)).toBe(snapshot)
  })
})
