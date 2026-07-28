import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LineupClient } from './LineupClient'
import { persistLineup } from './actions'
import { buildBattingOrder } from '@/lib/solver/buildBattingOrder'
import { buildFieldingGrid } from '@/lib/solver/buildFieldingGrid'
import { mkPlayer, mkRoster } from '@/lib/solver/fixtures'
import type { Position, PresentPlayer } from '@/lib/types'

// The real module is a server action that imports the database client; in
// jsdom the only thing under test is whether and when it gets called.
vi.mock('./actions', () => ({
  persistLineup: vi.fn(async () => {}),
}))

// Outside a Next app-router context Link cannot navigate; what matters here is
// that the anchor renders and our onClick fires. preventDefault stands in for
// the client-side navigation a real Link performs instead of a page load.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event)
        event.preventDefault()
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}))

/** Mirrors LineupClient's seed hash so tests reproduce its initial grid. */
function seedFor(gameId: string): number {
  let h = 2166136261
  for (let i = 0; i < gameId.length; i++) {
    h ^= gameId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 1_000_000
}

const GAME = 'test-game'

function renderClient(
  present: PresentPlayer[] = mkRoster(13, 5),
  props: Partial<React.ComponentProps<typeof LineupClient>> = {},
) {
  const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: seedFor(GAME) })
  const { unmount } = render(
    <LineupClient
      gameId={GAME}
      innings={7}
      present={present}
      roster={present}
      history={[]}
      saved={null}
      {...props}
    />,
  )
  return { grid, present, unmount }
}

/** A saved lineup for `present`, built exactly as the app would have. */
function mkSaved(present: PresentPlayer[]) {
  const seed = seedFor(GAME)
  return {
    grid: buildFieldingGrid({ present, innings: 7, pins: [], seed }),
    order: buildBattingOrder({ present, history: [], seed }),
  }
}

/** jsdom has no DataTransfer; the grid only uses this much of it. */
function mkDataTransfer() {
  const store = new Map<string, string>()
  return {
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'none',
  }
}

const staleBanner = () => screen.queryByText(/no longer matches who is here/)

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('pins follow their player', () => {
  it('moves the pin with the player through a picker-driven exchange', async () => {
    const user = userEvent.setup()
    const { grid } = renderClient()
    const pId = grid.assignments[0].P!
    const ssId = grid.assignments[0].SS!

    await user.click(screen.getAllByRole('button', { name: `Pin ${pId} at P in inning 1` })[0])
    await user.click(
      screen.getAllByRole('button', { name: new RegExp(`^${pId}, P, inning 1, pinned`) })[0],
    )
    const select = screen.getAllByRole('combobox', { name: 'Who plays P in inning 1' })[0]
    await user.selectOptions(select, ssId)

    // The exchange happened…
    expect(
      screen.getAllByRole('button', { name: new RegExp(`^${ssId}, P, inning 1`) }).length,
    ).toBeGreaterThan(0)
    // …and the pin travelled with the pitcher to SS, instead of pinning the
    // new occupant to P.
    expect(
      screen.getAllByRole('button', { name: `Unpin ${pId} at SS in inning 1` }).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryAllByRole('button', { name: `Unpin ${ssId} at P in inning 1` }),
    ).toHaveLength(0)
  })

  it('moves the pin with the player through a drag swap', async () => {
    const user = userEvent.setup()
    const { grid } = renderClient()
    const pId = grid.assignments[0].P!
    const ssId = grid.assignments[0].SS!

    await user.click(screen.getAllByRole('button', { name: `Pin ${pId} at P in inning 1` })[0])

    const dt = mkDataTransfer()
    fireEvent.dragStart(
      screen.getAllByRole('button', { name: new RegExp(`^${pId}, P, inning 1, pinned`) })[0],
      { dataTransfer: dt },
    )
    fireEvent.drop(
      screen.getAllByRole('button', { name: new RegExp(`^${ssId}, SS, inning 1`) })[0],
      { dataTransfer: dt },
    )

    expect(
      screen.getAllByRole('button', { name: `Unpin ${pId} at SS in inning 1` }).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryAllByRole('button', { name: `Unpin ${ssId} at P in inning 1` }),
    ).toHaveLength(0)
  })

  it('drops the pin when its player is benched via the picker', async () => {
    const user = userEvent.setup()
    const { grid, present } = renderClient()
    const pId = grid.assignments[0].P!
    const byId = new Map(present.map((p) => [p.id, p]))
    const onField = new Set(Object.values(grid.assignments[0]))
    // Same gender, so the bench-in is legal and only the pin is at stake.
    const bench = present.find(
      (p) => !onField.has(p.id) && p.isFemale === byId.get(pId)!.isFemale,
    )!

    await user.click(screen.getAllByRole('button', { name: `Pin ${pId} at P in inning 1` })[0])
    await user.click(
      screen.getAllByRole('button', { name: new RegExp(`^${pId}, P, inning 1, pinned`) })[0],
    )
    const select = screen.getAllByRole('combobox', { name: 'Who plays P in inning 1' })[0]
    await user.selectOptions(select, bench.id)

    expect(
      screen.getAllByRole('button', { name: new RegExp(`^${bench.id}, P, inning 1`) }).length,
    ).toBeGreaterThan(0)
    // The pinned player is on the bench now, and a pin cannot point there.
    expect(screen.queryAllByRole('button', { name: /^Unpin / })).toHaveLength(0)
  })
})

