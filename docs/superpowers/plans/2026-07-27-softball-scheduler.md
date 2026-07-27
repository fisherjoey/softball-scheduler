# Softball Lineup Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a legal, fair 7-inning fielding grid and batting order for a CSSC co-ed slo-pitch team from a persistent roster of players and subs.

**Architecture:** A pure-TypeScript solver (`lib/solver/`) with zero I/O does all the work — seeded greedy construction plus randomised restarts scored on a weighted fairness objective. Next.js App Router wraps it in three screens; Drizzle over postgres.js persists roster and game history to a dedicated `softball` schema in the existing Tracker Supabase project. The solver runs client-side so Reshuffle is instant and the app works on bad cell signal at the diamond.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, Drizzle ORM, postgres.js, Vitest, fast-check, Vercel.

**Spec:** `docs/superpowers/specs/2026-07-27-softball-scheduler-design.md`

## Global Constraints

- Every league rule parameter lives in `lib/rules/config.ts`. No rule number is hardcoded anywhere else.
- `lib/solver/**` and `lib/rules/**` are pure: no `import` of anything from `next`, `react`, `drizzle`, `postgres`, or `node:*`. No `Date.now()`, no `Math.random()` — all randomness comes from an injected seeded RNG so results are reproducible.
- The database role is `softball_app`, scoped to the `softball` schema only. The Supabase service-role key is never used and never appears in this repo.
- The database connection string is server-only. It must never be imported into a `'use client'` module.
- All positions use the exact string literals `'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'ROVER'`.
- Female minimums count anyone who identifies as female; `is_female` is the single flag. M and X are both "not female" for rule purposes.
- Innings are 1-based everywhere (inning 1 through 7).
- Mobile-first. Every screen must be usable one-handed on a phone.

---

### Task 1: Scaffold, types, and rules config

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`
- Create: `lib/types.ts`
- Create: `lib/rules/config.ts`
- Create: `lib/rules/femaleSpots.ts`
- Test: `lib/rules/femaleSpots.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: every type below, plus `RULES`, `WEIGHTS`, `femaleSpotsRequired(n: number): number`

- [ ] **Step 1: Scaffold the Next.js app**

```bash
cd /home/joey/dev/personal/softball-scheduler
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias="@/*" --no-turbopack --yes
npm install drizzle-orm postgres
npm install -D drizzle-kit vitest fast-check @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event
```

If `create-next-app` refuses because the directory is non-empty, that is expected — the repo already has `docs/` and `.gitignore`. Answer yes to proceeding, or scaffold into a temp dir and move the files in. Do not delete `docs/`.

