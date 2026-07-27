import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RosterStatusBanner } from './RosterStatusBanner'
import { validateRoster } from '@/lib/solver/validateRoster'
import { mkRoster } from '@/lib/solver/fixtures'

describe('RosterStatusBanner', () => {
  it('shows nothing when the roster is clean', () => {
    const { container } = render(<RosterStatusBanner status={validateRoster(mkRoster(13, 5))} />)
    expect(container.textContent).toBe('')
  })

  it('shows a blocking banner below the default minimum', () => {
    render(<RosterStatusBanner status={validateRoster(mkRoster(6, 3))} />)
    expect(screen.getByRole('alert').textContent).toMatch(/default/i)
  })

  it('shows a warning when fielding fewer than 10', () => {
    render(<RosterStatusBanner status={validateRoster(mkRoster(13, 2))} />)
    expect(screen.getByRole('status').textContent).toMatch(/9/)
  })

  it('renders both regions when a blocker and a warning both hold', () => {
    // 6 present (below the 7-player default minimum: blocker) with 1 of them
    // a sub, so the 5 roster players fall short of the 6 fielded: warning.
    // The alert must not suppress the status, or vice versa.
    const status = validateRoster(mkRoster(6, 3, 1))
    expect(status.blockers.length).toBeGreaterThan(0)
    expect(status.warnings.length).toBeGreaterThan(0)

    render(<RosterStatusBanner status={status} />)
    expect(screen.getByRole('alert').textContent).toMatch(/default/i)
    expect(screen.getByRole('status').textContent).toMatch(/sub/i)
  })
})
