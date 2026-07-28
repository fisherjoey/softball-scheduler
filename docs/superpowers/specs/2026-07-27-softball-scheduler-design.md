# Softball Lineup Generator — Design

**Date:** 2026-07-27
**Status:** Approved
**Context:** Calgary Sport & Social Club (CSSC) co-ed slo-pitch league

## Purpose

Generate a legal, fair 7-inning fielding grid and batting order for a CSSC co-ed
slo-pitch team, from a persistent roster of players and subs. Replaces doing it
by hand on a clipboard before every game.

Single user (the captain). Used the night before to draft a lineup, and again at
the diamond to adjust for who actually showed up.

## League rules encoded

Source: CSSC Slo-Pitch Tournament Rulebook (`slo-pitch-tournament-rulebook.pdf`,
`calgarysportsclub.com`). The league rulebook is behind the HomeBaseHub login;
the roster and batting-order tables are identical between the two documents, and
the differences that do exist (6 innings / 80 min tournament vs 7 innings /
90 min league) are captured as configuration, not hardcoded logic.

**All rule parameters live in one file, `lib/rules/config.ts`, so a correction to
the league rulebook is a constant change, not a code change.**

### Fielding

- A full defence is 10 players: 1 pitcher, 1 catcher, 4 infielders, 3 outfielders,
  1 rover.
- Minimum 3 female players on the field.
- Maximum 7 M/X players on the field.
- Female minimums are inclusive of anyone who identifies as female; M and X do not
  count toward the female minimum.

Consequence, and the rule the solver actually uses:

```
maxFielders = min(10, playersPresent, femalesAvailable + 7)
```

With 2 women present you field **9**, not 10 — the 7 M/X cap binds. With 1 woman
you would field 8, but the team is already in default (see below).

When fielding fewer than 10, positions are dropped in this order: **Rover, then
RF**. Configurable.

### Default minimums

Minimum to avoid a default: **7 players, including 2 female**. Below that, no
official game. The app surfaces this as a blocking banner, not a silent failure.

### Batting order

- Every player at the game must be in the batting order. No limit on length.
- A player may bat without fielding. A player may **not** field without batting.
- **3 female spots must appear within the first 10 slots.**
- **At most 3 players of the same gender in a row, and a run of exactly 3 may occur
  only once in the whole order — including the wrap from the bottom back to the top.**
- If only 2 female players are present, every 3rd female spot is an automatic out.
- With exactly 3 female players present, the order may repeat them as needed to
  fill the required female spots.
- On a women-heavy roster the app applies the same repeat rule to the scarce men;
  the rulebook only explicitly authorizes repeating female players, so this is a
  house interpretation of a rulebook gap and the app warns the captain to clear
  it with the opposing captain.

#### Derivation of required female spots

The order is circular. `F` female spots split it into `F` gaps of consecutive
males. Every gap must be ≤ 2, except at most one gap of exactly 3. So for `M`
males:

```
M ≤ 2F + 1   →   F ≥ (N − F − 1) / 2   →   F ≥ (N − 1) / 3
```

Therefore:

```
femaleSpots(N) = max(3, ceil((N − 1) / 3))
```

This reproduces the rulebook's published chart exactly:

| N (batters) | Rulebook says | Formula gives |
|---|---|---|
| 10 | 3 | 3 |
| 11 | 4 | 4 |
| 12 | 4 | 4 |
| 13 | 4 | 4 |
| 14 | 5 | 5 |
| 15 | 5 | 5 |

**The formula is the implementation; the chart is a test fixture.** Every row above
becomes an assertion.

#### Automatic outs

Auto-outs occur only when fewer than 3 female players are present. Female spots
are numbered 1..F around the order; a spot is an automatic out when
`spotIndex % 3 == 0`. The present women fill the remaining spots in rotation.

With 3 or more women present there are never auto-outs — women repeat as needed.

## Fairness

Four goals, all weighted, all applying **within a single game** (no season-long
tracking except batting-order rotation):

1. **Equal innings played** — minimise the spread of fielded innings across
   present roster players.
2. **Position variety** — nobody parked at one position all game.
3. **Skill fit** — prefer a player's Primary positions over Backup.
4. **Sub minimisation** — subs sit whenever roster players can fill the slot.

