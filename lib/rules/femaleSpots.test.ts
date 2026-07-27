import { describe, it, expect } from 'vitest'
import { femaleSpotsRequired } from './femaleSpots'

describe('femaleSpotsRequired', () => {
  // Verbatim from the CSSC rulebook batting-order chart.
  it.each([
    [10, 3],
    [11, 4],
    [12, 4],
    [13, 4],
    [14, 5],
    [15, 5],
  ])('a %i-player order needs %i female spots', (n, expected) => {
    expect(femaleSpotsRequired(n)).toBe(expected)
  })

  it('never drops below 3, even for short orders', () => {
    expect(femaleSpotsRequired(7)).toBe(3)
    expect(femaleSpotsRequired(8)).toBe(3)
    expect(femaleSpotsRequired(9)).toBe(3)
  })

  it('keeps every male run at 2 or fewer, except one run of 3', () => {
    // The formula exists to satisfy: males <= 2 * femaleSpots + 1
    for (let n = 7; n <= 30; n++) {
      const f = femaleSpotsRequired(n)
      expect(n - f).toBeLessThanOrEqual(2 * f + 1)
    }
  })
})