describe('refusals', () => {
  it('shows the refusal and leaves the grid untouched on an illegal bench-in', async () => {
    const user = userEvent.setup()
    // Ten men and exactly the minimum women: benching a woman for a man
    // breaks the females-on-field floor, so the solver must refuse.
    const present = [
      ...Array.from({ length: 10 }, (_, i) => mkPlayer(`m${i}`)),
      ...Array.from({ length: 3 }, (_, i) => mkPlayer(`f${i}`, { isFemale: true })),
    ]
    const { grid } = renderClient(present)
    const womanSlot = (Object.entries(grid.assignments[0]) as [Position, string][]).find(
      ([, id]) => id.startsWith('f'),
    )!
    const onField = new Set(Object.values(grid.assignments[0]))
    const benchMan = present.find((p) => !p.isFemale && !onField.has(p.id))!

    await user.click(
      screen.getAllByRole('button', {
        name: new RegExp(`^${womanSlot[1]}, ${womanSlot[0]}, inning 1`),
      })[0],
    )
    await user.selectOptions(
      screen.getAllByRole('combobox', { name: `Who plays ${womanSlot[0]} in inning 1` })[0],
      benchMan.id,
    )

    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts.some((t) => t?.includes('Swap refused'))).toBe(true)
    // Refused, not half-applied: the woman is still in her cell.
    expect(
      screen.getAllByRole('button', {
        name: new RegExp(`^${womanSlot[1]}, ${womanSlot[0]}, inning 1`),
      }).length,
    ).toBeGreaterThan(0)
  })
})

describe('reshuffle', () => {
  it('clears an open picker', async () => {
    const user = userEvent.setup()
    const { grid } = renderClient()
    const pId = grid.assignments[0].P!

    await user.click(screen.getAllByRole('button', { name: new RegExp(`^${pId}, P, inning 1`) })[0])
    expect(screen.getAllByRole('combobox', { name: 'Who plays P in inning 1' }).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Reshuffle' }))
    expect(screen.queryAllByRole('combobox', { name: 'Who plays P in inning 1' })).toHaveLength(0)
  })
})

describe('stale-lineup banner', () => {
  it('warns when a mid-game arrival fields but is absent from the kept order', () => {
    // Two innings in, Nate arrives. The captain updates attendance, comes
    // back, and the locked rebuild fields Nate in the innings still to come —
    // but the batting order is deliberately kept, so Nate never bats. The old
    // union check saw him in the grid and stayed silent.
    const present12 = mkRoster(12, 4)
    const seed = seedFor(GAME)
    const grid0 = buildFieldingGrid({ present: present12, innings: 7, pins: [], seed })
    const order0 = buildBattingOrder({ present: present12, history: [], seed })
    const nate = mkPlayer('nate', { name: 'Newcomer Nate', arrivedInning: 3 })
    const present13 = [...present12, nate]
    const grid1 = buildFieldingGrid({
      present: present13,
      innings: 7,
      pins: [],
      seed: seed + 1,
      lockedThroughInning: 2,
      existingGrid: grid0,
    })
    // Sanity: the scenario only bites because the grid DOES field him.
    expect(grid1.assignments.some((a) => Object.values(a).includes('nate'))).toBe(true)

    renderClient(present13, { saved: { grid: grid1, order: order0 }, roster: present13 })

    const banner = staleBanner()
    expect(banner).not.toBeNull()
    const status = banner!.closest('[role="status"]')!
    expect(status.textContent).toContain('Newcomer Nate')
    expect(status.textContent).toMatch(/would not bat/)
  })

  it('warns when the saved grid fields somebody in innings they are not here for', () => {
    // Attendance edited after saving: the inning-1 pitcher now only arrives
    // in the fourth, but the saved grid still has him fielding the first.
    const present = mkRoster(13, 5)
    const saved = mkSaved(present)
    const late = saved.grid.assignments[0].P!
    const edited = present.map((p) => (p.id === late ? { ...p, arrivedInning: 4 } : p))

    renderClient(edited, { saved, roster: present })

    const banner = staleBanner()
    expect(banner).not.toBeNull()
    const status = banner!.closest('[role="status"]')!
    expect(status.textContent).toContain(late)
    expect(status.textContent).toMatch(/not here for/)
  })

  it('clears after a locked rebuild even though the departed player stays in played innings', async () => {
    const user = userEvent.setup()
    const present13 = mkRoster(13, 5)
    const saved = mkSaved(present13)
    const departed = present13[12]
    const present12 = present13.filter((p) => p.id !== departed.id)

    renderClient(present12, { saved, roster: present13 })
    expect(staleBanner()).not.toBeNull()

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Innings already played/ }),
      '3',
    )
    await user.click(screen.getByRole('button', { name: 'Reshuffle innings 4–7' }))

    // Innings 1–3 legitimately keep the departed player and the kept order
    // still names him — the rebuild did everything the banner could ask for,
    // so a banner that survived it would only teach the captain to ignore it.
    expect(staleBanner()).toBeNull()
  })

  it('tells a pre-game captain to set the played innings first when the game is underway', () => {
    const present13 = mkRoster(13, 5)
    const saved = mkSaved(present13)
    const present12 = present13.slice(0, 12)

    renderClient(present12, { saved, roster: present13 })

    const status = staleBanner()!.closest('[role="status"]')!
    expect(status.textContent).toMatch(/Innings already played.*first/)
  })
})