- [ ] **Step 2: Add the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['{lib,app,components}/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 3: Write `lib/types.ts`**

```ts
export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'ROVER'] as const
export type Position = (typeof POSITIONS)[number]

export type Tier = 'primary' | 'backup'

export interface Player {
  id: string
  name: string
  isFemale: boolean
  isSub: boolean
  isActive: boolean
  /** Positions this player is eligible for. Absent key means not eligible. */
  positions: Partial<Record<Position, Tier>>
}

/** A player marked present for a specific game. */
export interface PresentPlayer extends Player {
  /** First inning they are available for. 1-based. Defaults to 1. */
  arrivedInning: number
  /** Last inning they are available for, inclusive. null means to the end. */
  leftInning: number | null
}

export interface RosterStatus {
  playerCount: number
  femaleCount: number
  /** How many players may legally take the field. */
  maxFielders: number
  /** Positions in play this game, after the drop order is applied. */
  activePositions: Position[]
  /** Females required on the field each inning. */
  requiredFemalesOnField: number
  /** Female slots the batting order must contain. */
  femaleSpots: number
  /** True when the team is below the league default minimum. */
  isDefault: boolean
  /** Reasons generation is impossible. Non-empty means do not generate. */
  blockers: string[]
  /** Things the captain should know but that do not prevent generation. */
  warnings: string[]
}

export type BattingSlot =
  | { kind: 'player'; playerId: string }
  | { kind: 'autoOut' }

export interface BattingOrder {
  slots: BattingSlot[]
  /** Per-slot gender pattern the order was built against. */
  pattern: ('F' | 'M')[]
  warnings: string[]
}

/** One player's batting slots across recent games, most recent first. */
export interface SlotHistory {
  playerId: string
  /** 0-based slot index in each of the last N games. */
  slots: number[]
}

export interface Pin {
  inning: number
  position: Position
  playerId: string
}

/** assignments[inning - 1][position] = playerId */
export type InningAssignment = Partial<Record<Position, string>>

export interface FieldingGrid {
  innings: number
  assignments: InningAssignment[]
  warnings: string[]
  score: number
  seed: number
}

export interface FieldingInput {
  present: PresentPlayer[]
  innings: number
  pins: Pin[]
  seed: number
  restarts?: number
  /** Innings 1..lockedThroughInning are copied from existingGrid verbatim. */
  lockedThroughInning?: number
  existingGrid?: FieldingGrid
}

export interface BattingInput {
  present: PresentPlayer[]
  history: SlotHistory[]
  seed: number
}
```

- [ ] **Step 4: Write `lib/rules/config.ts`**

```ts
import type { Position } from '@/lib/types'

/** Every CSSC rule parameter. Change values here, never in solver code. */
export const RULES = {
  /** A full defence. */
  fullFieldSize: 10,
  /** Hard cap on M/X players on the field at once. */
  maxMalesOnField: 7,
  /** Females required on the field when a full roster is available. */
  minFemalesOnField: 3,
  /** Below this many players the game is a default. */
  defaultMinPlayers: 7,
  /** Below this many female players the game is a default. */
  defaultMinFemales: 2,
  /** League game length. Tournament play is 6. */
  inningsPerGame: 7,
  /** Female slots required within the first N slots of the batting order. */
  femaleSpotsInOpening: { count: 3, within: 10 },
  /** Longest permitted run of one gender in the batting order. */
  maxSameGenderRun: 3,
  /** How many runs of maxSameGenderRun length are permitted, order-wide. */
  maxRunsAtMaxLength: 1,
  /** Every Nth female slot becomes an automatic out when short on women. */
  autoOutEveryNthFemaleSpot: 3,
  /** Positions surrendered first when fielding fewer than 10. */
  positionDropOrder: ['ROVER', 'RF'] as Position[],
} as const

/** Fairness objective weights. Higher means the solver cares more. */
export const WEIGHTS = {
  /** Penalty per unit of variance in innings played across roster players. */
  equalInnings: 10,
  /** Penalty each time a player exceeds this many innings at one position. */
  positionRepeatThreshold: 2,
  positionRepeat: 3,
  /** Reward per assignment at a Primary position. */
  primaryFit: 2,
  /** Reward per assignment at a Backup position. */
  backupFit: 1,
  /** Penalty per inning a sub spends on the field. */
  subOnField: 8,
  /** Penalty per assignment that ignored a player's eligibility list. */
  eligibilityRelaxed: 1000,
  /** Penalty for reusing a batting slot a player held in a recent game. */
  battingSlotRepeat: 5,
} as const

export const SOLVER = {
  /** Randomised restarts per generation. */
  restarts: 300,
  /** Retries of a single inning before abandoning a restart. */
  inningRetries: 20,
  /** Cap on enumerated batting-order gender patterns. */
  maxPatternCandidates: 2000,
} as const
```

- [ ] **Step 5: Write the failing test for `femaleSpotsRequired`**

Create `lib/rules/femaleSpots.test.ts`. Every row is straight from the CSSC rulebook's published chart:

```ts
import { describe, it, expect } from 'vitest'
import { femaleSpotsRequired } from './femaleSpots'

describe('femaleSpotsRequired', () => {
  // Verbatim from the CSSC rulebook batting-order chart.
  it.each([
    [10, 3],
    [11, 4],
    [12, 4],
    [13, 4],
    [14, 5],
    [15, 5],
  ])('a %i-player order needs %i female spots', (n, expected) => {
    expect(femaleSpotsRequired(n)).toBe(expected)
  })

  it('never drops below 3, even for short orders', () => {
    expect(femaleSpotsRequired(7)).toBe(3)
    expect(femaleSpotsRequired(8)).toBe(3)
    expect(femaleSpotsRequired(9)).toBe(3)
  })

  it('keeps every male run at 2 or fewer, except one run of 3', () => {
    // The formula exists to satisfy: males <= 2 * femaleSpots + 1
    for (let n = 7; n <= 30; n++) {
      const f = femaleSpotsRequired(n)
      expect(n - f).toBeLessThanOrEqual(2 * f + 1)
    }
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run lib/rules/femaleSpots.test.ts`
Expected: FAIL — cannot find module `./femaleSpots`.

- [ ] **Step 7: Write `lib/rules/femaleSpots.ts`**

```ts
import { RULES } from './config'

/**
 * How many female slots a batting order of `n` players must contain.
 *
 * The order is circular. F female slots split it into F gaps of consecutive
 * males. Every gap must be at most 2, except one gap of exactly 3. So for M
 * males: M <= 2F + 1, and with M = n - F that solves to F >= (n - 1) / 3.
 *
 * This reproduces the CSSC published chart exactly.
 */
export function femaleSpotsRequired(n: number): number {
  const floor = RULES.femaleSpotsInOpening.count
  return Math.max(floor, Math.ceil((n - 1) / RULES.maxSameGenderRun))
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run lib/rules/femaleSpots.test.ts`
Expected: PASS, 3 test blocks / 9 assertions.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold app, types, and CSSC rules config"
```

---

### Task 2: Seeded RNG

**Files:**
- Create: `lib/solver/rng.ts`
- Test: `lib/solver/rng.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `makeRng(seed: number): Rng` where `Rng` is `{ next(): number; int(maxExclusive: number): number; shuffle<T>(items: T[]): T[] }`. `next()` returns a float in [0, 1). `shuffle` returns a new array and does not mutate its input.

- [ ] **Step 1: Write the failing test**

Create `lib/solver/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeRng } from './rng'

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('differs across seeds', () => {
    const a = Array.from({ length: 20 }, (_, i) => makeRng(1).next())
    const b = Array.from({ length: 20 }, (_, i) => makeRng(2).next())
    expect(a).not.toEqual(b)
  })

  it('produces floats in [0, 1)', () => {
    const r = makeRng(7)
    for (let i = 0; i < 1000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int(n) stays in range', () => {
    const r = makeRng(9)
    for (let i = 0; i < 1000; i++) {
      const v = r.int(5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(5)
    }
  })

  it('shuffle keeps every element and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const copy = [...input]
    const out = makeRng(3).shuffle(input)
    expect(input).toEqual(copy)
    expect([...out].sort((x, y) => x - y)).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/solver/rng.test.ts`
Expected: FAIL — cannot find module `./rng`.

- [ ] **Step 3: Write `lib/solver/rng.ts`**

```ts
export interface Rng {
  next(): number
  int(maxExclusive: number): number
  shuffle<T>(items: readonly T[]): T[]
}

/** mulberry32 — small, fast, good enough, and fully deterministic. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive)
  const shuffle = <T,>(items: readonly T[]): T[] => {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return { next, int, shuffle }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/solver/rng.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add seeded RNG for reproducible lineups"
```

---

### Task 3: Roster validation

**Files:**
- Create: `lib/solver/validateRoster.ts`
- Test: `lib/solver/validateRoster.test.ts`

**Interfaces:**
- Consumes: `Player`, `PresentPlayer`, `RosterStatus`, `Position` from `@/lib/types`; `RULES` from `@/lib/rules/config`; `femaleSpotsRequired` from `@/lib/rules/femaleSpots`
- Produces: `validateRoster(present: PresentPlayer[]): RosterStatus`

- [ ] **Step 1: Write the failing test**

Create `lib/solver/validateRoster.test.ts`. Add this shared helper at the top — later tasks import it from here, so export it:

```ts
import { describe, it, expect } from 'vitest'
import { validateRoster } from './validateRoster'
import { POSITIONS, type PresentPlayer, type Position, type Tier } from '@/lib/types'

/** Build a present player. Defaults to eligible for every position, primary. */
export function mkPlayer(
  id: string,
  opts: Partial<Omit<PresentPlayer, 'id'>> = {},
): PresentPlayer {
  const positions =
    opts.positions ??
    (Object.fromEntries(POSITIONS.map((p) => [p, 'primary' as Tier])) as Partial<
      Record<Position, Tier>
    >)
  return {
    id,
    name: opts.name ?? id,
    isFemale: opts.isFemale ?? false,
    isSub: opts.isSub ?? false,
    isActive: opts.isActive ?? true,
    positions,
    arrivedInning: opts.arrivedInning ?? 1,
    leftInning: opts.leftInning ?? null,
  }
}

/** n players, the first `females` of them female, the last `subs` of them subs. */
export function mkRoster(n: number, females: number, subs = 0): PresentPlayer[] {
  return Array.from({ length: n }, (_, i) =>
    mkPlayer(`p${i}`, { isFemale: i < females, isSub: i >= n - subs }),
  )
}

describe('validateRoster', () => {
  it('fields 10 with 3 or more women', () => {
    const s = validateRoster(mkRoster(12, 4))
    expect(s.maxFielders).toBe(10)
    expect(s.activePositions).toHaveLength(10)
    expect(s.requiredFemalesOnField).toBe(3)
    expect(s.isDefault).toBe(false)
    expect(s.blockers).toEqual([])
  })

  it('fields only 9 with exactly 2 women, dropping ROVER', () => {
    const s = validateRoster(mkRoster(12, 2))
    expect(s.maxFielders).toBe(9)
    expect(s.activePositions).not.toContain('ROVER')
    expect(s.activePositions).toContain('RF')
    expect(s.activePositions).toHaveLength(9)
    expect(s.requiredFemalesOnField).toBe(2)
    expect(s.isDefault).toBe(false)
    expect(s.warnings.join(' ')).toMatch(/9/)
  })

  it('fields only 8 with exactly 1 woman, dropping ROVER and RF', () => {
    const s = validateRoster(mkRoster(12, 1))
    expect(s.maxFielders).toBe(8)
    expect(s.activePositions).not.toContain('ROVER')
    expect(s.activePositions).not.toContain('RF')
    expect(s.activePositions).toHaveLength(8)
  })

  it('blocks below 7 players', () => {
    const s = validateRoster(mkRoster(6, 3))
    expect(s.isDefault).toBe(true)
    expect(s.blockers.join(' ')).toMatch(/6 players/)
  })

  it('blocks below 2 female players', () => {
    const s = validateRoster(mkRoster(10, 1))
    expect(s.isDefault).toBe(true)
    expect(s.blockers.join(' ')).toMatch(/female/i)
  })

  it('allows exactly the league minimum: 7 players, 2 female', () => {
    const s = validateRoster(mkRoster(7, 2))
    expect(s.isDefault).toBe(false)
    expect(s.blockers).toEqual([])
    expect(s.maxFielders).toBe(7)
  })

  it('never fields more players than are present', () => {
    const s = validateRoster(mkRoster(8, 4))
    expect(s.maxFielders).toBe(8)
  })

  it('reports the female spots the batting order needs', () => {
    expect(validateRoster(mkRoster(13, 4)).femaleSpots).toBe(4)
    expect(validateRoster(mkRoster(10, 3)).femaleSpots).toBe(3)
  })

  it('warns when a sub will be forced onto the field', () => {
    // 12 roster players but only 2 of them female, plus 1 female sub.
    const roster = Array.from({ length: 12 }, (_, i) =>
      mkPlayer(`r${i}`, { isFemale: i < 2 }),
    )
    const sub = mkPlayer('sub1', { isFemale: true, isSub: true })
    const s = validateRoster([...roster, sub])
    expect(s.maxFielders).toBe(10)
    expect(s.requiredFemalesOnField).toBe(3)
    expect(s.warnings.join(' ')).toMatch(/sub/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/solver/validateRoster.test.ts`
Expected: FAIL — cannot find module `./validateRoster`.

- [ ] **Step 3: Write `lib/solver/validateRoster.ts`**

```ts
import { POSITIONS, type Position, type PresentPlayer, type RosterStatus } from '@/lib/types'
import { RULES } from '@/lib/rules/config'
import { femaleSpotsRequired } from '@/lib/rules/femaleSpots'

/**
 * Derive every roster-level number the solvers need, plus the banners the UI
 * shows. This is the single place that answers "how many can we field?".
 */
export function validateRoster(present: PresentPlayer[]): RosterStatus {
  const playerCount = present.length
  const femaleCount = present.filter((p) => p.isFemale).length
  const blockers: string[] = []
  const warnings: string[] = []

  if (playerCount < RULES.defaultMinPlayers) {
    blockers.push(
      `Only ${playerCount} players — the league minimum is ${RULES.defaultMinPlayers}. This is a default.`,
    )
  }
  if (femaleCount < RULES.defaultMinFemales) {
    blockers.push(
      `Only ${femaleCount} female player${femaleCount === 1 ? '' : 's'} — the league minimum is ${RULES.defaultMinFemales}. This is a default.`,
    )
  }

  // The 7 M/X cap is what actually limits the defence when women are short.
  const maxFielders = Math.min(
    RULES.fullFieldSize,
    playerCount,
    femaleCount + RULES.maxMalesOnField,
  )
  const requiredFemalesOnField = Math.min(RULES.minFemalesOnField, femaleCount, maxFielders)

  const dropCount = RULES.fullFieldSize - maxFielders
  const dropped = RULES.positionDropOrder.slice(0, dropCount)
  const activePositions: Position[] = POSITIONS.filter((p) => !dropped.includes(p))

  if (maxFielders < RULES.fullFieldSize && blockers.length === 0) {
    warnings.push(
      `Fielding ${maxFielders}, not ${RULES.fullFieldSize}. With ${femaleCount} female player${femaleCount === 1 ? '' : 's'} the ${RULES.maxMalesOnField} M/X cap limits the defence. Dropping ${dropped.join(' and ')}.`,
    )
  }

  // A sub is forced onto the field when the roster alone cannot fill the
  // defence, or cannot supply the required women.
  const rosterPlayers = present.filter((p) => !p.isSub)
  const rosterFemales = rosterPlayers.filter((p) => p.isFemale).length
  if (rosterPlayers.length < maxFielders) {
    warnings.push(
      `Only ${rosterPlayers.length} roster players — subs will have to field to reach ${maxFielders}.`,
    )
  } else if (rosterFemales < requiredFemalesOnField) {
    warnings.push(
      `Only ${rosterFemales} female roster player${rosterFemales === 1 ? '' : 's'} — a female sub has to field to meet the ${requiredFemalesOnField}-women minimum.`,
    )
  }

  return {
    playerCount,
    femaleCount,
    maxFielders,
    activePositions,
    requiredFemalesOnField,
    femaleSpots: femaleSpotsRequired(playerCount),
    isDefault: blockers.length > 0,
    blockers,
    warnings,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/solver/validateRoster.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: roster validation for field size, defaults, and warnings"
```

---

### Task 4: Batting order gender patterns

**Files:**
- Create: `lib/solver/genderPattern.ts`
- Test: `lib/solver/genderPattern.test.ts`

**Interfaces:**
- Consumes: `RULES`, `SOLVER` from `@/lib/rules/config`; `femaleSpotsRequired`; `Rng` from `@/lib/solver/rng`
- Produces:
  - `circularRuns(pattern: ('F' | 'M')[]): number[]` — run lengths around the circle
  - `isValidGenderPattern(pattern: ('F' | 'M')[]): boolean`
  - `enumerateGenderPatterns(n: number, femaleSpots: number, rng: Rng): ('F' | 'M')[][]` — up to `SOLVER.maxPatternCandidates` valid patterns

- [ ] **Step 1: Write the failing test**

Create `lib/solver/genderPattern.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { circularRuns, isValidGenderPattern, enumerateGenderPatterns } from './genderPattern'
import { femaleSpotsRequired } from '@/lib/rules/femaleSpots'
import { makeRng } from './rng'

const parse = (s: string) => s.split('') as ('F' | 'M')[]

describe('circularRuns', () => {
  it('wraps from the bottom of the order back to the top', () => {
    // The M at the end and the M at the start are adjacent: one run of 2.
    expect(circularRuns(parse('MFFM'))).toEqual([2, 2])
  })

  it('returns a single run when every slot is the same gender', () => {
    expect(circularRuns(parse('MMMM'))).toEqual([4])
  })

  it('run lengths always sum to the order length', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<'F' | 'M'>('F', 'M'), { minLength: 1, maxLength: 24 }), (p) => {
        const total = circularRuns(p).reduce((a, b) => a + b, 0)
        return total === p.length
      }),
    )
  })
})

describe('isValidGenderPattern', () => {
  it('accepts the rulebook example for 10 players', () => {
    // P1-F-P2-P3-P4-F-P5-P6-F-P7
    expect(isValidGenderPattern(parse('MFMMMFMMFM'))).toBe(true)
  })

  it('accepts the second rulebook example for 10 players', () => {
    // P1-P2-F-P3-P4-P5-F-P6-P7-F
    expect(isValidGenderPattern(parse('MMFMMMFMMF'))).toBe(true)
  })

  it('accepts the rulebook example for 15 players', () => {
    // P1-P2-F-P3-P4-F-P5-P6-F-P7-P8-F-P9-P10-F
    expect(isValidGenderPattern(parse('MMFMMFMMFMMFMMF'))).toBe(true)
  })

  it('rejects four men in a row', () => {
    expect(isValidGenderPattern(parse('MMMMFFMFMF'))).toBe(false)
  })

  it('rejects two separate runs of three', () => {
    expect(isValidGenderPattern(parse('MMMFMMMFFF'))).toBe(false)
  })

  it('rejects a run of three created only by the wraparound', () => {
    // Reads as 2 men at the end + 1 at the start = 3, plus an existing run of 3.
    expect(isValidGenderPattern(parse('MFMMMFFFMM'))).toBe(false)
  })

  it('rejects fewer than 3 female slots in the first 10', () => {
    expect(isValidGenderPattern(parse('MMFMMFMMMMFF'))).toBe(false)
  })

  it('counts a run of three women against the one-run allowance', () => {
    expect(isValidGenderPattern(parse('FFFMMMFMFM'))).toBe(false)
  })
})

describe('enumerateGenderPatterns', () => {
  it('every returned pattern is valid and has the right female count', () => {
    for (const n of [10, 11, 12, 13, 14, 15]) {
      const f = femaleSpotsRequired(n)
      const patterns = enumerateGenderPatterns(n, f, makeRng(1))
      expect(patterns.length).toBeGreaterThan(0)
      for (const p of patterns) {
        expect(p).toHaveLength(n)
        expect(p.filter((g) => g === 'F')).toHaveLength(f)
        expect(isValidGenderPattern(p)).toBe(true)
      }
    }
  })

  it('finds a solution at every roster size from the league minimum up', () => {
    for (let n = 7; n <= 24; n++) {
      const patterns = enumerateGenderPatterns(n, femaleSpotsRequired(n), makeRng(n))
      expect(patterns.length).toBeGreaterThan(0)
    }
  })

  it('is deterministic for a given seed', () => {
    const a = enumerateGenderPatterns(13, 4, makeRng(5))
    const b = enumerateGenderPatterns(13, 4, makeRng(5))
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/solver/genderPattern.test.ts`
Expected: FAIL — cannot find module `./genderPattern`.

- [ ] **Step 3: Write `lib/solver/genderPattern.ts`**

```ts
import { RULES, SOLVER } from '@/lib/rules/config'
import type { Rng } from './rng'

export type Gender = 'F' | 'M'

/**
 * Run lengths around the circular batting order. The order wraps, so the
 * players at the bottom and the top are adjacent.
 */
export function circularRuns(pattern: Gender[]): number[] {
  const n = pattern.length
  if (n === 0) return []
  const allSame = pattern.every((g) => g === pattern[0])
  if (allSame) return [n]

  // Rotate to a boundary so runs are not split across the array edge.
  let start = 0
  while (pattern[start] === pattern[(start - 1 + n) % n]) start++

  const runs: number[] = []
  let current = 1
  for (let k = 1; k <= n; k++) {
    const idx = (start + k) % n
    const prev = (start + k - 1) % n
    if (k < n && pattern[idx] === pattern[prev]) {
      current++
    } else {
      runs.push(current)
      current = 1
    }
  }
  return runs
}

/**
 * A pattern is legal when:
 *  - at most one run reaches maxSameGenderRun, and none exceeds it (either gender)
 *  - the opening slots contain the required number of female spots
 */
export function isValidGenderPattern(pattern: Gender[]): boolean {
  if (pattern.length === 0) return false

  const runs = circularRuns(pattern)
  if (runs.some((r) => r > RULES.maxSameGenderRun)) return false
  if (runs.filter((r) => r === RULES.maxSameGenderRun).length > RULES.maxRunsAtMaxLength) {
    return false
  }

  const { count, within } = RULES.femaleSpotsInOpening
  const window = Math.min(within, pattern.length)
  const femalesInOpening = pattern.slice(0, window).filter((g) => g === 'F').length
  if (femalesInOpening < count) return false

  return true
}

/**
 * Valid patterns of length `n` with exactly `femaleSpots` female slots.
 *
 * Enumerates combinations of female slot indices in a seeded-random order and
 * keeps the valid ones, stopping at SOLVER.maxPatternCandidates. Slot 0 is
 * pinned to 'M' only when that still leaves a solution — see the fallback pass.
 */
export function enumerateGenderPatterns(
  n: number,
  femaleSpots: number,
  rng: Rng,
): Gender[][] {
  const found: Gender[][] = []
  const seen = new Set<string>()

  const indices = Array.from({ length: n }, (_, i) => i)
  // Randomised combination sampling: shuffle, take the first `femaleSpots`.
  // Cheap, unbiased enough, and avoids materialising C(n, f) combinations.
  const attempts = Math.min(50_000, SOLVER.maxPatternCandidates * 25)
  for (let a = 0; a < attempts && found.length < SOLVER.maxPatternCandidates; a++) {
    const picked = rng.shuffle(indices).slice(0, femaleSpots)
    const key = [...picked].sort((x, y) => x - y).join(',')
    if (seen.has(key)) continue
    seen.add(key)

    const pattern: Gender[] = Array.from({ length: n }, () => 'M')
    for (const i of picked) pattern[i] = 'F'
    if (isValidGenderPattern(pattern)) found.push(pattern)
  }

  return found
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/solver/genderPattern.test.ts`
Expected: PASS, 14 tests.

If `enumerateGenderPatterns` returns zero patterns for some `n`, the random sampling is too sparse — replace the sampling loop with exhaustive combination generation for `n <= 20` and keep sampling above that. Do not lower the validity rules to make the test pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: enumerate and validate legal batting-order gender patterns"
```

---

### Task 5: Batting order solver

**Files:**
- Create: `lib/solver/buildBattingOrder.ts`
- Test: `lib/solver/buildBattingOrder.test.ts`

**Interfaces:**
- Consumes: `BattingInput`, `BattingOrder`, `BattingSlot`, `SlotHistory`, `PresentPlayer`; `validateRoster`; `enumerateGenderPatterns`, `isValidGenderPattern`; `makeRng`; `RULES`, `WEIGHTS`
- Produces: `buildBattingOrder(input: BattingInput): BattingOrder`

- [ ] **Step 1: Write the failing test**

Create `lib/solver/buildBattingOrder.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildBattingOrder } from './buildBattingOrder'
import { isValidGenderPattern } from './genderPattern'
import { mkPlayer, mkRoster } from './validateRoster.test'
import type { BattingOrder, PresentPlayer } from '@/lib/types'

