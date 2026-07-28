import { describe, it, expect } from 'vitest'
import { validateRoster } from './validateRoster'
import { mkPlayer, mkRoster } from './fixtures'

describe('validateRoster', () => {
  it('fields 10 with 3 or more women', () => {
    const s = validateRoster(mkRoster(12, 4))
    expect(s.maxFielders).toBe(10)
    expect(s.activePositions).toHaveLength(10)
    expect(s.requiredFemalesOnField).toBe(3)
    expect(s.isDefault).toBe(false)
    expect(s.blockers).toEqual([])
  })

  it('fields only 9 with exactly 2 women, dropping ROVER', () => {
    const s = validateRoster(mkRoster(12, 2))
    expect(s.maxFielders).toBe(9)
    expect(s.activePositions).not.toContain('ROVER')
    expect(s.activePositions).toContain('RF')
    expect(s.activePositions).toHaveLength(9)
    expect(s.requiredFemalesOnField).toBe(2)
    expect(s.isDefault).toBe(false)
    expect(s.warnings.join(' ')).toMatch(/9/)
  })

  it('fields only 8 with exactly 1 woman, dropping ROVER and RF', () => {
    const s = validateRoster(mkRoster(12, 1))
    expect(s.maxFielders).toBe(8)
    expect(s.activePositions).not.toContain('ROVER')
    expect(s.activePositions).not.toContain('RF')
    expect(s.activePositions).toHaveLength(8)
  })

  it('blocks below 7 players', () => {
    const s = validateRoster(mkRoster(6, 3))
    expect(s.isDefault).toBe(true)
    expect(s.blockers.join(' ')).toMatch(/6 players/)
  })

  it('blocks below 2 female players', () => {
    const s = validateRoster(mkRoster(10, 1))
    expect(s.isDefault).toBe(true)
    expect(s.blockers.join(' ')).toMatch(/female/i)
  })

  it('allows exactly the league minimum: 7 players, 2 female', () => {
    const s = validateRoster(mkRoster(7, 2))
    expect(s.isDefault).toBe(false)
    expect(s.blockers).toEqual([])
    expect(s.maxFielders).toBe(7)
  })

  it('never fields more players than are present', () => {
    const s = validateRoster(mkRoster(8, 4))
    expect(s.maxFielders).toBe(8)
  })

  it('reports the female spots the batting order needs', () => {
    expect(validateRoster(mkRoster(13, 4)).femaleSpots).toBe(4)
    expect(validateRoster(mkRoster(10, 3)).femaleSpots).toBe(3)
  })

  it('warns when a sub will be forced onto the field', () => {
    // 12 roster players but only 2 of them female, plus 1 female sub.
    const roster = Array.from({ length: 12 }, (_, i) =>
      mkPlayer(`r${i}`, { isFemale: i < 2 }),
    )
    const sub = mkPlayer('sub1', { isFemale: true, isSub: true })
    const s = validateRoster([...roster, sub])
    expect(s.maxFielders).toBe(10)
    expect(s.requiredFemalesOnField).toBe(3)
    expect(s.warnings.join(' ')).toMatch(/sub/i)
  })

  it('always yields exactly as many active positions as it can field', () => {
    for (let n = 7; n <= 15; n++) {
      for (let f = 2; f <= Math.min(n, 6); f++) {
        const s = validateRoster(mkRoster(n, f))
        expect(s.activePositions.length, `n=${n} f=${f}`).toBe(s.maxFielders)
      }
    }
  })

  it('drops three positions at the 7-player league minimum', () => {
    const s = validateRoster(mkRoster(7, 2))
    expect(s.maxFielders).toBe(7)
    expect(s.activePositions).toHaveLength(7)
    expect(s.activePositions).not.toContain('ROVER')
    expect(s.activePositions).not.toContain('RF')
    expect(s.activePositions).not.toContain('LF')
    expect(s.activePositions).toContain('P')
    expect(s.activePositions).toContain('C')
  })

  it('warns, by name, when inverted From/To innings leave a player with zero availability', () => {
    // From inning 5 / To inning 2: they bat all game but are filtered out of
    // every inning by isAvailable, so they silently field nothing.
    const present = mkRoster(13, 5)
    present[3] = { ...present[3], arrivedInning: 5, leftInning: 2 }
    const s = validateRoster(present)
    expect(s.blockers).toEqual([])
    const zeroAvailability = s.warnings.filter((w) => w.includes('p3'))
    expect(zeroAvailability).toHaveLength(1)
    expect(zeroAvailability[0]).toMatch(/never field/i)
  })

  it('does not warn about zero availability for normal From/To innings', () => {
    const present = mkRoster(13, 5)
    present[3] = { ...present[3], arrivedInning: 2, leftInning: 5 }
    const s = validateRoster(present)
    expect(s.warnings.filter((w) => /never field/i.test(w))).toEqual([])
  })

  it('surfaces both shortfall warnings when both conditions hold', () => {
    // 8 present, only 3 of them roster players, and only 1 roster female.
    const roster = [
      mkPlayer('r0', { isFemale: true }),
      mkPlayer('r1'),
      mkPlayer('r2'),
    ]
    const subs = Array.from({ length: 5 }, (_, i) =>
      mkPlayer(`s${i}`, { isSub: true, isFemale: i < 2 }),
    )
    const s = validateRoster([...roster, ...subs])
    expect(s.warnings.filter((w) => /roster players/.test(w))).toHaveLength(1)
    expect(s.warnings.filter((w) => /female roster player/.test(w))).toHaveLength(1)
  })
})
