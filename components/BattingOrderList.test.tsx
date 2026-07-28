import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { BattingOrderList } from './BattingOrderList'
import { mkPlayer } from '@/lib/solver/fixtures'
import type { BattingOrder } from '@/lib/types'

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
})