const genderOf = (order: BattingOrder, present: PresentPlayer[]) =>
  order.slots.map((s) => {
    if (s.kind === 'autoOut') return 'F' as const
    return present.find((p) => p.id === s.playerId)!.isFemale ? ('F' as const) : ('M' as const)
  })

describe('buildBattingOrder', () => {
  it('bats every player present exactly once when there are enough women', () => {
    const present = mkRoster(13, 5)
    const order = buildBattingOrder({ present, history: [], seed: 1 })
    const ids = order.slots.filter((s) => s.kind === 'player').map((s: any) => s.playerId)
    expect(new Set(ids).size).toBe(13)
    expect(order.slots).toHaveLength(13)
  })

  it('produces a legal gender pattern', () => {
    const present = mkRoster(13, 5)
    const order = buildBattingOrder({ present, history: [], seed: 1 })
    expect(isValidGenderPattern(genderOf(order, present))).toBe(true)
  })

  it('repeats women when exactly 3 are present and more female spots are needed', () => {
    // 13 batters need 4 female spots but only 3 women are present.
    const present = mkRoster(13, 3)
    const order = buildBattingOrder({ present, history: [], seed: 2 })
    expect(order.slots.filter((s) => s.kind === 'autoOut')).toHaveLength(0)
    const femaleIds = order.slots
      .filter((s) => s.kind === 'player')
      .map((s: any) => s.playerId)
      .filter((id) => present.find((p) => p.id === id)!.isFemale)
    expect(femaleIds).toHaveLength(4)
    expect(new Set(femaleIds).size).toBe(3) // one woman bats twice
    // Every man still bats exactly once.
    const maleIds = order.slots
      .filter((s) => s.kind === 'player')
      .map((s: any) => s.playerId)
      .filter((id) => !present.find((p) => p.id === id)!.isFemale)
    expect(new Set(maleIds).size).toBe(10)
  })

  it('inserts an automatic out at every 3rd female spot when only 2 women are present', () => {
    // 10 batters need 3 female spots; with 2 women, spot 3 is an out.
    const present = mkRoster(10, 2)
    const order = buildBattingOrder({ present, history: [], seed: 3 })
    expect(order.slots.filter((s) => s.kind === 'autoOut')).toHaveLength(1)
    expect(order.warnings.join(' ')).toMatch(/automatic out/i)
  })

  it('rotates players off slots they held in recent games', () => {
    const present = mkRoster(12, 4)
    // p4 (male) led off the last three games.
    const history = [{ playerId: 'p4', slots: [0, 0, 0] }]
    const withHistory = buildBattingOrder({ present, history, seed: 4 })
    const slotOfP4 = withHistory.slots.findIndex(
      (s) => s.kind === 'player' && s.playerId === 'p4',
    )
    expect(slotOfP4).not.toBe(0)
  })

  it('is deterministic for a given seed', () => {
    const present = mkRoster(14, 5)
    const a = buildBattingOrder({ present, history: [], seed: 9 })
    const b = buildBattingOrder({ present, history: [], seed: 9 })
    expect(a).toEqual(b)
  })

  it('always returns a legal order for any legal roster', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 7, max: 22 }),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 1000 }),
        (n, rawFemales, seed) => {
          const females = Math.min(rawFemales, n)
          if (n - females < 1) return true // need at least one man to be realistic
          const present = mkRoster(n, females)
          const order = buildBattingOrder({ present, history: [], seed })
          const pattern = genderOf(order, present)
          return isValidGenderPattern(pattern)
        },
      ),
      { numRuns: 300 },
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/solver/buildBattingOrder.test.ts`
Expected: FAIL — cannot find module `./buildBattingOrder`.

- [ ] **Step 3: Write `lib/solver/buildBattingOrder.ts`**

```ts
import type { BattingInput, BattingOrder, BattingSlot, PresentPlayer } from '@/lib/types'
import { RULES, WEIGHTS } from '@/lib/rules/config'
import { femaleSpotsRequired } from '@/lib/rules/femaleSpots'
import { enumerateGenderPatterns, type Gender } from './genderPattern'
import { makeRng, type Rng } from './rng'

