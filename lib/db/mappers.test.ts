import { describe, it, expect } from 'vitest'
import { toPlayer, toPresentPlayer } from './mappers'

describe('toPlayer', () => {
  it('folds position rows into a tier map', () => {
    const player = toPlayer(
      { id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true },
      [
        { playerId: 'a', position: 'SS', tier: 'primary' },
        { playerId: 'a', position: 'CF', tier: 'backup' },
      ],
    )
    expect(player.positions).toEqual({ SS: 'primary', CF: 'backup' })
    expect(player.isFemale).toBe(true)
  })

  it('ignores position rows belonging to other players', () => {
    const player = toPlayer(
      { id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true },
      [{ playerId: 'b', position: 'SS', tier: 'primary' }],
    )
    expect(player.positions).toEqual({})
  })

  it('drops unknown position strings rather than trusting the database', () => {
    const player = toPlayer(
      { id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true },
      [{ playerId: 'a', position: 'DH', tier: 'primary' }],
    )
    expect(player.positions).toEqual({})
  })
})

describe('toPresentPlayer', () => {
  it('defaults to available for the whole game', () => {
    const base = toPlayer({ id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true }, [])
    const present = toPresentPlayer(base, undefined)
    expect(present.arrivedInning).toBe(1)
    expect(present.leftInning).toBeNull()
  })

  it('carries arrival and departure innings through', () => {
    const base = toPlayer({ id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true }, [])
    const present = toPresentPlayer(base, { arrivedInning: 3, leftInning: 6 })
    expect(present.arrivedInning).toBe(3)
    expect(present.leftInning).toBe(6)
  })
})
