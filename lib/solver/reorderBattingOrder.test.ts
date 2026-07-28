import { describe, it, expect } from 'vitest'
import { legalReorderTargets, reorderBattingOrder } from './reorderBattingOrder'
import { buildBattingOrder } from './buildBattingOrder'
import { isValidGenderPattern, type Gender } from './genderPattern'
import { mkPlayer, mkRoster } from './fixtures'
import type { BattingOrder, PresentPlayer } from '@/lib/types'

/** Hand-build an order whose slots are exactly the given player ids in the
 * given gender sequence, bypassing the solver so tests control the layout. */
function mkOrder(ids: string[], present: PresentPlayer[]): BattingOrder {
  const byId = new Map(present.map((p) => [p.id, p]))
  return {
    slots: ids.map((id) =>
      id === 'OUT' ? { kind: 'autoOut' as const } : { kind: 'player' as const, playerId: id },
    ),
    pattern: ids.map((id) => (id === 'OUT' || byId.get(id)!.isFemale ? 'F' : 'M')),
    warnings: [],
  }
}

function idsOf(order: BattingOrder): string[] {
  return order.slots.map((s) => (s.kind === 'player' ? s.playerId : 'OUT'))
}

function gendersOf(order: BattingOrder, present: PresentPlayer[]): Gender[] {
  const byId = new Map(present.map((p) => [p.id, p]))
  return order.slots.map((s, i) =>
    s.kind === 'autoOut' ? 'F' : byId.get(s.playerId) ? (byId.get(s.playerId)!.isFemale ? 'F' : 'M') : order.pattern[i],
  )
}

/** 7 men A..G and 3 women F1..F3, so tests read as people, not indices. */
function namedRoster(): PresentPlayer[] {
  return [
    ...['A', 'B', 'C', 'D', 'E', 'G', 'H'].map((id) => mkPlayer(id)),
    ...['F1', 'F2', 'F3'].map((id) => mkPlayer(id, { isFemale: true })),
  ]
}