/**
 * Build the batting order.
 *
 * Everyone present bats. When the required number of female slots exceeds the
 * women available, the extra slots either repeat a woman (3+ women present) or
 * become automatic outs (fewer than 3 women present) — per CSSC rules.
 */
export function buildBattingOrder(input: BattingInput): BattingOrder {
  const { present, history, seed } = input
  const rng = makeRng(seed)
  const warnings: string[] = []

  const n = present.length
  const femaleSpots = femaleSpotsRequired(n)
  const women = present.filter((p) => p.isFemale)
  const men = present.filter((p) => !p.isFemale)

  const patterns = enumerateGenderPatterns(n, femaleSpots, rng)
  if (patterns.length === 0) {
    // Should be unreachable: femaleSpotsRequired guarantees a pattern exists.
    warnings.push('Could not find a legal batting-order pattern. Falling back to alternating.')
    const fallback: Gender[] = Array.from({ length: n }, (_, i) => (i % 3 === 2 ? 'F' : 'M'))
    return fillPattern(fallback, women, men, history, rng, warnings)
  }

  let best: BattingOrder | null = null
  let bestScore = -Infinity
  for (const pattern of patterns) {
    const candidate = fillPattern(pattern, women, men, history, rng, [...warnings])
    const score = scoreOrder(candidate, history)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best!
}

/** Place real players into a gender pattern's slots. */
function fillPattern(
  pattern: Gender[],
  women: PresentPlayer[],
  men: PresentPlayer[],
  history: BattingInput['history'],
  rng: Rng,
  warnings: string[],
): BattingOrder {
  const slots: BattingSlot[] = new Array(pattern.length)

  const shortOnWomen = women.length < RULES.minFemalesOnField
  const womenPool = rng.shuffle(women)
  const menPool = rng.shuffle(men)

  let femaleSpotIndex = 0
  let womanCursor = 0
  let manCursor = 0
  let autoOuts = 0

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === 'F') {
      femaleSpotIndex++
      if (shortOnWomen && femaleSpotIndex % RULES.autoOutEveryNthFemaleSpot === 0) {
        slots[i] = { kind: 'autoOut' }
        autoOuts++
        continue
      }
      // Women repeat in rotation once the pool is exhausted.
      slots[i] = { kind: 'player', playerId: womenPool[womanCursor % womenPool.length].id }
      womanCursor++
    } else {
      slots[i] = { kind: 'player', playerId: menPool[manCursor % menPool.length].id }
      manCursor++
    }
  }

  if (autoOuts > 0) {
    warnings.push(
      `Only ${women.length} female players — every ${RULES.autoOutEveryNthFemaleSpot}rd female slot is an automatic out (${autoOuts} this order).`,
    )
  }
  const repeats = womanCursor - womenPool.length
  if (repeats > 0) {
    warnings.push(
      `${repeats} female slot${repeats === 1 ? '' : 's'} filled by repeating a woman already in the order, as the rules allow.`,
    )
  }

  return { slots, pattern, warnings }
}

