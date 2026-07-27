import { describe, it, expect } from 'vitest'
import { makeRng } from './rng'

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('differs across seeds', () => {
    const r1 = makeRng(1)
    const r2 = makeRng(2)
    const a = Array.from({ length: 20 }, () => r1.next())
    const b = Array.from({ length: 20 }, () => r2.next())
    expect(a).not.toEqual(b)
    // The sequence must not collapse to a constant.
    expect(new Set(a).size).toBeGreaterThan(1)
  })

  it('produces floats in [0, 1)', () => {
    const r = makeRng(7)
    for (let i = 0; i < 1000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int(n) stays in range', () => {
    const r = makeRng(9)
    for (let i = 0; i < 1000; i++) {
      const v = r.int(5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(5)
    }
  })

  it('shuffle keeps every element and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const copy = [...input]
    const out = makeRng(3).shuffle(input)
    expect(input).toEqual(copy)
    expect([...out].sort((x, y) => x - y)).toEqual(copy)
  })
})
