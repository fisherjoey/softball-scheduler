import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { BattingOrderList } from './BattingOrderList'
import { mkPlayer } from '@/lib/solver/fixtures'
import type { BattingOrder } from '@/lib/types'

/** Give every row real geometry — jsdom reports all rects as zero, and the
 * drag math is nothing but rect arithmetic. Rows sit at 52px pitch, 44 tall. */
function stubRowRects() {
  screen.getAllByRole('listitem').forEach((row, i) => {
    row.getBoundingClientRect = () =>
      ({ top: i * 52, bottom: i * 52 + 44, height: 44, left: 0, right: 300, width: 300, x: 0, y: i * 52 }) as DOMRect
  })
}

/** A 4-row order with a mouse-drag helper: press row `from`, cross the slop,
 * glide to row `to`'s midpoint, release. */
function dragWithMouse(from: number, toMidY: number) {
  const rows = screen.getAllByRole('listitem')
  fireEvent.pointerDown(rows[from], { pointerType: 'mouse', button: 0, clientY: from * 52 + 22 })
  fireEvent.pointerMove(rows[from], { pointerType: 'mouse', clientY: from * 52 + 40 })
  fireEvent.pointerMove(rows[from], { pointerType: 'mouse', clientY: toMidY })
  fireEvent.pointerUp(rows[from])
}

function fourRowOrder(): { order: BattingOrder; roster: ReturnType<typeof mkPlayer>[] } {
  const roster = [
    mkPlayer('a', { name: 'Alice', isFemale: true }),
    mkPlayer('b', { name: 'Bob' }),
    mkPlayer('c', { name: 'Cam' }),
    mkPlayer('d', { name: 'Dana', isFemale: true }),
  ]
  const order: BattingOrder = {
    slots: roster.map((p) => ({ kind: 'player' as const, playerId: p.id })),
    pattern: ['F', 'M', 'M', 'F'],
    warnings: [],
  }
  return { order, roster }
}