/** Higher is better. Penalises reusing a slot a player held recently. */
function scoreOrder(order: BattingOrder, history: BattingInput['history']): number {
  let score = 0
  const byPlayer = new Map(history.map((h) => [h.playerId, h.slots]))
  order.slots.forEach((slot, index) => {
    if (slot.kind !== 'player') return
    const recent = byPlayer.get(slot.playerId)
    if (!recent) return
    // Recency-weighted: the most recent game counts most.
    recent.forEach((prev, age) => {
      if (prev === index) score -= WEIGHTS.battingSlotRepeat / (age + 1)
    })
  })
  return score
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/solver/buildBattingOrder.test.ts`
Expected: PASS, 7 tests including the 300-run property test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: batting order solver with auto-outs and cross-game rotation"
```

---

### Task 6: Fielding grid solver

**Files:**
- Create: `lib/solver/buildFieldingGrid.ts`
- Create: `lib/solver/scoreGrid.ts`
- Test: `lib/solver/buildFieldingGrid.test.ts`

**Interfaces:**
- Consumes: `FieldingInput`, `FieldingGrid`, `InningAssignment`, `Pin`, `PresentPlayer`, `Position`; `validateRoster`; `makeRng`; `RULES`, `WEIGHTS`, `SOLVER`
- Produces:
  - `buildFieldingGrid(input: FieldingInput): FieldingGrid`
  - `scoreGrid(grid: Pick<FieldingGrid, 'assignments'>, present: PresentPlayer[], relaxedCount: number): number`
  - `isAvailable(player: PresentPlayer, inning: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/solver/buildFieldingGrid.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildFieldingGrid, isAvailable } from './buildFieldingGrid'
import { validateRoster } from './validateRoster'
import { mkPlayer, mkRoster } from './validateRoster.test'
import { RULES } from '@/lib/rules/config'
import { POSITIONS, type FieldingGrid, type PresentPlayer, type Position } from '@/lib/types'

/** Assert every hard constraint. Throws with a readable reason on failure. */
function assertLegal(grid: FieldingGrid, present: PresentPlayer[]) {
  const status = validateRoster(present)
  const byId = new Map(present.map((p) => [p.id, p]))

  grid.assignments.forEach((inningMap, idx) => {
    const inning = idx + 1
    const entries = Object.entries(inningMap) as [Position, string][]

    // Exactly the active positions are filled.
    expect(entries.map(([pos]) => pos).sort()).toEqual([...status.activePositions].sort())

    // No player appears twice in one inning.
    const ids = entries.map(([, id]) => id)
    expect(new Set(ids).size, `inning ${inning} double-assigns a player`).toBe(ids.length)

    // Availability.
    for (const id of ids) {
      expect(isAvailable(byId.get(id)!, inning), `${id} unavailable in inning ${inning}`).toBe(true)
    }

    // Gender counts.
    const females = ids.filter((id) => byId.get(id)!.isFemale).length
    const males = ids.length - females
    expect(males, `inning ${inning} has ${males} M/X`).toBeLessThanOrEqual(RULES.maxMalesOnField)
    expect(females, `inning ${inning} has ${females} women`).toBeGreaterThanOrEqual(
      status.requiredFemalesOnField,
    )
  })
}

describe('buildFieldingGrid', () => {
  it('fills every active position in every inning', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 1 })
    expect(grid.assignments).toHaveLength(7)
    assertLegal(grid, present)
  })

  it('fields 9 and never a 10th when only 2 women are present', () => {
    const present = mkRoster(13, 2)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 2 })
    for (const inning of grid.assignments) {
      expect(Object.keys(inning)).toHaveLength(9)
      expect(inning.ROVER).toBeUndefined()
    }
    assertLegal(grid, present)
  })

  it('keeps roster players off the bench before subs', () => {
    // 10 roster players + 2 subs, plenty of women. Subs should never field.
    const roster = Array.from({ length: 10 }, (_, i) =>
      mkPlayer(`r${i}`, { isFemale: i < 4 }),
    )
    const subs = [mkPlayer('s0', { isSub: true }), mkPlayer('s1', { isSub: true, isFemale: true })]
    const present = [...roster, ...subs]
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 3 })
    const subInnings = grid.assignments.flatMap((i) =>
      Object.values(i).filter((id) => id.startsWith('s')),
    )
    expect(subInnings).toHaveLength(0)
    assertLegal(grid, present)
  })

  it('puts a female sub on the field when the roster cannot supply 3 women', () => {
    // 12 roster players, only 2 female. One female sub.
    const roster = Array.from({ length: 12 }, (_, i) => mkPlayer(`r${i}`, { isFemale: i < 2 }))
    const sub = mkPlayer('sub1', { isFemale: true, isSub: true })
    const present = [...roster, sub]
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 4 })
    for (const inning of grid.assignments) {
      expect(Object.keys(inning)).toHaveLength(10)
      expect(Object.values(inning)).toContain('sub1')
    }
    assertLegal(grid, present)
  })

  it('spreads innings evenly across roster players', () => {
    const present = mkRoster(13, 5) // 13 present, 10 field, 3 sit each inning
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 5 })
    const counts = new Map<string, number>(present.map((p) => [p.id, 0]))
    for (const inning of grid.assignments) {
      for (const id of Object.values(inning)) counts.set(id, counts.get(id)! + 1)
    }
    const values = [...counts.values()]
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
  })

  it('does not park anyone at one position all game', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 6 })
    const seen = new Map<string, number>()
    for (const inning of grid.assignments) {
      for (const [pos, id] of Object.entries(inning)) {
        const key = `${id}:${pos}`
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
    }
    expect(Math.max(...seen.values())).toBeLessThanOrEqual(3)
  })

  it('honours pins exactly', () => {
    const present = mkRoster(13, 5)
    const pins = [
      { inning: 1, position: 'P' as Position, playerId: 'p5' },
      { inning: 2, position: 'P' as Position, playerId: 'p5' },
      { inning: 3, position: 'C' as Position, playerId: 'p6' },
    ]
    const grid = buildFieldingGrid({ present, innings: 7, pins, seed: 7 })
    expect(grid.assignments[0].P).toBe('p5')
    expect(grid.assignments[1].P).toBe('p5')
    expect(grid.assignments[2].C).toBe('p6')
    assertLegal(grid, present)
  })

  it('respects arrival and departure innings', () => {
    const present = mkRoster(13, 5)
    present[0] = { ...present[0], arrivedInning: 4 }
    present[1] = { ...present[1], leftInning: 3 }
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 8 })
    expect(Object.values(grid.assignments[0])).not.toContain(present[0].id)
    expect(Object.values(grid.assignments[2])).not.toContain(present[0].id)
    expect(Object.values(grid.assignments[3])).not.toContain(present[1].id)
    assertLegal(grid, present)
  })

  it('copies locked innings verbatim when regenerating mid-game', () => {
    const present = mkRoster(13, 5)
    const first = buildFieldingGrid({ present, innings: 7, pins: [], seed: 9 })
    const second = buildFieldingGrid({
      present,
      innings: 7,
      pins: [],
      seed: 99,
      lockedThroughInning: 3,
      existingGrid: first,
    })
    expect(second.assignments.slice(0, 3)).toEqual(first.assignments.slice(0, 3))
    assertLegal(second, present)
  })

  it('relaxes eligibility rather than failing when nobody can cover a position', () => {
    // Nobody is eligible at catcher.
    const positionsWithoutC = Object.fromEntries(
      POSITIONS.filter((p) => p !== 'C').map((p) => [p, 'primary' as const]),
    )
    const present = Array.from({ length: 13 }, (_, i) =>
      mkPlayer(`p${i}`, { isFemale: i < 5, positions: positionsWithoutC }),
    )
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 10 })
    for (const inning of grid.assignments) expect(inning.C).toBeDefined()
    expect(grid.warnings.join(' ')).toMatch(/C\b/)
    assertLegal(grid, present)
  })

  it('is deterministic for a given seed', () => {
    const present = mkRoster(14, 5)
    const a = buildFieldingGrid({ present, innings: 7, pins: [], seed: 11 })
    const b = buildFieldingGrid({ present, innings: 7, pins: [], seed: 11 })
    expect(a).toEqual(b)
  })

  it('produces a legal grid for any legal roster', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 7, max: 20 }),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 1000 }),
        (n, rawFemales, rawSubs, seed) => {
          const females = Math.min(rawFemales, n)
          const subs = Math.min(rawSubs, n - 1)
          const present = mkRoster(n, females, subs)
          const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed, restarts: 40 })
          assertLegal(grid, present)
          return true
        },
      ),
      { numRuns: 120 },
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/solver/buildFieldingGrid.test.ts`
Expected: FAIL — cannot find module `./buildFieldingGrid`.

- [ ] **Step 3: Write `lib/solver/scoreGrid.ts`**

```ts
import type { InningAssignment, PresentPlayer } from '@/lib/types'
import { WEIGHTS } from '@/lib/rules/config'

/**
 * Higher is better. Combines the four fairness goals plus penalties.
 *
 * Equal innings deliberately ignores subs — they do not pay, so roster players
 * get the innings and subs are not part of the "everyone plays the same amount"
 * calculation at all.
 */
export function scoreGrid(
  assignments: InningAssignment[],
  present: PresentPlayer[],
  relaxedCount: number,
): number {
  const byId = new Map(present.map((p) => [p.id, p]))
  const inningsPlayed = new Map<string, number>(present.map((p) => [p.id, 0]))
  const positionCounts = new Map<string, number>()
  let subInnings = 0
  let fitReward = 0

  for (const inning of assignments) {
    for (const [position, id] of Object.entries(inning)) {
      const player = byId.get(id)
      if (!player) continue

      inningsPlayed.set(id, (inningsPlayed.get(id) ?? 0) + 1)
      if (player.isSub) subInnings++

      const key = `${id}:${position}`
      positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1)

      const tier = player.positions[position as keyof typeof player.positions]
      if (tier === 'primary') fitReward += WEIGHTS.primaryFit
      else if (tier === 'backup') fitReward += WEIGHTS.backupFit
    }
  }

  // Equal innings across roster players only.
  const rosterCounts = present.filter((p) => !p.isSub).map((p) => inningsPlayed.get(p.id) ?? 0)
  let variance = 0
  if (rosterCounts.length > 0) {
    const mean = rosterCounts.reduce((a, b) => a + b, 0) / rosterCounts.length
    variance = rosterCounts.reduce((acc, v) => acc + (v - mean) ** 2, 0) / rosterCounts.length
  }

  // Position variety: penalise every appearance beyond the threshold.
  let repeatPenalty = 0
  for (const count of positionCounts.values()) {
    if (count > WEIGHTS.positionRepeatThreshold) {
      repeatPenalty += (count - WEIGHTS.positionRepeatThreshold) * WEIGHTS.positionRepeat
    }
  }

  return (
    fitReward -
    variance * WEIGHTS.equalInnings -
    repeatPenalty -
    subInnings * WEIGHTS.subOnField -
    relaxedCount * WEIGHTS.eligibilityRelaxed
  )
}
```

- [ ] **Step 4: Write `lib/solver/buildFieldingGrid.ts`**

```ts
import type {
  FieldingGrid,
  FieldingInput,
  InningAssignment,
  Pin,
  Position,
  PresentPlayer,
} from '@/lib/types'
import { RULES, SOLVER } from '@/lib/rules/config'
import { validateRoster } from './validateRoster'
import { scoreGrid } from './scoreGrid'
import { makeRng, type Rng } from './rng'

export function isAvailable(player: PresentPlayer, inning: number): boolean {
  if (inning < player.arrivedInning) return false
  if (player.leftInning !== null && inning > player.leftInning) return false
  return true
}

interface Attempt {
  assignments: InningAssignment[]
  relaxed: Set<Position>
}

/**
 * Build the fielding grid: seeded greedy construction, many randomised
 * restarts, keep the best-scoring legal grid.
 *
 * The search space here is tiny (7 innings x 10 slots), so brute restarts beat
 * a heavyweight constraint solver on every axis that matters: speed, bundle
 * size, and being able to explain the result.
 */
export function buildFieldingGrid(input: FieldingInput): FieldingGrid {
  const { present, innings, pins, seed } = input
  const restarts = input.restarts ?? SOLVER.restarts
  const status = validateRoster(present)
  const positions = status.activePositions

  const lockedThrough = input.lockedThroughInning ?? 0
  const locked = input.existingGrid?.assignments.slice(0, lockedThrough) ?? []

  let best: Attempt | null = null
  let bestScore = -Infinity
  let bestSeed = seed

  for (let r = 0; r < restarts; r++) {
    const attemptSeed = seed + r
    const attempt = construct(input, positions, status.requiredFemalesOnField, locked, makeRng(attemptSeed))
    if (!attempt) continue
    const score = scoreGrid(attempt.assignments, present, attempt.relaxed.size * innings)
    if (score > bestScore) {
      bestScore = score
      best = attempt
      bestSeed = attemptSeed
    }
  }

  if (!best) {
    // Every restart failed. Relax eligibility for all positions and try once
    // more — a legal-by-league-rules lineup should always be reachable.
    const attempt = construct(
      input,
      positions,
      status.requiredFemalesOnField,
      locked,
      makeRng(seed),
      true,
    )
    if (!attempt) {
      throw new Error(
        'No legal fielding grid exists for this roster. Check the roster status banners.',
      )
    }
    best = attempt
    bestScore = scoreGrid(attempt.assignments, present, attempt.relaxed.size * innings)
  }

  const warnings = [...status.warnings]
  if (best.relaxed.size > 0) {
    warnings.push(
      `Nobody present is listed at ${[...best.relaxed].join(', ')}. Filled anyway — set someone's eligibility to fix this.`,
    )
  }

  return {
    innings,
    assignments: best.assignments,
    warnings,
    score: bestScore,
    seed: bestSeed,
  }
}

