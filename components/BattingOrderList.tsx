'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BattingOrder, PresentPlayer, Player } from '@/lib/types'

export interface BattingOrderListProps {
  order: BattingOrder
  present: PresentPlayer[]
  /**
   * The full roster, used only to resolve names.
   *
   * Deliberately NOT `present`: a saved lineup references whoever was ticked
   * present when it was generated, and attendance can change afterwards.
   * Looking names up in `present` made those players render as raw UUIDs.
   * Solver logic still uses `present` — this is display only.
   */
  roster: Player[]
  /**
   * Called when a row is dropped somewhere new. Returns the refusal reason
   * when the move is illegal, in which case the row springs back; on success
   * the parent re-renders with the new order and the rows glide into place.
   * Omit to render the list read-only (print view, mid-game lock).
   */
  onReorder?: (from: number, to: number) => { error: string } | void
  /**
   * Which drop indices are legal for a lifted row — computed once per drag so
   * the row can tint green or red under the captain's finger before they
   * commit. Same engine as onReorder, so the tint never lies.
   */
  legalTargetsFor?: (from: number) => Set<number>
}

/** How far a touch may wander before it is a scroll, and how long a press
 * becomes a lift. Mouse lifts on movement alone — nobody scrolls with it. */
const TOUCH_SLOP_PX = 8
const LONG_PRESS_MS = 180
const MOUSE_SLOP_PX = 5

interface DragState {
  from: number
  /** The order this drag was lifted against. If the prop changes underneath
   * a live drag — a reshuffle tapped mid-drag, a prop refresh — the lift-time
   * indices and rects are lies, so every commit path compares against the
   * latest order and aborts on mismatch instead of moving the wrong player. */
  order: BattingOrder
  /** The finger/mouse that owns this drag. A second pointer — a resting palm,
   * a stray thumb — must not be able to move, commit, or cancel it. */
  pointerId: number
  /** Pointer offset within the row at lift, so the row rides the finger. */
  grabOffsetY: number
  pointerY: number
  /** Row tops/heights snapshotted at lift — drop math uses these, not live
   * layout, so the parting animation cannot feed back into itself. */
  rects: { top: number; height: number }[]
  target: number
  legal: Set<number>
  lifted: boolean
}

// Stable identity for FLIP animation and React keys. Occurrence-numbering by
// scan order swaps identities when a twice-batting player's rows pass each
// other; the solver reuses slot OBJECTS across reorders, so object identity
// is the truth. Auto-outs are recreated by every repair and simply don't
// glide. Client-only module state — the solver stays pure.
const slotIdentity = new WeakMap<object, number>()
let nextSlotIdentity = 1
function slotKeyFor(slot: { kind: string }, fallback: string): string {
  if (slot.kind === 'autoOut') return fallback
  let id = slotIdentity.get(slot)
  if (id === undefined) {
    id = nextSlotIdentity++
    slotIdentity.set(slot, id)
  }
  return `s${id}`
}

/**
 * The batting order, one numbered row per slot — draggable to reorder.
 *
 * Automatic outs get a row of their own rather than a gap: the league awards
 * the other team an out at that spot in the order, and a captain who sees a
 * blank line assumes the app lost somebody. Their rows are not draggable —
 * the rules decide where automatic outs sit, not the captain.
 *
 * Interaction: long-press lifts a row on touch (a bare drag must stay a
 * scroll); mouse lifts on movement. The lifted row rides the pointer with a
 * green ring where dropping is legal and a light red ring where it is not.
 * A refused drop springs back and states the reason; a legal drop that made
 * the women re-space glides them to their new rows.
 */