describe('reorderBattingOrder', () => {
  it('performs a directly legal move as a plain insertion, nobody else shifts', () => {
    const present = namedRoster()
    // MMMFMMFMMF — the one allowed run of three sits at the top.
    const order = mkOrder(['A', 'B', 'C', 'F1', 'D', 'E', 'F2', 'G', 'H', 'F3'], present)
    // Dragging E one slot right swaps him past F2: M M M F M F M M... wait —
    // remove E (idx 5), insert at 6: A B C F1 D F2 E G H F3 → MMMFMFMMMF has
    // a second run of three. Use a genuinely direct-legal move instead:
    // drag H (idx 8) to idx 7: A B C F1 D E F2 H G F3 — same gender sequence.
    const result = reorderBattingOrder(order, present, 8, 7)
    if ('error' in result) throw new Error(result.error)
    expect(idsOf(result.order)).toEqual(['A', 'B', 'C', 'F1', 'D', 'E', 'F2', 'H', 'G', 'F3'])
    expect(result.repaired).toBe(false)
    // The input was not mutated.
    expect(idsOf(order)).toEqual(['A', 'B', 'C', 'F1', 'D', 'E', 'F2', 'G', 'H', 'F3'])
  })

  it('auto-fills the women to the nearest legal slots when the raw move is illegal', () => {
    const present = namedRoster()
    const order = mkOrder(['A', 'B', 'C', 'F1', 'D', 'E', 'F2', 'G', 'H', 'F3'], present)
    // Drag H (idx 8) to idx 4. Raw result A B C F1 H D E F2 G F3 is
    // M M M F M M M F M F — two runs of three, illegal. The cheapest legal
    // pattern with a man at idx 4 moves exactly one woman one slot:
    // F slots {3,6,9}, i.e. F2 steps from idx 7 to idx 6. Men keep their
    // relative order around the pinned H.
    const result = reorderBattingOrder(order, present, 8, 4)
    if ('error' in result) throw new Error(result.error)
    expect(result.repaired).toBe(true)
    expect(idsOf(result.order)).toEqual(['A', 'B', 'C', 'F1', 'H', 'D', 'F2', 'E', 'G', 'F3'])
    expect(result.order.pattern).toEqual(gendersOf(result.order, present))
    expect(isValidGenderPattern(result.order.pattern)).toBe(true)
  })

  it('keeps the dragged player exactly at the drop slot when repairing', () => {
    const present = namedRoster()
    const order = mkOrder(['A', 'B', 'C', 'F1', 'D', 'E', 'F2', 'G', 'H', 'F3'], present)
    const result = reorderBattingOrder(order, present, 8, 4)
    if ('error' in result) throw new Error(result.error)
    expect(idsOf(result.order)[4]).toBe('H')
  })

  it('refuses a drop no legal pattern can host, leaving the order untouched', () => {
    // Two women: the third female slot is an automatic out, and the last slot
    // of the order is always the third female slot in any pattern that has an
    // F there — so a woman dropped at the very end would sit on the auto-out.
    const present = [
      ...['A', 'B', 'C', 'D', 'E'].map((id) => mkPlayer(id)),
      mkPlayer('F1', { isFemale: true }),
      mkPlayer('F2', { isFemale: true }),
    ]
    const order = buildBattingOrder({ present, history: [], seed: 1 })
    const from = order.slots.findIndex((s) => s.kind === 'player' && s.playerId === 'F1')
    const before = idsOf(order)
    const result = reorderBattingOrder(order, present, from, order.slots.length - 1)
    expect('error' in result).toBe(true)
    expect(idsOf(order)).toEqual(before)
  })

  it('re-derives the automatic out onto every 3rd female slot after a repair', () => {
    const present = [
      ...['A', 'B', 'C', 'D', 'E'].map((id) => mkPlayer(id)),
      mkPlayer('F1', { isFemale: true }),
      mkPlayer('F2', { isFemale: true }),
    ]
    const order = buildBattingOrder({ present, history: [], seed: 1 })
    const targets = legalReorderTargets(order, present, 0)
    for (const to of targets) {
      const result = reorderBattingOrder(order, present, 0, to)
      if ('error' in result) throw new Error(`target ${to} was declared legal`)
      let femaleOrdinal = 0
      result.order.pattern.forEach((g, i) => {
        if (g !== 'F') return
        femaleOrdinal++
        const isOut = result.order.slots[i].kind === 'autoOut'
        expect(isOut).toBe(femaleOrdinal % 3 === 0)
      })
    }
  })

  it('refuses to drag an automatic-out row', () => {
    const present = [
      ...['A', 'B', 'C', 'D', 'E'].map((id) => mkPlayer(id)),
      mkPlayer('F1', { isFemale: true }),
      mkPlayer('F2', { isFemale: true }),
    ]
    const order = buildBattingOrder({ present, history: [], seed: 1 })
    const outIndex = order.slots.findIndex((s) => s.kind === 'autoOut')
    const result = reorderBattingOrder(order, present, outIndex, 0)
    expect('error' in result).toBe(true)
  })

  it('treats dropping a row back where it started as a no-op', () => {
    const present = namedRoster()
    const order = mkOrder(['A', 'B', 'C', 'F1', 'D', 'E', 'F2', 'G', 'H', 'F3'], present)
    const result = reorderBattingOrder(order, present, 4, 4)
    if ('error' in result) throw new Error(result.error)
    expect(idsOf(result.order)).toEqual(idsOf(order))
    expect(result.repaired).toBe(false)
  })

  it('never seats the same player in adjacent slots, including the wrap', () => {
    // 3 women vs 10 men forces 5 female slots, so two women bat twice.
    const present = mkRoster(13, 3)
    const order = buildBattingOrder({ present, history: [], seed: 3 })
    for (let from = 0; from < order.slots.length; from++) {
      if (order.slots[from].kind !== 'player') continue
      for (let to = 0; to < order.slots.length; to++) {
        const result = reorderBattingOrder(order, present, from, to)
        if ('error' in result) continue
        const ids = idsOf(result.order)
        for (let i = 0; i < ids.length; i++) {
          const next = ids[(i + 1) % ids.length]
          if (ids[i] !== 'OUT') expect(ids[i]).not.toBe(next)
        }
      }
    }
  })

  it('holds its invariants across every drag on a spread of rosters', () => {
    const rosters = [
      mkRoster(10, 4),
      mkRoster(12, 5),
      mkRoster(13, 3),
      mkRoster(7, 2),
      namedRoster(),
    ]
    for (const present of rosters) {
      const order = buildBattingOrder({ present, history: [], seed: 7 })
      const n = order.slots.length
      for (let from = 0; from < n; from++) {
        const targets = legalReorderTargets(order, present, from)
        for (let to = 0; to < n; to++) {
          const result = reorderBattingOrder(order, present, from, to)
          if (order.slots[from].kind !== 'player') {
            expect('error' in result).toBe(true)
            continue
          }
          // The precomputed target set must agree with the real outcome.
          expect(targets.has(to)).toBe(!('error' in result))
          if ('error' in result) continue
          // Composition preserved: same multiset of slots.
          expect([...idsOf(result.order)].sort()).toEqual([...idsOf(order)].sort())
          // Pattern matches the people sitting in it and stays legal.
          expect(result.order.pattern).toEqual(gendersOf(result.order, present))
          expect(isValidGenderPattern(result.order.pattern)).toBe(true)
          // The dragged slot landed where it was dropped.
          expect(idsOf(result.order)[to]).toBe(idsOf(order)[from])
          // Deterministic.
          const again = reorderBattingOrder(order, present, from, to)
          expect(again).toEqual(result)
        }
      }
    }
  })

  it('lets a degraded single-gender order be reordered freely', () => {
    // buildBattingOrder declares the pattern rules inapplicable for these
    // rosters; the reorder engine must not re-impose them (review finding:
    // every drop refused with a factually wrong rules message).
    for (const present of [mkRoster(8, 0), mkRoster(6, 6)]) {
      const order = buildBattingOrder({ present, history: [], seed: 1 })
      const n = order.slots.length
      expect(legalReorderTargets(order, present, 0).size).toBe(n)
      const result = reorderBattingOrder(order, present, 0, n - 1)
      if ('error' in result) throw new Error(result.error)
      expect(idsOf(result.order)[n - 1]).toBe(idsOf(order)[0])
      expect(result.repaired).toBe(false)
    }
  })

  it('repairs drags on rosters whose padded slot count breaks the old C(n,f) gate', () => {
    // 17 men + 3 women pads to 25 slots / 8 female spots — C(25,8) exceeds
    // the old one-million gate, which silently refused repairable drags
    // (review finding). The pruned walk must both allow them and stay fast.
    const present = mkRoster(20, 3)
    const order = buildBattingOrder({ present, history: [], seed: 2 })
    expect(order.slots.length).toBe(25)
    const started = performance.now()
    const targets = legalReorderTargets(order, present, 0)
    expect(performance.now() - started).toBeLessThan(1500) // cold walk, CI-lenient
    expect(targets.size).toBeGreaterThan(order.slots.length / 2)
    const to = [...targets].find((t) => t !== 0)!
    const result = reorderBattingOrder(order, present, 0, to)
    if ('error' in result) throw new Error(result.error)
    expect(isValidGenderPattern(result.order.pattern)).toBe(true)
  })

  it('stays interactive at the largest reachable shape (22 players, 2 women)', () => {
    // 20 men + 2 women pads to 30 slots — C(30,10) is thirty million, which
    // the old filter walk could never have survived. Pruned, it is trivial.
    const present = mkRoster(22, 2)
    const order = buildBattingOrder({ present, history: [], seed: 4 })
    const started = performance.now()
    const targets = legalReorderTargets(order, present, 1)
    expect(performance.now() - started).toBeLessThan(1500)
    expect(targets.size).toBeGreaterThan(0)
  })

  it('preserves construction warnings on the reordered order', () => {
    const present = mkRoster(7, 2)
    const order = buildBattingOrder({ present, history: [], seed: 1 })
    expect(order.warnings.length).toBeGreaterThan(0)
    const from = order.slots.findIndex((s) => s.kind === 'player')
    const targets = legalReorderTargets(order, present, from)
    const to = [...targets].find((t) => t !== from)
    if (to === undefined) return
    const result = reorderBattingOrder(order, present, from, to)
    if ('error' in result) throw new Error(result.error)
    expect(result.order.warnings).toEqual(order.warnings)
  })
})