function construct(
  input: FieldingInput,
  positions: Position[],
  requiredFemales: number,
  locked: InningAssignment[],
  rng: Rng,
  forceRelaxAll = false,
): Attempt | null {
  const { present, innings, pins } = input
  const byId = new Map(present.map((p) => [p.id, p]))
  const assignments: InningAssignment[] = []
  const relaxed = new Set<Position>()
  const inningsPlayed = new Map<string, number>(present.map((p) => [p.id, 0]))
  const positionCounts = new Map<string, number>()

  const bump = (id: string, position: Position) => {
    inningsPlayed.set(id, (inningsPlayed.get(id) ?? 0) + 1)
    const key = `${id}:${position}`
    positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1)
  }

  for (let inning = 1; inning <= innings; inning++) {
    if (inning <= locked.length) {
      const copied = locked[inning - 1]
      assignments.push({ ...copied })
      for (const [position, id] of Object.entries(copied)) bump(id, position as Position)
      continue
    }

    let solved: InningAssignment | null = null
    for (let retry = 0; retry < SOLVER.inningRetries && !solved; retry++) {
      solved = solveInning({
        inning,
        positions,
        requiredFemales,
        present,
        byId,
        pins,
        inningsPlayed,
        positionCounts,
        relaxed,
        rng,
        forceRelaxAll,
      })
    }
    if (!solved) return null

    assignments.push(solved)
    for (const [position, id] of Object.entries(solved)) bump(id, position as Position)
  }

  return { assignments, relaxed }
}

interface InningContext {
  inning: number
  positions: Position[]
  requiredFemales: number
  present: PresentPlayer[]
  byId: Map<string, PresentPlayer>
  pins: Pin[]
  inningsPlayed: Map<string, number>
  positionCounts: Map<string, number>
  relaxed: Set<Position>
  rng: Rng
  forceRelaxAll: boolean
}

function solveInning(ctx: InningContext): InningAssignment | null {
  const {
    inning,
    positions,
    requiredFemales,
    present,
    byId,
    pins,
    inningsPlayed,
    positionCounts,
    relaxed,
    rng,
    forceRelaxAll,
  } = ctx

  const assignment: InningAssignment = {}
  const used = new Set<string>()

  // Pins first — they are non-negotiable.
  for (const pin of pins) {
    if (pin.inning !== inning) continue
    if (!positions.includes(pin.position)) continue
    const player = byId.get(pin.playerId)
    if (!player || !isAvailable(player, inning) || used.has(pin.playerId)) continue
    assignment[pin.position] = pin.playerId
    used.add(pin.playerId)
  }

  const available = present.filter((p) => isAvailable(p, inning))
  const eligibleFor = (position: Position, player: PresentPlayer) =>
    forceRelaxAll || relaxed.has(position) || player.positions[position] !== undefined

  const remaining = positions.filter((p) => assignment[p] === undefined)

  // Scarcest position first: the one with the fewest eligible free players.
  const ordered = [...remaining].sort((a, b) => {
    const countA = available.filter((p) => !used.has(p.id) && eligibleFor(a, p)).length
    const countB = available.filter((p) => !used.has(p.id) && eligibleFor(b, p)).length
    if (countA !== countB) return countA - countB
    return rng.next() - 0.5
  })

  for (let i = 0; i < ordered.length; i++) {
    const position = ordered[i]
    const slotsLeftAfterThis = ordered.length - i - 1

    let candidates = available.filter((p) => !used.has(p.id) && eligibleFor(position, p))
    if (candidates.length === 0) {
      // Nobody is listed here. Relax this position and retry with everyone.
      relaxed.add(position)
      candidates = available.filter((p) => !used.has(p.id))
      if (candidates.length === 0) return null
    }

    const femalesSoFar = countFemales(assignment, byId)
    const malesSoFar = Object.keys(assignment).length - femalesSoFar

    const legal = candidates.filter((p) => {
      if (p.isFemale) return true
      // A man is only legal if the M/X cap holds and the women still fit.
      if (malesSoFar + 1 > RULES.maxMalesOnField) return false
      return femalesSoFar + slotsLeftAfterThis >= requiredFemales
    })
    if (legal.length === 0) return null

    const pick = chooseCandidate(legal, position, inningsPlayed, positionCounts, rng)
    assignment[position] = pick.id
    used.add(pick.id)
  }

  const females = countFemales(assignment, byId)
  const males = Object.keys(assignment).length - females
  if (females < requiredFemales) return null
  if (males > RULES.maxMalesOnField) return null

  return assignment
}

function countFemales(assignment: InningAssignment, byId: Map<string, PresentPlayer>): number {
  return Object.values(assignment).filter((id) => byId.get(id)?.isFemale).length
}

/**
 * Prefer, in order: roster players over subs, players with fewer innings so
 * far, players who have not been at this position much, and Primary over
 * Backup. RNG jitter breaks ties so restarts explore different lineups.
 */