describe('unsaved changes', () => {
  it('guards unload while dirty and lifts the guard once saved', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const added = () => addSpy.mock.calls.filter(([type]) => type === 'beforeunload').length
    const removed = () =>
      removeSpy.mock.calls.filter(([type]) => type === 'beforeunload').length

    const present = mkRoster(13, 5)
    const saved = mkSaved(present)
    renderClient(present, { saved })
    expect(added()).toBe(0)

    // A drag swap dirties the lineup.
    const pId = saved.grid.assignments[0].P!
    const cId = saved.grid.assignments[0].C!
    const dt = mkDataTransfer()
    fireEvent.dragStart(
      screen.getAllByRole('button', { name: new RegExp(`^${pId}, P, inning 1`) })[0],
      { dataTransfer: dt },
    )
    fireEvent.drop(
      screen.getAllByRole('button', { name: new RegExp(`^${cId}, C, inning 1`) })[0],
      { dataTransfer: dt },
    )
    expect(added()).toBe(1)
    expect(removed()).toBe(0)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save lineup' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDefined())
    expect(removed()).toBe(1)
  })

  it('persists a dirty lineup when the captain follows the attendance link', async () => {
    const user = userEvent.setup()
    const present = mkRoster(13, 5)
    const saved = mkSaved(present)
    renderClient(present, { saved })

    const link = screen.getByRole('link', { name: /update attendance/i })
    await user.click(link)
    // Nothing changed yet, so there is nothing to save.
    expect(persistLineup).not.toHaveBeenCalled()

    const pId = saved.grid.assignments[0].P!
    const cId = saved.grid.assignments[0].C!
    const dt = mkDataTransfer()
    fireEvent.dragStart(
      screen.getAllByRole('button', { name: new RegExp(`^${pId}, P, inning 1`) })[0],
      { dataTransfer: dt },
    )
    fireEvent.drop(
      screen.getAllByRole('button', { name: new RegExp(`^${cId}, C, inning 1`) })[0],
      { dataTransfer: dt },
    )

    await user.click(link)
    expect(persistLineup).toHaveBeenCalledTimes(1)
    expect(vi.mocked(persistLineup).mock.calls[0][0]).toBe(GAME)
  })
})

