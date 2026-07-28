import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./actions', () => ({
  newGame: vi.fn(async () => ({ error: 'Innings must be a whole number from 1 to 9.' })),
}))

import { NewGameForm } from './NewGameForm'
import { newGame } from './actions'

describe('NewGameForm', () => {
  it('preloads the server-computed date and caps innings at 9', () => {
    render(<NewGameForm defaultDate="2026-07-27" defaultInnings={7} />)
    expect(screen.getByLabelText('Date')).toHaveProperty('value', '2026-07-27')
    const innings = screen.getByLabelText('Innings')
    expect(innings).toHaveProperty('value', '7')
    expect(innings).toHaveProperty('max', '9')
  })

  it('renders the validation error the action returns, in place', async () => {
    render(<NewGameForm defaultDate="2026-07-27" defaultInnings={7} />)

    await userEvent.click(screen.getByRole('button', { name: 'Create game' }))

    expect(vi.mocked(newGame)).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Innings must be a whole number from 1 to 9.',
    )
  })
})
