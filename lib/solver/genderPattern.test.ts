import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { circularRuns, isValidGenderPattern, enumerateGenderPatterns } from './genderPattern'
import { femaleSpotsRequired } from '@/lib/rules/femaleSpots'
import { makeRng } from './rng'

const parse = (s: string) => s.split('') as ('F' | 'M')[]

describe('circularRuns', () => {
  it('wraps from the bottom of the order back to the top', () => {
    // The M at the end and the M at the start are adjacent: one run of 2.
    expect(circularRuns(parse('MFFM'))).toEqual([2, 2])
  })

  it('returns a single run when every slot is the same gender', () => {
    expect(circularRuns(parse('MMMM'))).toEqual([4])
  })

  it('run lengths always sum to the order length', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<'F' | 'M'>('F', 'M'), { minLength: 1, maxLength: 24 }), (p) => {
        const total = circularRuns(p).reduce((a, b) => a + b, 0)
        return total === p.length
      }),
    )
  })
})

describe('isValidGenderPattern', () => {
  it('accepts the rulebook example for 10 players', () => {
    // P1-F-P2-P3-P4-F-P5-P6-F-P7
    expect(isValidGenderPattern(parse('MFMMMFMMFM'))).toBe(true)
  })

  it('accepts the second rulebook example for 10 players', () => {
    // P1-P2-F-P3-P4-P5-F-P6-P7-F
    expect(isValidGenderPattern(parse('MMFMMMFMMF'))).toBe(true)
  })

  it('accepts the rulebook example for 15 players', () => {
    // P1-P2-F-P3-P4-F-P5-P6-F-P7-P8-F-P9-P10-F
    expect(isValidGenderPattern(parse('MMFMMFMMFMMFMMF'))).toBe(true)
  })

  it('rejects four men in a row', () => {
    expect(isValidGenderPattern(parse('MMMMFFMFMF'))).toBe(false)
  })

  it('rejects two separate runs of three', () => {
    expect(isValidGenderPattern(parse('MMMFMMMFFF'))).toBe(false)
  })

  it('rejects a run of three created only by the wraparound', () => {
    // Reads as 2 men at the end + 1 at the start = 3, plus an existing run of 3.
    expect(isValidGenderPattern(parse('MFMMMFFFMM'))).toBe(false)
  })

  it('rejects fewer than 3 female slots in the first 10', () => {
    expect(isValidGenderPattern(parse('MMFMMFMMMMFF'))).toBe(false)
  })

  it('counts a run of three women against the one-run allowance', () => {
    expect(isValidGenderPattern(parse('FFFMMMFMFM'))).toBe(false)
  })
})

describe('enumerateGenderPatterns', () => {
  it('every returned pattern is valid and has the right female count', () => {
    for (const n of [10, 11, 12, 13, 14, 15]) {
      const f = femaleSpotsRequired(n)
      const patterns = enumerateGenderPatterns(n, f, makeRng(1))
      expect(patterns.length).toBeGreaterThan(0)
      for (const p of patterns) {
        expect(p).toHaveLength(n)
        expect(p.filter((g) => g === 'F')).toHaveLength(f)
        expect(isValidGenderPattern(p)).toBe(true)
      }
    }
  })

  it('finds a solution at every roster size from the league minimum up', () => {
    for (let n = 7; n <= 24; n++) {
      const patterns = enumerateGenderPatterns(n, femaleSpotsRequired(n), makeRng(n))
      expect(patterns.length).toBeGreaterThan(0)
    }
  })

  it('is deterministic for a given seed', () => {
    const a = enumerateGenderPatterns(13, 4, makeRng(5))
    const b = enumerateGenderPatterns(13, 4, makeRng(5))
    expect(a).toEqual(b)
  })
})