function chooseCandidate(
  candidates: PresentPlayer[],
  position: Position,
  inningsPlayed: Map<string, number>,
  positionCounts: Map<string, number>,
  rng: Rng,
): PresentPlayer {
  let best = candidates[0]
  let bestScore = -Infinity
  for (const player of rng.shuffle(candidates)) {
    const tier = player.positions[position]
    let score = 0
    if (player.isSub) score -= 1000
    score -= (inningsPlayed.get(player.id) ?? 0) * 10
    score -= (positionCounts.get(`${player.id}:${position}`) ?? 0) * 6
    if (tier === 'primary') score += 4
    else if (tier === 'backup') score += 2
    score += rng.next() * 2
    if (score > bestScore) {
      bestScore = score
      best = player
    }
  }
  return best
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/solver/buildFieldingGrid.test.ts`
Expected: PASS, 12 tests including the 120-run property test.

If the "spreads innings evenly" test fails with a spread of 2, raise `WEIGHTS.equalInnings` in `lib/rules/config.ts` and re-run. Do not weaken the assertion.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, all files green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: fielding grid solver with restarts, pins, and fairness scoring"
```

---

### Task 7: Database schema and data access

**Files:**
- Create: `lib/db/schema.ts`, `lib/db/client.ts`, `lib/db/queries.ts`
- Create: `drizzle.config.ts`
- Create: `.env.example`
- Create: `docs/setup.md`
- Test: `lib/db/mappers.test.ts`
- Create: `lib/db/mappers.ts`

**Interfaces:**
- Consumes: `Player`, `PresentPlayer`, `Position`, `Tier`, `BattingOrder`, `FieldingGrid` from `@/lib/types`
- Produces:
  - `db` — the Drizzle client (server-only)
  - Tables: `players`, `playerPositions`, `games`, `gameAttendance`, `lineups`, `battingOrders`
  - `toPlayer(row, positionRows): Player` and `toPresentPlayer(player, attendanceRow): PresentPlayer` in `mappers.ts`
  - Query functions: `listPlayers()`, `upsertPlayer(input)`, `setPlayerPositions(playerId, positions)`, `listGames()`, `getGame(id)`, `createGame(input)`, `setAttendance(gameId, rows)`, `saveLineup(gameId, grid, order)`, `getLineup(gameId)`, `recentSlotHistory(limit)`

- [ ] **Step 1: Write `docs/setup.md` with the one-time SQL**

The `softball_app` role cannot create its own schema. These run once, by hand, in the Tracker project's Supabase SQL editor:

```sql
create schema if not exists softball;

create role softball_app login password 'REPLACE_ME';

grant usage, create on schema softball to softball_app;
grant all on all tables in schema softball to softball_app;
grant all on all sequences in schema softball to softball_app;
alter default privileges in schema softball grant all on tables to softball_app;
alter default privileges in schema softball grant all on sequences to softball_app;

-- Isolation: this app must never be able to reach public.time_entries.
revoke all on schema public from softball_app;
revoke all on all tables in schema public from softball_app;
```

Document in the same file that `DATABASE_URL` uses Supabase's transaction pooler on port 6543 with the `softball_app.<project-ref>` username form, and that the Supabase service-role key is deliberately not used.

- [ ] **Step 2: Write `.env.example`**

```
# Supabase transaction pooler, scoped softball_app role. Never the service-role key.
DATABASE_URL=postgres://softball_app.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
# Shared password for the single-user gate.
APP_PASSWORD=
# Random 32+ char string used to sign the session cookie.
SESSION_SECRET=
```

- [ ] **Step 3: Write `lib/db/schema.ts`**

```ts
import {
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  date,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core'

export const softball = pgSchema('softball')

export const players = softball.table('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isFemale: boolean('is_female').notNull().default(false),
  isSub: boolean('is_sub').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const playerPositions = softball.table(
  'player_positions',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    position: text('position').notNull(),
    tier: text('tier').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.playerId, t.position] }) }),
)

export const games = softball.table('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  opponent: text('opponent'),
  notes: text('notes'),
  innings: integer('innings').notNull().default(7),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const gameAttendance = softball.table(
  'game_attendance',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    isPresent: boolean('is_present').notNull().default(true),
    arrivedInning: integer('arrived_inning').notNull().default(1),
    leftInning: integer('left_inning'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.gameId, t.playerId] }) }),
)

export const lineups = softball.table(
  'lineups',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    inning: integer('inning').notNull(),
    position: text('position').notNull(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.gameId, t.inning, t.position] }) }),
)

export const battingOrders = softball.table(
  'batting_orders',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    /** null means an automatic out. */
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.gameId, t.slot] }) }),
)
```

- [ ] **Step 4: Write `lib/db/client.ts`**

```ts
import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

// prepare: false is required for Supabase's transaction pooler.
const sql = postgres(url, { prepare: false })
export const db = drizzle(sql, { schema })
```

Install `server-only`: `npm install server-only`.

- [ ] **Step 5: Write the failing test for the mappers**

Create `lib/db/mappers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toPlayer, toPresentPlayer } from './mappers'

describe('toPlayer', () => {
  it('folds position rows into a tier map', () => {
    const player = toPlayer(
      { id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true },
      [
        { playerId: 'a', position: 'SS', tier: 'primary' },
        { playerId: 'a', position: 'CF', tier: 'backup' },
      ],
    )
    expect(player.positions).toEqual({ SS: 'primary', CF: 'backup' })
    expect(player.isFemale).toBe(true)
  })

  it('ignores position rows belonging to other players', () => {
    const player = toPlayer(
      { id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true },
      [{ playerId: 'b', position: 'SS', tier: 'primary' }],
    )
    expect(player.positions).toEqual({})
  })

  it('drops unknown position strings rather than trusting the database', () => {
    const player = toPlayer(
      { id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true },
      [{ playerId: 'a', position: 'DH', tier: 'primary' }],
    )
    expect(player.positions).toEqual({})
  })
})

describe('toPresentPlayer', () => {
  it('defaults to available for the whole game', () => {
    const base = toPlayer({ id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true }, [])
    const present = toPresentPlayer(base, undefined)
    expect(present.arrivedInning).toBe(1)
    expect(present.leftInning).toBeNull()
  })

  it('carries arrival and departure innings through', () => {
    const base = toPlayer({ id: 'a', name: 'Sarah', isFemale: true, isSub: false, isActive: true }, [])
    const present = toPresentPlayer(base, { arrivedInning: 3, leftInning: 6 })
    expect(present.arrivedInning).toBe(3)
    expect(present.leftInning).toBe(6)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run lib/db/mappers.test.ts`
Expected: FAIL — cannot find module `./mappers`.

- [ ] **Step 7: Write `lib/db/mappers.ts`**

```ts
import { POSITIONS, type Player, type Position, type PresentPlayer, type Tier } from '@/lib/types'

export interface PlayerRow {
  id: string
  name: string
  isFemale: boolean
  isSub: boolean
  isActive: boolean
}

export interface PositionRow {
  playerId: string
  position: string
  tier: string
}

const isPosition = (value: string): value is Position =>
  (POSITIONS as readonly string[]).includes(value)

const isTier = (value: string): value is Tier => value === 'primary' || value === 'backup'

export function toPlayer(row: PlayerRow, positionRows: PositionRow[]): Player {
  const positions: Partial<Record<Position, Tier>> = {}
  for (const p of positionRows) {
    if (p.playerId !== row.id) continue
    if (!isPosition(p.position) || !isTier(p.tier)) continue
    positions[p.position] = p.tier
  }
  return { ...row, positions }
}

export function toPresentPlayer(
  player: Player,
  attendance: { arrivedInning: number; leftInning: number | null } | undefined,
): PresentPlayer {
  return {
    ...player,
    arrivedInning: attendance?.arrivedInning ?? 1,
    leftInning: attendance?.leftInning ?? null,
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run lib/db/mappers.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Write `drizzle.config.ts` and `lib/db/queries.ts`**

`drizzle.config.ts`:

```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['softball'],
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

`lib/db/queries.ts` holds every database read and write. Each function is `async`, imports `db` from `./client`, and returns domain types from `@/lib/types` — never raw rows. Implement exactly these:

- `listPlayers(): Promise<Player[]>` — joins `players` and `player_positions`, active first then by name, mapped through `toPlayer`.
- `upsertPlayer(input: { id?: string; name: string; isFemale: boolean; isSub: boolean; isActive: boolean }): Promise<string>` — returns the player id.
- `setPlayerPositions(playerId: string, positions: Partial<Record<Position, Tier>>): Promise<void>` — deletes then inserts, in a transaction.
- `listGames(): Promise<Array<{ id: string; date: string; opponent: string | null; innings: number }>>` — newest first.
- `getGame(id: string)` — the game row plus its attendance rows.
- `createGame(input: { date: string; opponent?: string; notes?: string; innings?: number }): Promise<string>`
- `setAttendance(gameId, rows: Array<{ playerId: string; isPresent: boolean; arrivedInning: number; leftInning: number | null }>): Promise<void>` — delete-then-insert in a transaction.
- `saveLineup(gameId: string, grid: FieldingGrid, order: BattingOrder): Promise<void>` — deletes existing `lineups` and `batting_orders` rows for the game, then inserts. `BattingSlot` of kind `autoOut` writes `playerId: null`. Transactional.
- `getLineup(gameId: string): Promise<{ grid: FieldingGrid; order: BattingOrder } | null>`
- `recentSlotHistory(limit = 4): Promise<SlotHistory[]>` — the last `limit` games that have a saved batting order, newest first, folded into one `SlotHistory` per player. Excludes subs.

- [ ] **Step 10: Generate the migration and push it**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

If `DATABASE_URL` is not set yet, stop here and report that the setup SQL in `docs/setup.md` must be run and `.env.local` populated before this step can complete. Do not invent a connection string.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: softball schema, scoped db client, and queries"
```

---

### Task 8: Auth gate and app shell

**Files:**
- Create: `middleware.ts`, `lib/auth.ts`, `app/login/page.tsx`, `app/login/actions.ts`
- Modify: `app/layout.tsx`
- Create: `components/nav.tsx`
- Test: `lib/auth.test.ts`

**Interfaces:**
- Consumes: `APP_PASSWORD`, `SESSION_SECRET` env vars
- Produces: `signSession(): Promise<string>`, `verifySession(token: string | undefined): Promise<boolean>`, and the `softball_session` cookie name exported as `SESSION_COOKIE`

- [ ] **Step 1: Write the failing test**

Create `lib/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signSession, verifySession } from './auth'

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-be-real'
})