**Subs are excluded from the equal-innings calculation entirely.** They pay
nothing; roster players get the innings. A sub fields only when the roster cannot
legally fill the defence — most commonly when a female sub is needed to satisfy
the 3-female minimum. When that happens the UI explains why.

Batting-order rotation is the one cross-game concern: a player's batting slot in
the last 4 games is tracked, and the solver prefers orders that move people off
slots they've recently occupied. Subs are excluded from this history.

## Data model

Postgres schema `softball`, inside the existing Tracker Supabase project
(`/home/joey/dev/synced/ops/synced-ops`).

**Isolation requirement — non-negotiable.** The Tracker project holds paid client
billing records in `public.time_entries`. This app connects as a dedicated
Postgres role `softball_app` that has grants **only** on the `softball` schema. It
does **not** use the Supabase service-role key, which bypasses RLS on every schema.
A bug in this hobby app must not be able to reach billing data.

| Table | Columns |
|---|---|
| `players` | `id`, `name`, `is_female`, `is_sub`, `is_active`, `created_at` |
| `player_positions` | `player_id`, `position`, `tier` (`primary` \| `backup`) |
| `games` | `id`, `date`, `opponent`, `notes`, `innings` (default 7), `created_at` |
| `game_attendance` | `game_id`, `player_id`, `is_present`, `arrived_inning`, `left_inning` |
| `lineups` | `game_id`, `inning`, `position`, `player_id` |
| `batting_orders` | `game_id`, `slot`, `player_id` (nullable — null means `AUTO_OUT`) |

`position` is an enum: `P`, `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`, `ROVER`.

`arrived_inning` defaults to 1 and `left_inning` defaults to null (played to the
end). These drive mid-game regeneration.

## Solver

Pure TypeScript in `lib/solver/`. No I/O, no framework imports. Runs in the
browser so Reshuffle is instant and the app works on bad cell signal at the
diamond.

### `validateRoster(present) → RosterStatus`

Computes `maxFielders`, `femaleSpots`, auto-out slots, and a list of blocking
problems (below default minimum) and warnings (fielding fewer than 10, subs
forced to field).

### `buildBattingOrder(present, history) → BattingOrder`

1. Compute `N` and `femaleSpots(N)`.
2. Enumerate legal gender patterns — circular arrangements satisfying "≤2 in a row
   except one run of 3" and "≥3 female spots in the first 10". For realistic N
   (10–20) this space is small enough to enumerate directly.
3. Assign real players into the pattern's slots, scoring candidates against the
   last 4 games' slot history to rotate people off leadoff and last.
4. Mark auto-out slots when fewer than 3 women are present.

### `buildFieldingGrid(present, pins, options) → FieldingGrid`

Seeded greedy construction plus randomised restarts:

1. Determine active positions for this game from `maxFielders` and the drop order.
2. For each restart (default **300**), for each inning, fill positions
   scarcest-first — the position with the fewest eligible available players goes
   first. Break ties with the seeded RNG.
3. Reject any partial assignment that cannot satisfy the gender counts; backtrack
   within the inning.
4. Score the completed grid with the weighted objective below; keep the best.

**Hard constraints** (never violated):

- A player occupies at most one position per inning.
- A position holds at most one player per inning.
- A player is only assigned to a position in their eligible list.
- `malesOnField ≤ 7` and `femalesOnField ≥ min(3, femalesAvailable)` every inning.
- Pinned cells are honoured exactly.
- A player is unavailable before `arrived_inning` and after `left_inning`.

**Eligibility escape hatch.** If eligibility makes the problem infeasible — nobody
present can play catcher, say — the solver relaxes eligibility for the offending
position only, assigns anyone available with a large score penalty, and returns a
warning naming the position. It never returns "no solution" when a legal-by-league-
rules lineup exists.

**Scoring** (weights are named constants in `lib/rules/config.ts`):

| Term | Definition |
|---|---|
| Equal innings | negative variance of fielded innings across present non-sub players |
| Position variety | penalty per player-position pair used more than twice |
| Skill fit | +1 per Primary assignment, +0.5 per Backup |
| Sub minimisation | penalty per inning fielded by a sub |
| Relaxation | large penalty per eligibility-relaxed assignment |

### Mid-game regeneration

