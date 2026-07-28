import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/roster/actions', () => ({
  saveFullPlayer: vi.fn(async () => undefined),
}))

import { PlayerCard } from './PlayerCard'
import { saveFullPlayer } from '@/app/roster/actions'
import type { Player } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const existing: Player = {
  id: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
  name: 'Dana',
  isFemale: true,
  isSub: false,
  isActive: true,
  positions: { SS: 'primary' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

async function submitNewPlayer(name: string) {
  await userEvent.type(screen.getByLabelText('Name'), name)
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('PlayerCard saving', () => {
  it('saves a new player through a single action call carrying id and positions', async () => {
    render(<PlayerCard />)
    // One tap cycles the chip from not-selected to backup.
    await userEvent.click(screen.getByRole('button', { name: 'SS, not selected' }))
    await submitNewPlayer('Alex')

    expect(saveFullPlayer).toHaveBeenCalledOnce()
    const [formData, positions] = vi.mocked(saveFullPlayer).mock.calls[0]
    expect(formData.get('name')).toBe('Alex')
    expect(String(formData.get('id'))).toMatch(UUID)
    expect(positions).toEqual({ SS: 'backup' })
  })

  it('sends the existing id when editing', async () => {
    render(<PlayerCard player={existing} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const [formData, positions] = vi.mocked(saveFullPlayer).mock.calls[0]
    expect(formData.get('id')).toBe(existing.id)
    expect(positions).toEqual({ SS: 'primary' })
  })

  /**
   * The idempotency story: a save that died on diamond wifi may have already
   * committed server-side, so the retry must carry the SAME id — the upsert
   * then converges on the one row instead of minting a duplicate who would
   * default to present at every game.
   */
  it('retries a failed new-player save with the same id', async () => {
    vi.mocked(saveFullPlayer).mockRejectedValueOnce(new Error('network died'))
    render(<PlayerCard />)
    await submitNewPlayer('Alex')

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'network died')

    // React 19 resets uncontrolled fields once a form action completes, so
    // the retry types the name again — the id must NOT depend on field state.
    await submitNewPlayer('Alex')

    const calls = vi.mocked(saveFullPlayer).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][0].get('id')).toBe(calls[0][0].get('id'))
  })

  it('uses a fresh id for the next new player after a successful save', async () => {
    render(<PlayerCard />)
    await submitNewPlayer('Alex')
    await submitNewPlayer('Sam')

    const calls = vi.mocked(saveFullPlayer).mock.calls
    expect(calls).toHaveLength(2)
    expect(String(calls[1][0].get('id'))).toMatch(UUID)
    expect(calls[1][0].get('id')).not.toBe(calls[0][0].get('id'))
  })
})