describe('session tokens', () => {
  it('verifies a token it signed', async () => {
    expect(await verifySession(await signSession())).toBe(true)
  })

  it('rejects a tampered token', async () => {
    const token = await signSession()
    expect(await verifySession(token.slice(0, -1) + 'x')).toBe(false)
  })

  it('rejects undefined', async () => {
    expect(await verifySession(undefined)).toBe(false)
  })

  it('rejects garbage', async () => {
    expect(await verifySession('not-a-token')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/auth.test.ts`
Expected: FAIL — cannot find module `./auth`.

- [ ] **Step 3: Write `lib/auth.ts`**

Use the Web Crypto API (`crypto.subtle`) with HMAC-SHA256 so the same code runs in middleware (Edge) and in server actions. The token is `<issuedAtMs>.<base64url hmac>`. `verifySession` recomputes the HMAC, compares in constant time, and rejects tokens older than 30 days. `SESSION_COOKIE = 'softball_session'`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/auth.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write `middleware.ts`**

Redirect any request without a valid `softball_session` cookie to `/login`, except `/login` itself and Next internals. Export `config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'] }`.

- [ ] **Step 6: Write the login page and action**

`app/login/page.tsx` — a single password field and a submit button, mobile-sized. `app/login/actions.ts` — a server action comparing the submitted value against `process.env.APP_PASSWORD` and, on match, setting the signed cookie `httpOnly`, `secure`, `sameSite: 'lax'`, `maxAge` 30 days, then redirecting to `/`.

- [ ] **Step 7: Write `components/nav.tsx` and wire it into `app/layout.tsx`**

Three links: Roster (`/roster`), Games (`/games`), and the active game if one exists. Bottom-fixed tab bar on small screens, top bar above `sm`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: shared-password auth gate and app shell"
```

---

### Task 9: Roster screen

**Files:**
- Create: `app/roster/page.tsx`, `app/roster/actions.ts`
- Create: `components/PlayerCard.tsx`, `components/PositionChips.tsx`
- Test: `components/PositionChips.test.tsx`

**Interfaces:**
- Consumes: `listPlayers`, `upsertPlayer`, `setPlayerPositions` from `@/lib/db/queries`; `POSITIONS`, `Player`, `Position`, `Tier`
- Produces: server actions `savePlayer(formData)` and `savePositions(playerId, positions)`; `PositionChips` component with props `{ value: Partial<Record<Position, Tier>>; onChange: (next: Partial<Record<Position, Tier>>) => void }`

- [ ] **Step 1: Write the failing test**

Create `components/PositionChips.test.tsx`:

```tsx
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
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/PositionChips.test.tsx`
Expected: FAIL — cannot find module `./PositionChips`.

- [ ] **Step 3: Write `components/PositionChips.tsx`**

A `'use client'` component rendering one button per entry in `POSITIONS`. Each button's accessible name starts with the position string. Tapping cycles `undefined -> 'backup' -> 'primary' -> undefined` and calls `onChange` with a new object — never mutating `value`. Style: unset is outline/muted, backup is a hollow ring, primary is filled with a star. Minimum 44px touch target.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/PositionChips.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the roster page and actions**

`app/roster/page.tsx` is a server component calling `listPlayers()`. It renders active players first with a sub badge and a female badge, then inactive ones collapsed. An "Add player" button opens an inline form (name, female toggle, sub toggle, `PositionChips`). Editing an existing player uses the same form. Deactivate rather than delete, so game history survives.

`app/roster/actions.ts` exports `savePlayer` and `savePositions` server actions that call the queries and `revalidatePath('/roster')`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: roster screen with position eligibility chips"
```

---

### Task 10: Game screen

**Files:**
- Create: `app/games/page.tsx`, `app/games/actions.ts`, `app/games/[id]/page.tsx`
- Create: `components/AttendanceList.tsx`, `components/RosterStatusBanner.tsx`
- Test: `components/RosterStatusBanner.test.tsx`

**Interfaces:**
- Consumes: `listGames`, `createGame`, `getGame`, `setAttendance`, `listPlayers`; `validateRoster`; `RosterStatus`
- Produces: `RosterStatusBanner` with props `{ status: RosterStatus }`; server actions `newGame(formData)` and `saveAttendance(gameId, rows)`

- [ ] **Step 1: Write the failing test**

Create `components/RosterStatusBanner.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RosterStatusBanner } from './RosterStatusBanner'
import { validateRoster } from '@/lib/solver/validateRoster'
import { mkRoster } from '@/lib/solver/validateRoster.test'

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
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/RosterStatusBanner.test.tsx`
Expected: FAIL — cannot find module `./RosterStatusBanner`.

- [ ] **Step 3: Write `components/RosterStatusBanner.tsx`**

Renders `status.blockers` inside `role="alert"` in red, and `status.warnings` inside `role="status"` in amber. Renders nothing at all when both arrays are empty.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/RosterStatusBanner.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the games list and detail pages**

`app/games/page.tsx` — list of games newest first, plus a "New game" form (date defaulting to today, opponent, innings defaulting to `RULES.inningsPerGame`).

`app/games/[id]/page.tsx` — loads the game, its attendance, and the full roster. Renders `AttendanceList` (a `'use client'` checklist of every active player, roster players grouped above subs, each row with a present toggle and optional arrived/left inning selectors) and a live `RosterStatusBanner` recomputed from the current checkboxes. The Generate button is disabled while `status.blockers.length > 0` and links to `/games/[id]/lineup` once attendance is saved.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: game creation and attendance screen"
```

---

### Task 11: Lineup screen

**Files:**
- Create: `app/games/[id]/lineup/page.tsx`, `app/games/[id]/lineup/LineupClient.tsx`, `app/games/[id]/lineup/actions.ts`
- Create: `components/FieldingGridTable.tsx`, `components/BattingOrderList.tsx`, `components/PlayerSummary.tsx`
- Create: `lib/solver/applySwap.ts`
- Test: `lib/solver/applySwap.test.ts`

**Interfaces:**
- Consumes: `buildFieldingGrid`, `buildBattingOrder`, `validateRoster`, `scoreGrid`; `saveLineup`, `getLineup`, `recentSlotHistory`, `getGame`, `listPlayers`
- Produces: `applySwap(grid, present, a, b): { grid: FieldingGrid } | { error: string }` where `a` and `b` are `{ inning: number; position: Position }`

- [ ] **Step 1: Write the failing test**

Create `lib/solver/applySwap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applySwap } from './applySwap'
import { buildFieldingGrid } from './buildFieldingGrid'
import { mkPlayer, mkRoster } from './validateRoster.test'
import type { Position } from '@/lib/types'

describe('applySwap', () => {
  it('swaps two players within an inning', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 1 })
    const a = { inning: 1, position: 'P' as Position }
    const b = { inning: 1, position: 'C' as Position }
    const before = { p: grid.assignments[0].P, c: grid.assignments[0].C }
    const result = applySwap(grid, present, a, b)
    expect('grid' in result).toBe(true)
    if (!('grid' in result)) return
    expect(result.grid.assignments[0].P).toBe(before.c)
    expect(result.grid.assignments[0].C).toBe(before.p)
  })

  it('does not mutate the original grid', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 2 })
    const snapshot = JSON.stringify(grid.assignments)
    applySwap(grid, present, { inning: 1, position: 'P' }, { inning: 1, position: 'C' })
    expect(JSON.stringify(grid.assignments)).toBe(snapshot)
  })

  it('swaps across innings', () => {
    const present = mkRoster(13, 5)
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 3 })
    const result = applySwap(
      grid,
      present,
      { inning: 1, position: 'P' },
      { inning: 2, position: 'P' },
    )
    expect('grid' in result).toBe(true)
  })

  it('rejects a cross-inning swap that would break the M/X cap', () => {
    // 13 present: 10 men, 3 women. Every inning fields exactly 3 women and
    // 7 men — the cap is saturated, so moving a woman out of any inning and a
    // man in is always illegal.
    const present = [
      ...Array.from({ length: 10 }, (_, i) => mkPlayer(`m${i}`)),
      ...Array.from({ length: 3 }, (_, i) => mkPlayer(`f${i}`, { isFemale: true })),
    ]
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 4 })
    const womanSlot = (Object.entries(grid.assignments[0]) as [Position, string][]).find(
      ([, id]) => id.startsWith('f'),
    )!
    const manSlot = (Object.entries(grid.assignments[1]) as [Position, string][]).find(
      ([, id]) => id.startsWith('m'),
    )!
    const result = applySwap(
      grid,
      present,
      { inning: 1, position: womanSlot[0] },
      { inning: 2, position: manSlot[0] },
    )
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/women|M\/X/i)
  })

  it('rejects a swap involving an unavailable player', () => {
    const present = mkRoster(13, 5)
    present[0] = { ...present[0], arrivedInning: 5 }
    const grid = buildFieldingGrid({ present, innings: 7, pins: [], seed: 5 })
    // Put p0 into inning 5, then try to move them into inning 1.
    const fifth = grid.assignments[4]
    const slot = (Object.entries(fifth) as [Position, string][]).find(([, id]) => id === 'p0')
    if (!slot) return // solver may have benched them; nothing to assert
    const result = applySwap(
      grid,
      present,
      { inning: 5, position: slot[0] },
      { inning: 1, position: slot[0] },
    )
    expect('error' in result).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/solver/applySwap.test.ts`
Expected: FAIL — cannot find module `./applySwap`.

- [ ] **Step 3: Write `lib/solver/applySwap.ts`**

Deep-copies `grid.assignments`, exchanges the two cells' player ids, then re-validates **only the affected innings** against the same hard constraints `buildFieldingGrid` enforces: availability (`isAvailable`), no duplicate player within an inning, `males <= RULES.maxMalesOnField`, and `females >= validateRoster(present).requiredFemalesOnField`. Returns `{ grid }` on success or `{ error: '<human-readable reason>' }` on failure. Never mutates the input.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/solver/applySwap.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write `LineupClient.tsx`**

A `'use client'` component holding grid, order, pins, and seed in state. The solver runs here, in the browser, so Reshuffle costs no round-trip and the page works on bad signal.

- Renders `FieldingGridTable` (innings as columns, positions as rows on wide screens; a per-inning stacked card list on phones) and `BattingOrderList` beside it.
- **Reshuffle** — `buildFieldingGrid` with `seed + 1`, preserving pins.
- **Pin** — tap a cell to toggle a pin; pinned cells show a pin icon and survive Reshuffle.
- **Drag-swap** — HTML5 drag between cells calls `applySwap`; on `{ error }`, show the message inline and leave the grid untouched.
- **Mid-game** — an inning selector marks innings 1..k as played; changing attendance and regenerating passes `lockedThroughInning: k` and `existingGrid`.
- **Save** — a server action in `actions.ts` persisting via `saveLineup`.
- `PlayerSummary` lists each present player with innings played, positions covered, and batting slot.
- Renders `grid.warnings` and `order.warnings` above the grid.

`app/games/[id]/lineup/page.tsx` is a server component that loads the game, present players, and `recentSlotHistory(4)`, then hands them to `LineupClient`. If a lineup is already saved it passes that instead of generating.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, everything green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: lineup screen with reshuffle, pins, drag-swap, and mid-game regen"
```

---

### Task 12: Build, deploy, and index

**Files:**
- Create: `README.md`
- Modify: `/home/joey/dev/README.md`

- [ ] **Step 1: Verify the production build**

Run: `npm run build`
Expected: succeeds with no type errors. Fix any that appear — do not add `// @ts-expect-error` or loosen `tsconfig.json`.

- [ ] **Step 2: Verify the full test suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Write `README.md`**

What the app does, the CSSC rules it encodes with a pointer to the spec, local setup (`.env.local` from `.env.example`, the one-time SQL in `docs/setup.md`), and `npm run dev` / `npm test` / `npm run build`.

- [ ] **Step 4: Append the project to the dev index**

Add one line to the `personal/` section of `/home/joey/dev/README.md`:

```
- `softball-scheduler` — Auto-generates CSSC co-ed slo-pitch lineups and batting orders from a roster.
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: readme and dev index entry"
```

- [ ] **Step 6: Report deploy readiness**

Do not deploy. Report to the user that the app is ready for `vercel deploy`, and list the three environment variables that must be set in the Vercel project: `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Rules encoded / config constants | 1 |
| `femaleSpotsRequired` formula + chart | 1 |
| Seeded, reproducible randomness | 2 |
| `maxFielders`, drop order, defaults, warnings | 3 |
| Batting order legality (runs, opening window) | 4 |
| Batting order assignment, auto-outs, rotation | 5 |
| Fielding grid, restarts, pins, arrival/departure, mid-game lock, relaxation | 6 |
| Fairness scoring (4 goals + penalties) | 6 |
| Data model, scoped role, setup SQL | 7 |
| Auth gate | 8 |
| Roster screen | 9 |
| Game / attendance screen | 10 |
| Lineup screen, reshuffle, drag-swap, pin, mid-game | 11 |
| Error-handling banners | 3, 10, 11 |
| Property-based + fixture tests | 3, 4, 5, 6 |
| Build and deploy readiness | 12 |

No spec requirement is unassigned.

**Known judgement calls left to the implementer:**

- Task 4 Step 4 flags that random combination sampling may miss valid patterns at some `n`; the fallback (exhaustive enumeration for `n <= 20`) is specified so the implementer does not have to invent one.
- Task 6 Step 5 flags that `WEIGHTS.equalInnings` may need raising; the correct response is specified, and weakening the assertion is explicitly ruled out.
- Task 7 Step 10 cannot complete without a real `DATABASE_URL`; the correct response is to stop and report, not to invent a connection string.
