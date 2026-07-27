import { describe, it, expect } from 'vitest'
import { validateRoster } from './validateRoster'
import { POSITIONS, type PresentPlayer, type Position, type Tier } from '@/lib/types'

/** Build a present player. Defaults to eligible for every position, primary. */
export function mkPlayer(
  id: string,
  opts: Partial<Omit<PresentPlayer, 'id'>> = {},
): PresentPlayer {
  const positions =
    opts.positions ??
    (Object.fromEntries(POSITIONS.map((p) => [p, 'primary' as Tier])) as Partial<
      Record<Position, Tier>
    >)
  return {
    id,
    name: opts.name ?? id,
    isFemale: opts.isFemale ?? false,
    isSub: opts.isSub ?? false,
    isActive: opts.isActive ?? true,
    positions,
    arrivedInning: opts.arrivedInning ?? 1,
    leftInning: opts.leftInning ?? null,
  }
}

/** n players, the first `females` of them female, the last `subs` of them subs. */
export function mkRoster(n: number, females: number, subs = 0): PresentPlayer[] {
  return Array.from({ length: n }, (_, i) =>
    mkPlayer(`p${i}`, { isFemale: i < females, isSub: i >= n - subs }),
  )
}

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
})
