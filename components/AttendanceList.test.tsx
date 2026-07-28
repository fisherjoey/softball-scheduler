import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttendanceList } from './AttendanceList'
import { mkRoster } from '@/lib/solver/fixtures'

// The real module is a server action that imports the database client, which
// has no business loading in a jsdom test. Nothing here presses Save anyway.
vi.mock('@/app/games/actions', () => ({
  saveAttendance: vi.fn(async () => {}),
}))

function fromSelect(): HTMLSelectElement {
  return screen.getAllByRole('combobox', { name: /From inning/ })[0] as HTMLSelectElement
}
function toSelect(): HTMLSelectElement {
  return screen.getAllByRole('combobox', { name: /To inning/ })[0] as HTMLSelectElement
}

describe('AttendanceList arrived/left window', () => {
  it('picking a To before the current From drags From down with it', async () => {
    const user = userEvent.setup()
    render(
      <AttendanceList gameId="g1" innings={7} players={mkRoster(12, 4)} initialAttendance={[]} />,
    )

    await user.selectOptions(fromSelect(), '5')
    expect(fromSelect().value).toBe('5')

    // From 5, To 2 would mean the player left before arriving. Instead of
    // accepting the inversion silently, To wins and From follows.
    await user.selectOptions(toSelect(), '2')
    expect(toSelect().value).toBe('2')
    expect(fromSelect().value).toBe('2')
  })

  it('picking a From after the current To drags To up with it', async () => {
    const user = userEvent.setup()
    render(
      <AttendanceList gameId="g1" innings={7} players={mkRoster(12, 4)} initialAttendance={[]} />,
    )

    await user.selectOptions(toSelect(), '3')
    await user.selectOptions(fromSelect(), '5')
    expect(fromSelect().value).toBe('5')
    expect(toSelect().value).toBe('5')
  })

  it('leaves "End" alone whatever From is set to', async () => {
    const user = userEvent.setup()
    render(
      <AttendanceList gameId="g1" innings={7} players={mkRoster(12, 4)} initialAttendance={[]} />,
    )

    await user.selectOptions(fromSelect(), '6')
    expect(toSelect().value).toBe('end')
  })
})