describe('BattingOrderList', () => {
  it('badges only the rows whose player is no longer marked present', () => {
    // Mid-game the order is deliberately kept when somebody leaves — changing
    // it is an out — so the departed player's row is the only place that can
    // say the slot is now dead.
    const order: BattingOrder = {
      slots: [
        { kind: 'player', playerId: 'a' },
        { kind: 'player', playerId: 'gone' },
        { kind: 'player', playerId: 'c' },
      ],
      pattern: ['M', 'M', 'F'],
      warnings: [],
    }
    const roster = [
      mkPlayer('a', { name: 'Alice' }),
      mkPlayer('gone', { name: 'Departed Dan' }),
      mkPlayer('c', { name: 'Carol', isFemale: true }),
    ]
    const present = [roster[0], roster[2]]

    render(<BattingOrderList order={order} present={present} roster={roster} />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('Not here')).toBeDefined()
    expect(within(rows[0]).queryByText('Not here')).toBeNull()
    expect(within(rows[2]).queryByText('Not here')).toBeNull()
  })

  it('does not badge an automatic out — there is nobody to be absent', () => {
    const order: BattingOrder = {
      slots: [{ kind: 'player', playerId: 'a' }, { kind: 'autoOut' }],
      pattern: ['M', 'F'],
      warnings: [],
    }
    const roster = [mkPlayer('a', { name: 'Alice' })]

    render(<BattingOrderList order={order} present={roster} roster={roster} />)

    expect(screen.queryByText('Not here')).toBeNull()
    expect(screen.getByText('Automatic out')).toBeDefined()
  })

  it('reports a mouse drag as onReorder(from, to)', () => {
    const { order, roster } = fourRowOrder()
    const onReorder = vi.fn()
    render(
      <BattingOrderList
        order={order}
        present={roster}
        roster={roster}
        onReorder={onReorder}
        legalTargetsFor={() => new Set([0, 1, 2, 3])}
      />,
    )
    stubRowRects()
    // Lift Bob (row 1) and carry him below Cam's midpoint: drop index 2.
    // The lift grabs the row at pointer 92 (offset 40 into the row), so the
    // row's midpoint trails the pointer by 18px — 150 puts it past Cam's 126.
    dragWithMouse(1, 150)
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(1, 2)
  })

  it('renders the refusal reason when the drop is rejected', () => {
    const { order, roster } = fourRowOrder()
    render(
      <BattingOrderList
        order={order}
        present={roster}
        roster={roster}
        onReorder={() => ({ error: 'No legal batting order puts a man in that slot.' })}
        legalTargetsFor={() => new Set()}
      />,
    )
    stubRowRects()
    dragWithMouse(1, 150)
    expect(screen.getByText(/no legal batting order/i)).toBeDefined()
  })

  it('never lifts an automatic-out row', () => {
    const roster = [mkPlayer('a', { name: 'Alice', isFemale: true }), mkPlayer('b', { name: 'Bob' })]
    const order: BattingOrder = {
      slots: [{ kind: 'player', playerId: 'a' }, { kind: 'autoOut' }, { kind: 'player', playerId: 'b' }],
      pattern: ['F', 'F', 'M'],
      warnings: [],
    }
    const onReorder = vi.fn()
    render(
      <BattingOrderList
        order={order}
        present={roster}
        roster={roster}
        onReorder={onReorder}
        legalTargetsFor={() => new Set([0, 1, 2])}
      />,
    )
    stubRowRects()
    dragWithMouse(1, 10)
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('treats a touch that moves before the long press as a scroll, not a drag', () => {
    const { order, roster } = fourRowOrder()
    const onReorder = vi.fn()
    render(
      <BattingOrderList
        order={order}
        present={roster}
        roster={roster}
        onReorder={onReorder}
        legalTargetsFor={() => new Set([0, 1, 2, 3])}
      />,
    )
    stubRowRects()
    const rows = screen.getAllByRole('listitem')
    fireEvent.pointerDown(rows[1], { pointerType: 'touch', clientY: 74 })
    fireEvent.pointerMove(rows[1], { pointerType: 'touch', clientY: 120 })
    fireEvent.pointerUp(rows[1])
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('ignores a second pointer: a stray tap can neither steal nor commit a drag', () => {
    const { order, roster } = fourRowOrder()
    const onReorder = vi.fn()
    render(
      <BattingOrderList
        order={order}
        present={roster}
        roster={roster}
        onReorder={onReorder}
        legalTargetsFor={() => new Set([0, 1, 2, 3])}
      />,
    )
    stubRowRects()
    const rows = screen.getAllByRole('listitem')
    // Mouse (pointerId 1) lifts Bob and carries him toward slot 2…
    fireEvent.pointerDown(rows[1], { pointerType: 'mouse', button: 0, pointerId: 1, clientY: 74 })
    fireEvent.pointerMove(rows[1], { pointerType: 'mouse', pointerId: 1, clientY: 92 })
    fireEvent.pointerMove(rows[1], { pointerType: 'mouse', pointerId: 1, clientY: 150 })
    // …while a stray touch (pointerId 2) taps another row and lifts.
    fireEvent.pointerDown(rows[3], { pointerType: 'touch', pointerId: 2, clientY: 178 })
    fireEvent.pointerUp(rows[3], { pointerId: 2 })
    expect(onReorder).not.toHaveBeenCalled()
    // A bystander's pointercancel (palm rejection) must not kill the drag…
    fireEvent.pointerCancel(rows[3], { pointerId: 2 })
    // …because the real release still commits the real move.
    fireEvent.pointerUp(rows[1], { pointerId: 1 })
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(1, 2)
  })

  it('aborts a lifted drag when the order changes underneath it', () => {
    const { order, roster } = fourRowOrder()
    const onReorder = vi.fn()
    const { rerender } = render(
      <BattingOrderList
        order={order}
        present={roster}
        roster={roster}
        onReorder={onReorder}
        legalTargetsFor={() => new Set([0, 1, 2, 3])}
      />,
    )
    stubRowRects()
    const rows = screen.getAllByRole('listitem')
    fireEvent.pointerDown(rows[1], { pointerType: 'mouse', button: 0, clientY: 74 })
    fireEvent.pointerMove(rows[1], { pointerType: 'mouse', clientY: 92 })
    // A reshuffle lands mid-drag: same players, new arrangement object.
    const reshuffled: BattingOrder = {
      ...order,
      slots: [...order.slots].reverse(),
      pattern: [...order.pattern].reverse(),
    }
    rerender(
      <BattingOrderList
        order={reshuffled}
        present={roster}
        roster={roster}
        onReorder={onReorder}
        legalTargetsFor={() => new Set([0, 1, 2, 3])}
      />,
    )
    // The release must not commit lift-time indices against the new order.
    fireEvent.pointerUp(screen.getAllByRole('listitem')[1])
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('stays inert without onReorder — the read-only rendering is unchanged', () => {
    const { order, roster } = fourRowOrder()
    render(<BattingOrderList order={order} present={roster} roster={roster} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0].getAttribute('aria-roledescription')).toBeNull()
    expect(rows[0].className).not.toContain('cursor-grab')
  })
})