describe('locking innings already played', () => {
  it('closes an open picker the moment its inning is declared played', async () => {
    const user = userEvent.setup()
    const { grid } = renderClient()
    const pId = grid.assignments[0].P!

    await user.click(screen.getAllByRole('button', { name: new RegExp(`^${pId}, P, inning 1`) })[0])
    expect(screen.getAllByRole('combobox', { name: 'Who plays P in inning 1' }).length).toBeGreaterThan(0)

    // fireEvent, not userEvent: a click-driven select would blur the picker
    // and close it for an unrelated reason, hiding what this test is about.
    fireEvent.change(screen.getByRole('combobox', { name: /Innings already played/ }), {
      target: { value: '1' },
    })

    expect(screen.queryAllByRole('combobox', { name: 'Who plays P in inning 1' })).toHaveLength(0)
    // The occupant is untouched and now reads as locked.
    expect(
      screen.getAllByRole('button', { name: new RegExp(`^${pId}, P, inning 1.*locked`) }).length,
    ).toBeGreaterThan(0)
  })

  it('refuses a drop whose source inning was locked mid-drag', () => {
    // The cross-inning pair is chosen so the swap is LEGAL on its own merits
    // — each side is benched in the other's inning and genders match — so the
    // only thing standing between the drop and the played inning is swap()'s
    // lock guard. A pair the solver would refuse anyway proves nothing.
    const first = renderClient()
    const fieldsIn = (id: string, inning: number) =>
      Object.values(first.grid.assignments[inning - 1]).includes(id)
    const posOf = (id: string, inning: number) =>
      (Object.entries(first.grid.assignments[inning - 1]) as [Position, string][]).find(
        ([, v]) => v === id,
      )![0]
    const pair = (() => {
      for (const a of first.present) {
        if (!fieldsIn(a.id, 1) || fieldsIn(a.id, 2)) continue
        for (const b of first.present) {
          if (!fieldsIn(b.id, 2) || fieldsIn(b.id, 1)) continue
          if (a.isFemale !== b.isFemale) continue
          return { a, b }
        }
      }
      return null
    })()
    expect(pair).not.toBeNull()
    const { a, b } = pair!
    const fromName = new RegExp(`^${a.id}, ${posOf(a.id, 1)}, inning 1`)
    const toName = new RegExp(`^${b.id}, ${posOf(b.id, 2)}, inning 2`)

    const drag = () => {
      const dt = mkDataTransfer()
      fireEvent.dragStart(screen.getAllByRole('button', { name: fromName })[0], {
        dataTransfer: dt,
      })
      return dt
    }
    const drop = (dt: ReturnType<typeof mkDataTransfer>) =>
      fireEvent.drop(screen.getAllByRole('button', { name: toName })[0], { dataTransfer: dt })

    // Premise: without the lock, this exact drop goes through.
    drop(drag())
    expect(screen.queryAllByRole('button', { name: fromName })).toHaveLength(0)
    first.unmount()

    renderClient()
    const dt = drag()
    // Inning 1 gets locked while the drag is airborne. The drop target is
    // inning 2, which is still live, so only the swap() guard can refuse.
    fireEvent.change(screen.getByRole('combobox', { name: /Innings already played/ }), {
      target: { value: '1' },
    })
    drop(dt)

    expect(screen.getAllByRole('button', { name: fromName }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: toName }).length).toBeGreaterThan(0)
  })

  it('cannot lock the whole game — there would be nothing left to reshuffle', () => {
    renderClient()
    const lock = screen.getByRole('combobox', { name: /Innings already played/ })
    expect(within(lock).getByRole('option', { name: 'Through inning 6' })).toBeDefined()
    expect(within(lock).queryByRole('option', { name: 'Through inning 7' })).toBeNull()
  })
})

describe('batting-order reorder wiring', () => {
  /** The list's rows, with real geometry so the drag math works in jsdom. */
  function battingRows() {
    const list = screen.getByTestId('batting-order')
    const rows = Array.from(list.querySelectorAll('li'))
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
        ({ top: i * 52, bottom: i * 52 + 44, height: 44, left: 0, right: 300, width: 300, x: 0, y: i * 52 }) as DOMRect
    })
    return rows
  }

  it('a drag marks the lineup unsaved and updates the list', async () => {
    renderClient()
    expect(screen.queryByRole('button', { name: 'Saved' })).toBeNull() // fresh = already unsaved
    const rows = battingRows()
    const names = rows.map((r) => r.textContent)
    fireEvent.pointerDown(rows[1], { pointerType: 'mouse', button: 0, clientY: 74 })
    fireEvent.pointerMove(rows[1], { pointerType: 'mouse', clientY: 92 })
    fireEvent.pointerMove(rows[1], { pointerType: 'mouse', clientY: 150 })
    fireEvent.pointerUp(rows[1])
    await waitFor(() => {
      const after = Array.from(screen.getByTestId('batting-order').querySelectorAll('li')).map(
        (r) => r.textContent,
      )
      expect(after).not.toEqual(names)
    })
  })

  it('locking any innings removes the drag entirely', async () => {
    renderClient()
    const lock = screen.getByRole('combobox', { name: /Innings already played/ })
    fireEvent.change(lock, { target: { value: '1' } })
    await waitFor(() => {
      const list = screen.getByTestId('batting-order')
      const row = list.querySelector('li[aria-roledescription]')
      expect(row).toBeNull()
    })
    // And the drag hint copy is gone with it.
    expect(screen.queryByText(/Drag a batter to move them/)).toBeNull()
  })
})
