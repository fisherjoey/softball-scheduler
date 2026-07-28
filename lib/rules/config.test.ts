import { describe, it, expect } from 'vitest'
import { WEIGHTS } from './config'

describe('fairness weight ladder', () => {
  // The 1000/100/8/3 ladder is a settled decision (Joey, 2026-07-27): each
  // rung has to dominate the ones below it so that covering a position beats
  // evening the bench, evening the bench beats resting a sub, and resting a
  // sub beats position variety. Pinning the numbers means a silent revert —
  // a refactor "tidying" the constants, say — fails the suite instead of
  // quietly reordering the solver's priorities.
  it('pins the settled 1000/100/8/3 numbers', () => {
    expect(WEIGHTS.eligibilityRelaxed).toBe(1000)
    expect(WEIGHTS.equalInnings).toBe(100)
    expect(WEIGHTS.subOnField).toBe(8)
    expect(WEIGHTS.positionRepeat).toBe(3)
  })
})
