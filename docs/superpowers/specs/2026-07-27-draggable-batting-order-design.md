# Draggable batting order — design

Approved by Joey 2026-07-27 ("Yes. Go"), with two decisions made during
brainstorming: illegal drops are refused with light red feedback (not
silently snapped), and reordering is a true touch-plus-mouse drag with
native-app motion, green feedback on legal targets while dragging.

## What it does

The captain lifts any batting-order row and drops it somewhere else. Three
outcomes:

1. **Directly legal** — the resulting gender sequence already satisfies every
   pattern rule. The row settles where dropped.
2. **Legal after auto-fill** — the dropped player stays exactly where dropped,
   and the women re-space to the nearest legal arrangement: the legal pattern
   (with the dragged player's gender fixed at the drop slot) that minimises
   total female displacement, women keeping their relative order. The moved
   women visibly glide to their new rows.
3. **Impossible** — no legal pattern puts that gender at that slot. The row
   springs back with a light red flash and a one-line reason. The order is
   untouched.

While a row is lifted, every insertion point shows green (outcome 1 or 2) or
light red (outcome 3) before the captain lets go — computed once at drag
start, so hover feedback is a set lookup.

## Solver (`lib/solver/reorderBattingOrder.ts`, pure)

- `legalReorderTargets(order, present, from): Set<number>` — for drag-start
  precomputation.
- `reorderBattingOrder(order, present, from, to)` →
  `{ order, movedSlots } | { error }`. `movedSlots` are the indices whose
  occupant changed besides the drag itself, for the glide animation.

Mechanics:

- Reordering never changes who bats, so the pattern's female-slot count is
  fixed. All valid patterns for (n, femaleSpots) are constructed exhaustively
  and deterministically by a run-length-pruned depth-first walk (own walker;
  `enumerateGenderPatterns` shuffles and caps at `maxPatternCandidates`,
  which could drop the minimal-movement pattern). Pruned construction, not
  filter-the-combinations: repeat/auto-out padding inflates slot counts past
  roster size — 17 men + 3 women is already 25 slots, C(25,8) > 10⁶, and
  20 men + 2 women is 30 slots, C(30,10) ≈ 3×10⁷ — so a combination filter
  would need a size gate that silently turns repairable drags into refusals
  (the adversarial review demonstrated exactly that). Legal patterns are
  sparse; the pruned walk stays interactive at every reachable shape, with a
  40-slot backstop for corrupt inputs only. Degraded single-gender orders
  (buildBattingOrder's own fallback, pattern rules declared inapplicable)
  reorder freely rather than consulting the walker.
- Cost of a candidate pattern: women (in relative order, the dragged woman
  excluded when she is the drag) are matched in order to its F slots; cost is
  the sum of absolute index displacement. Lowest cost wins; ties broken by
  first-in-walk order so results are deterministic.
- Automatic outs are rule artifacts, not players: their rows are not
  draggable, and when women re-space, auto-outs re-derive onto every Nth
  female slot of the new pattern exactly as `buildBattingOrder` places them
  (`RULES.autoOutEveryNthFemaleSpot`).
- A player batting twice may not end up in adjacent slots, including the wrap
  from last back to first; candidate patterns that force that are skipped in
  cost order.

## UI (`components/BattingOrderList.tsx` + `LineupClient`)

One pointer-events implementation for touch and mouse: long-press (~150 ms)
lifts on touch so dragging does not fight page scroll; mouse lifts on
movement. The lifted row scales slightly with a shadow and follows the
pointer; other rows part with translate transitions (uniform row height makes
the gap math exact). The insertion gap tints green or light red from the
precomputed target set. Drop settles with the same transition; a refused drop
transitions back and flashes red with the reason in an `aria-live` line.
Auto-filled women glide via FLIP on the same transition curve.
`prefers-reduced-motion` disables all of it. No new dependency.

`LineupClient` passes `onReorder`; a successful reorder updates the order,
appends a repair note to the order's warnings when the women were re-spaced
(the glide alone is not feedback — reduced-motion users never see it), and
marks the lineup unsaved, exactly like a fielding swap. The drag is owned by
one pointer id — stray fingers and palm-rejection cancels are bystanders —
and aborts if the order changes underneath it. Print and PNG export consume
the order as-is and need no change.

## Testing

- Solver TDD: direct-legal move; repair move asserting minimal female
  displacement and dragged-slot fidelity; impossible move refused with the
  order untouched; repeat-player adjacency (incl. wraparound) skipped over;
  auto-out re-derivation; first-10 female rule preserved; determinism across
  calls.
- Component: pointer-event sequences in jsdom — lift, part, legal drop calls
  `onReorder(from, to)`, refused drop leaves DOM order intact and renders the
  reason; auto-out row does not lift.
- Live drive before ship: real drags in a browser against the prod build.
