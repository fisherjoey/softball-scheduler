import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PositionChips } from './PositionChips'

describe('PositionChips', () => {
  it('renders a chip for every position', () => {
    render(<PositionChips value={{}} onChange={() => {}} />)
    for (const p of ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'ROVER']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${p}\\b`) })).toBeTruthy()
    }
  })

  it('cycles none to backup on first tap', async () => {
    const onChange = vi.fn()
    render(<PositionChips value={{}} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /^SS\b/ }))
    expect(onChange).toHaveBeenCalledWith({ SS: 'backup' })
  })

  it('cycles backup to primary on second tap', async () => {
    const onChange = vi.fn()
    render(<PositionChips value={{ SS: 'backup' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /^SS\b/ }))
    expect(onChange).toHaveBeenCalledWith({ SS: 'primary' })
  })

  it('cycles primary back to none on third tap', async () => {
    const onChange = vi.fn()
    render(<PositionChips value={{ SS: 'primary' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /^SS\b/ }))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('leaves other positions untouched when one changes', async () => {
    const onChange = vi.fn()
    render(<PositionChips value={{ SS: 'primary', CF: 'backup' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /^SS\b/ }))
    expect(onChange).toHaveBeenCalledWith({ CF: 'backup' })
  })

  it('does not mutate the value object passed in', async () => {
    const onChange = vi.fn()
    const value = { SS: 'primary' as const, CF: 'backup' as const }
    const original = { ...value }
    render(<PositionChips value={value} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /^SS\b/ }))
    expect(value).toEqual(original)
  })

  it('renders all ten chips unset when the player has no positions', () => {
    render(<PositionChips value={{}} onChange={() => {}} />)
    for (const p of ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'ROVER']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${p}\\b`) })
      expect(button.getAttribute('aria-pressed')).toBe('false')
    }
  })
})