`buildFieldingGrid` takes a `lockedThroughInning` argument. Innings at or before it
are copied verbatim from the existing grid and count toward the fairness
accounting; only later innings are re-solved. Someone arriving in inning 3 is
modelled as `arrived_inning = 3` and the grid is regenerated from inning 3 onward.

## UI

Next.js App Router. Three screens.

**Roster** — list of players with a sub badge and a female badge. Add/edit a
player. Position eligibility is a row of 10 chips; tapping one cycles
none → backup → primary. Deactivate rather than delete, so history survives.

**Game** — create a game (date, opponent). Checklist of every active player;
check who's coming. Blocking banner if below default minimum. Generate button.

**Lineup** — the 7×10 grid and the batting order side by side.

- **Reshuffle** — re-solve with a new seed.
- **Drag-swap** — drag one cell onto another to swap the two players. Re-validates
  immediately; a swap that breaks the 3F/7M rule is rejected with an inline reason.
- **Pin** — long-press/click a cell to pin it. Pinned cells survive Reshuffle.
- **Mid-game** — mark a player as arrived-late or left-early, then regenerate the
  remaining innings.
- Per-player summary column: innings played, positions covered, batting slot.

Mobile-first. This is used standing on a diamond holding a phone.

## Stack

- **Next.js 15** App Router, TypeScript, Tailwind, shadcn/ui
- **Drizzle ORM** over **postgres.js**, connecting to Supabase's transaction
  pooler as the scoped `softball_app` role
- **Server Actions** for all reads and writes; the database connection string
  never reaches the client
- **Auth**: a single shared password in `APP_PASSWORD`, checked by middleware,
  which sets a signed httpOnly cookie. Enough for a one-user hobby app; not
  presented as more than that.
- **Vercel** deployment
- **Vitest** plus **fast-check** for tests

## Setup prerequisites

These run once, by hand, in the Tracker project's Supabase SQL editor — the
`softball_app` role cannot create its own schema or role:

1. `CREATE SCHEMA softball;`
2. `CREATE ROLE softball_app LOGIN PASSWORD '…';`
3. `GRANT USAGE, CREATE ON SCHEMA softball TO softball_app;`
   `GRANT ALL ON ALL TABLES IN SCHEMA softball TO softball_app;`
   `ALTER DEFAULT PRIVILEGES IN SCHEMA softball GRANT ALL ON TABLES TO softball_app;`
4. Confirm the role has **no** grants on `public` —
   `REVOKE ALL ON SCHEMA public FROM softball_app;`

The connection string uses Supabase's transaction pooler on port 6543 with the
`softball_app.<project-ref>` username form. Drizzle migrations then run as that
role and can only touch `softball`.

## Error handling

- **Below default minimum** — blocking banner naming exactly what's missing
  ("6 players, need 7" / "1 female player, need 2"). Generation is disabled.
- **Fewer than 10 fielders** — informational banner explaining the 7 M/X cap and
  which positions were dropped.
- **Sub forced to field** — banner naming the sub and the reason.
- **Eligibility relaxed** — banner naming the position nobody can cover.
- **Database unreachable** — the solver is client-side and pure, so generation
  still works from already-loaded roster data; saving shows a retry.

## Testing

The solver is a pure function, which is where the confidence comes from.

**Property-based** (`fast-check`): generate random rosters — varying size, gender
mix, sub mix, position coverage, arrival/departure innings — and assert that
**every** output satisfies **every** hard constraint. This is the primary defence.

**Fixture tests**: every row of the rulebook's batting-order chart becomes an
assertion. The scenarios discussed during design become named tests:

- 12 roster players, 2 female, 1 female sub → sub fields, 9 on the field
- Exactly 3 women, 13 batters → women repeat in the order, no auto-outs
- 2 women, 10 batters → 3 female spots, 1 auto-out per cycle
- 7 players including 2 female → legal, minimum
- 6 players → blocked as a default

**Fairness regression**: for a typical roster, assert the innings spread across
roster players is ≤ 1 and that no player is assigned the same position more than
3 times in 7 innings.

## Out of scope

- Season-long fairness tracking (batting-order rotation is the only cross-game state)
- Player logins, availability polling, notifications
- Score tracking, stats, standings
- Multiple teams