export function BattingOrderList({
  order,
  present,
  roster,
  onReorder,
  legalTargetsFor,
}: BattingOrderListProps) {
  const byId = new Map(roster.map((p) => [p.id, p]))
  // Mid-game the order deliberately keeps a player who has left — re-ordering
  // batters mid-game is an out — so the row itself is the only place that can
  // say the slot's player is gone and the umpire gets an out there now.
  const hereIds = new Set(present.map((p) => p.id))
  // Women may legally bat twice when the order needs more female slots than
  // there are women, so a name can repeat. Flag the repeat where it happens.
  const seen = new Set<string>()

  const listRef = useRef<HTMLOListElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLift = useRef<{
    index: number
    startY: number
    pointerId: number
    order: BattingOrder
  } | null>(null)

  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // FLIP: when the order changes (a drop, a reshuffle, the women re-spacing),
  // rows that moved start at their old position and glide to the new one.
  // Keyed by slot identity, not index, so a repeated player's two rows each
  // track themselves.
  const prevRects = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-slot-key]'))
    // Snapshot every row's resting position BEFORE any transform is applied:
    // getBoundingClientRect includes transforms, so reading after writing
    // would record the animation's start point as the row's home and make
    // untouched rows phantom-glide on the next reorder.
    const tops = new Map(rows.map((row) => [row.dataset.slotKey!, row.getBoundingClientRect().top]))
    if (!reduceMotion) {
      const gliding: HTMLElement[] = []
      for (const row of rows) {
        const key = row.dataset.slotKey!
        const prev = prevRects.current.get(key)
        const now = tops.get(key)!
        if (prev !== undefined && Math.abs(prev - now) > 1) {
          row.style.transition = 'none'
          row.style.transform = `translateY(${prev - now}px)`
          gliding.push(row)
        }
      }
      if (gliding.length > 0) {
        // Force the start frame to commit before the transition begins —
        // without a flush the browser may batch both writes into one frame
        // and skip the glide entirely.
        void list.offsetHeight
        requestAnimationFrame(() => {
          for (const row of gliding) {
            row.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0, 1)'
            row.style.transform = ''
          }
        })
      }
    }
    prevRects.current = tops
  }, [order, reduceMotion])

  // If the order changes out from under a live drag — a reshuffle tapped by
  // another finger, a prop refresh — the lift-time indices and rects are
  // lies; abort rather than commit them. A successful drop has already
  // settled before its own new order renders, so this only fires for
  // external changes.
  // Mirror of the order prop for callbacks whose closures may be stale (the
  // long-press timer fires against whatever render armed it).
  const latestOrder = useRef(order)
  useEffect(() => {
    latestOrder.current = order
  }, [order])

  // While a row is lifted, the browser must not turn the same finger into a
  // scroll. touch-action cannot change mid-gesture, so block it the only way
  // that works: a non-passive touchmove listener for the drag's duration.
  useEffect(() => {
    if (!drag?.lifted) return
    const block = (event: TouchEvent) => event.preventDefault()
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [drag?.lifted])

  const clearPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = null
    pendingLift.current = null
  }

  const lift = (index: number, pointerY: number, pointerId: number) => {
    const list = listRef.current
    if (!list) return
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-slot-key]'))
    const rects = rows.map((row) => {
      const r = row.getBoundingClientRect()
      return { top: r.top, height: r.height }
    })
    setRefusal(null)
    setDrag({
      from: index,
      order: latestOrder.current,
      pointerId,
      grabOffsetY: pointerY - rects[index].top,
      pointerY,
      rects,
      target: index,
      legal: legalTargetsFor?.(index) ?? new Set(),
      lifted: true,
    })
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(10)
  }

  const handlePointerDown = (index: number, event: React.PointerEvent<HTMLElement>) => {
    if (!onReorder || order.slots[index].kind === 'autoOut') return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // One gesture at a time: while a drag or an armed press is live, every
    // other finger is a bystander — accepting it would let a resting palm
    // steal or commit the captain's drag.
    if (drag !== null || pendingLift.current !== null) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pendingLift.current = { index, startY: event.clientY, pointerId: event.pointerId, order }
    if (event.pointerType !== 'mouse') {
      pressTimer.current = setTimeout(() => {
        const pending = pendingLift.current
        pendingLift.current = null
        pressTimer.current = null
        // The index is meaningless if the order changed during the press.
        if (pending && pending.order === latestOrder.current) {
          lift(pending.index, pending.startY, pending.pointerId)
        }
      }, LONG_PRESS_MS)
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const pending = pendingLift.current
    // Handlers are re-bound every render, so `drag` here is always current —
    // each pointermove sees the state the previous one committed.
    const current = drag
    // Only the owning pointer may drive the gesture.
    const owner = current?.pointerId ?? pending?.pointerId
    if (owner !== undefined && event.pointerId !== owner) return
    // The order changed underneath the gesture: abort it.
    if (current && current.order !== order) {
      clearPress()
      settle()
      return
    }
    if (current?.lifted) {
      const pointerY = event.clientY
      const draggedMid =
        pointerY - current.grabOffsetY + current.rects[current.from].height / 2
      // The drop index is how many OTHER rows' midpoints sit above the
      // dragged row's midpoint — insertion semantics, measured against the
      // lift-time snapshot.
      let target = 0
      current.rects.forEach((rect, i) => {
        if (i === current.from) return
        if (rect.top + rect.height / 2 < draggedMid) target++
      })
      setDrag({ ...current, pointerY, target })
      return
    }
    if (!pending) return
    if (pending.order !== order) {
      clearPress()
      return
    }
    const travel = Math.abs(event.clientY - pending.startY)
    if (event.pointerType === 'mouse') {
      if (travel > MOUSE_SLOP_PX) {
        clearPress()
        lift(pending.index, event.clientY, pending.pointerId)
      }
    } else if (travel > TOUCH_SLOP_PX && pressTimer.current) {
      // Moved before the long press matured: this is a scroll, stand down.
      clearPress()
    }
  }

  const settle = () => setDrag(null)

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag
    const owner = current?.pointerId ?? pendingLift.current?.pointerId
    if (owner !== undefined && event.pointerId !== owner) return
    clearPress()
    if (!current?.lifted) return
    const { from, target } = current
    if (target === from || !onReorder || current.order !== order) {
      settle()
      return
    }
    const result = onReorder(from, target)
    if (result && 'error' in result) {
      setRefusal(result.error)
      // Spring back where it came from, red ring lingering just long enough
      // to register, then only clear if no new drag has started meanwhile.
      const springBack: DragState = { ...current, lifted: false }
      setDrag(springBack)
      // Clear the flash unless a new drag has replaced it in the meantime.
      setTimeout(
        () => setDrag((d) => (d === springBack ? null : d)),
        reduceMotion ? 0 : 260,
      )
      return
    }
    settle()
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLElement>) => {
    // A cancelled bystander pointer (palm rejection firing on a resting
    // finger) must not tear down the real drag.
    const owner = drag?.pointerId ?? pendingLift.current?.pointerId
    if (owner !== undefined && event.pointerId !== owner) return
    clearPress()
    settle()
  }

  const keyCounts = new Map<string, number>()

  return (
    <div>
      <ol
        ref={listRef}
        className="flex flex-col gap-2"
        aria-label="Batting order"
        data-testid="batting-order"
      >
        {order.slots.map((slot, index) => {
          const spot = index + 1
          const gender = order.pattern[index]
          const outOccurrence = slot.kind === 'autoOut' ? (keyCounts.get('OUT') ?? 0) : 0
          if (slot.kind === 'autoOut') keyCounts.set('OUT', outOccurrence + 1)
          const slotKey = slotKeyFor(slot, `OUT#${outOccurrence}`)

          const isDragged = drag !== null && index === drag.from
          const dragging = drag?.lifted === true

          // Everybody else parts to show where the lifted row would land.
          let shift = 0
          if (drag && dragging && !isDragged) {
            const h = drag.rects[drag.from].height + 8 /* the list's gap-2 */
            if (index > drag.from && index <= drag.target) shift = -h
            if (index < drag.from && index >= drag.target) shift = h
          }

          const style: React.CSSProperties = isDragged
            ? dragging
              ? {
                  transform: `translateY(${
                    drag!.pointerY - drag!.grabOffsetY - drag!.rects[drag!.from].top
                  }px) ${reduceMotion ? '' : 'scale(1.02)'}`,
                  zIndex: 10,
                  position: 'relative',
                  transition: 'none',
                }
              : {
                  // Refused: spring back to the resting position.
                  transform: 'translateY(0)',
                  zIndex: 10,
                  position: 'relative',
                  transition: reduceMotion ? 'none' : 'transform 220ms cubic-bezier(0.2, 0, 0, 1)',
                }
            : {
                transform: shift ? `translateY(${shift}px)` : undefined,
                transition: reduceMotion ? 'none' : 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
              }

          const legalHere = drag ? drag.legal.has(drag.target) : true
          const ring = isDragged
            ? dragging
              ? legalHere
                ? ' ring-2 ring-green-600 bg-green-50 shadow-lg dark:bg-green-950'
                : ' ring-2 ring-red-400 bg-red-50 shadow-lg dark:bg-red-950'
              : refusal
                ? ' ring-2 ring-red-400 bg-red-50 dark:bg-red-950'
                : ''
            : ''

          if (slot.kind === 'autoOut') {
            return (
              <li
                key={slotKey}
                data-slot-key={slotKey}
                style={style}
                className="flex min-h-11 items-center gap-3 rounded-lg border-2 border-dashed border-zinc-400 px-3 py-2 dark:border-zinc-500"
              >
                <span className="w-6 shrink-0 text-sm font-bold text-zinc-700 dark:text-zinc-300">
                  {spot}
                </span>
                <span className="flex-1 text-base font-medium text-foreground">Automatic out</span>
                <span className="rounded-full border-2 border-zinc-700 px-2 py-0.5 text-xs font-bold text-zinc-700 dark:border-zinc-300 dark:text-zinc-300">
                  Out
                </span>
              </li>
            )
          }

          const player = byId.get(slot.playerId)
          const name = player?.name ?? slot.playerId
          const repeat = seen.has(slot.playerId)
          seen.add(slot.playerId)

          return (
            <li
              key={slotKey}
              data-slot-key={slotKey}
              style={style}
              onPointerDown={(e) => handlePointerDown(index, e)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              aria-roledescription={onReorder ? 'draggable batting slot' : undefined}
              className={`flex min-h-11 select-none items-center gap-3 rounded-lg border border-zinc-300 bg-background px-3 py-2 dark:border-zinc-700${
                onReorder ? ' cursor-grab' : ''
              }${ring}`}
            >
              <span className="w-6 shrink-0 text-sm font-bold text-zinc-700 dark:text-zinc-300">
                {spot}
              </span>
              <span className="flex-1 text-base font-medium text-foreground">{name}</span>
              {!hereIds.has(slot.playerId) && (
                <span className="rounded-full border-2 border-zinc-400 px-2 py-0.5 text-xs font-bold text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
                  Not here
                </span>
              )}
              {repeat && (
                <span className="rounded-full border-2 border-zinc-400 px-2 py-0.5 text-xs font-bold text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
                  2nd at-bat
                </span>
              )}
              {gender && (
                <span
                  className="w-5 shrink-0 text-center text-xs font-bold text-zinc-700 dark:text-zinc-300"
                  aria-label={gender === 'F' ? 'female slot' : 'male or X slot'}
                >
                  {gender}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {onReorder && (
        <p
          aria-live="polite"
          className="mt-2 min-h-5 text-sm font-medium text-red-700 dark:text-red-400"
        >
          {refusal}
        </p>
      )}
    </div>
  )
}
