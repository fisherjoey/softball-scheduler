import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldingGridTable, type GridCellRef } from './FieldingGridTable'
import { buildFieldingGrid } from '@/lib/solver/buildFieldingGrid'
import { mkRoster } from '@/lib/solver/fixtures'
import type { FieldingGrid, PresentPlayer } from '@/lib/types'

/**
 * A roster of 13 with 5 women fields 10, so three people sit every inning —
 * which is the whole reason the picker exists.
 */
function setup(overrides: Partial<PresentPlayer>[] = []) {
  const present = mkRoster(13, 5).map((player, i) => ({ ...player, ...overrides[i] }))
  const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 21 })
  return { present, grid }
}

function renderGrid(
  present: PresentPlayer[],
  grid: FieldingGrid,
  selected: GridCellRef | null,
  handlers: Partial<{
    onSelect: (cell: GridCellRef) => void
    onAssign: (cell: GridCellRef, playerId: string) => void
    onCancel: () => void
  }> = {},
  roster?: PresentPlayer[],
) {
  return render(
    <FieldingGridTable
      grid={grid}
      present={present}
      roster={roster ?? present}
      pins={[]}
      selected={selected}
      lockedThrough={0}
      onSelect={handlers.onSelect ?? vi.fn()}
      onTogglePin={vi.fn()}
      onSwap={vi.fn()}
      onAssign={handlers.onAssign ?? vi.fn()}
      onCancel={handlers.onCancel ?? vi.fn()}
    />,
  )
}

describe('FieldingGridTable', () => {
  it('opens the picker for the cell the captain taps', async () => {
    const { present, grid } = setup()
    const onSelect = vi.fn()
    renderGrid(present, grid, null, { onSelect })

    // Both views render, so the same fielder appears twice. Either will do.
    const pitcher = screen.getAllByRole('button', { name: /P, inning 1/ })[0]
    await userEvent.click(pitcher)
    expect(onSelect).toHaveBeenCalledWith({ inning: 1, position: 'P' })
  })

  it('groups the picker into On the field and Bench, with the bench last', () => {
    const { present, grid } = setup()
    renderGrid(present, grid, { inning: 1, position: 'P' })

    const picker = screen.getAllByRole('combobox', { name: /Who plays P in inning 1/ })[0]
    const groups = within(picker).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['On the field', 'Bench'])

    const onField = new Set(Object.values(grid.assignments[0]))
    const benchNames = present.filter((p) => !onField.has(p.id)).map((p) => p.name)
    expect(benchNames.length).toBe(3)
    for (const name of benchNames) {
      expect(within(groups[1]).getByRole('option', { name: new RegExp(name) })).toBeDefined()
    }
    // ...and nobody who is actually playing is offered as a bench choice.
    expect(within(groups[0]).getAllByRole('option')).toHaveLength(onField.size)
  })

  it('shows the player already in the cell as the selected option', () => {
    const { present, grid } = setup()
    renderGrid(present, grid, { inning: 1, position: 'P' })
    const picker = screen.getAllByRole('combobox', {
      name: /Who plays P in inning 1/,
    })[0] as HTMLSelectElement
    expect(picker.value).toBe(grid.assignments[0].P)
  })

  it('names each fielder’s position in the option, so a swap reads as one', () => {
    const { present, grid } = setup()
    renderGrid(present, grid, { inning: 1, position: 'P' })
    const picker = screen.getAllByRole('combobox', { name: /Who plays P in inning 1/ })[0]
    const catcher = present.find((p) => p.id === grid.assignments[0].C)!
    expect(
      within(picker).getByRole('option', { name: new RegExp(`${catcher.name}.*— C`) }),
    ).toBeDefined()
  })

  it('leaves out anybody who is not available that inning', () => {
    // p12 turns up in the fifth, so he is neither fielding nor sitting in the
    // first — he is not at the park, and picking him could only be refused.
    const { present, grid } = setup([...Array(12).fill({}), { arrivedInning: 5 }])
    renderGrid(present, grid, { inning: 1, position: 'P' })
    const picker = screen.getAllByRole('combobox', { name: /Who plays P in inning 1/ })[0]
    expect(within(picker).queryByRole('option', { name: /p12/ })).toBeNull()
  })

  it('reports the chosen player to onAssign', async () => {
    const { present, grid } = setup()
    const onAssign = vi.fn()
    renderGrid(present, grid, { inning: 1, position: 'P' }, { onAssign })

    const onField = new Set(Object.values(grid.assignments[0]))
    const benched = present.find((p) => !onField.has(p.id))!
    const picker = screen.getAllByRole('combobox', { name: /Who plays P in inning 1/ })[0]
    await userEvent.selectOptions(picker, benched.id)
    expect(onAssign).toHaveBeenCalledWith({ inning: 1, position: 'P' }, benched.id)
  })

  it('can be dismissed without choosing', async () => {
    const { present, grid } = setup()
    const onCancel = vi.fn()
    renderGrid(present, grid, { inning: 1, position: 'P' }, { onCancel })
    await userEvent.click(
      screen.getAllByRole('button', { name: /Cancel changing P in inning 1/ })[0],
    )
    expect(onCancel).toHaveBeenCalled()
  })

  it('lists the bench for every inning', () => {
    const { present, grid } = setup()
    renderGrid(present, grid, null)

    const onField = new Set(Object.values(grid.assignments[0]))
    const benched = present.filter((p) => !onField.has(p.id))
    const card = screen.getByRole('region', { name: 'Inning 1 fielding' })
    const bench = within(card).getByRole('list')
    for (const player of benched) {
      expect(within(bench).getByText(new RegExp(player.name))).toBeDefined()
    }
    // The marker has to travel with the name or the captain cannot tell what a
    // choice costs him.
    for (const player of benched.filter((p) => p.isFemale)) {
      expect(within(bench).getByText(new RegExp(player.name)).textContent).toMatch(/F/)
    }
  })

  it('says so plainly when nobody is sitting', () => {
    // 10 present with 5 women fields all 10, so the bench is empty every
    // inning and an empty region would just read as a rendering bug.
    const present = mkRoster(10, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 22 })
    renderGrid(present, grid, null)
    const card = screen.getByRole('region', { name: 'Inning 1 fielding' })
    expect(within(card).getByText(/Nobody/i)).toBeDefined()
    expect(within(card).queryByRole('list')).toBeNull()
  })

  it('shows a name for a fielder who is no longer marked present', () => {
    // A saved lineup references whoever was present when it was generated.
    // Attendance can change afterwards; those players must still render by
    // name, not as a raw UUID. Regression: names were looked up in `present`.
    // The default fixture names players the same as their ids, which would
    // make "shows a name" and "shows an id" indistinguishable. Give them
    // distinct names so the assertion means something.
    const { present, grid } = setup(
      Array.from({ length: 13 }, (_, i) => ({ name: `Player${i}` })),
    )
    const dropped = Object.values(grid.assignments[0])[0]
    const stillPresent = present.filter((p) => p.id !== dropped)
    const droppedPlayer = present.find((p) => p.id === dropped)!

    renderGrid(stillPresent, grid, null, {}, present)

    expect(screen.getAllByText(droppedPlayer.name).length).toBeGreaterThan(0)
    expect(screen.queryByText(dropped)).toBeNull()
  })
})
