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
  /**
   * Positions surrendered first when fielding fewer than 10, most expendable
   * first. Covers every reachable dropCount: a legal game can go as low as
   * 7 fielders, and a defaulted one lower still, so this must span all ten
   * rather than only the common two.
   */
  positionDropOrder: ['ROVER', 'RF', 'LF', 'CF', '2B', '3B', '1B', 'SS', 'C', 'P'] as Position[],
} as const

/** Fairness objective weights. Higher means the solver cares more. */
export const WEIGHTS = {
  /**
   * Penalty per unit of variance in innings played across roster players.
   *
   * Equal innings is the captain's first stated fairness requirement, so it
   * has to outrank the two cosmetic goals it competes with. At the original
   * 10 it did not: moving a player from 5 innings to 3 costs about the same
   * as one extra appearance at the same position (`positionRepeat`, 3) or one
   * Primary placement (`primaryFit`, 2), so the search would happily trade an
   * uneven bench for a tidier position chart. At 100 a real innings imbalance
   * always outweighs both, while staying below `eligibilityRelaxed` so that
   * covering a position still beats evening out the bench.
   */
  equalInnings: 100,
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
  /**
   * Greedy construction knobs. These are search heuristics, not league rules:
   * they rank candidates inside a single restart, where `equalInnings` and
   * friends above rank whole finished grids against each other.
   *
   * The bands are deliberately far apart rather than comparable, so a
   * higher-priority goal always wins outright instead of being outvoted by an
   * accumulation of lower-priority ones. Priority order: bench subs first,
   * then even out innings, then spread positions, then honour the tiers.
   */
  greedy: {
    /** Bench a sub before any roster player, whatever the innings count. */
    subOnField: 1_000_000,
    /** Per inning already played. Dominates every position preference. */
    inningsPlayed: 1_000,
    /** Per prior appearance at this position. Dominates the fit rewards. */
    positionRepeat: 40,
    /** Reward for a Primary position. */
    primaryFit: 8,
    /** Reward for a Backup position. */
    backupFit: 4,
    /** Random jitter, smaller than any real signal. Breaks exact ties only. */
    jitter: 3,
  },
} as const

export const SOLVER = {
  /**
   * Randomised restarts per generation. Each restart runs TWO constructions —
   * one per coverage-reservation policy (see buildFieldingGrid) — so the real
   * construction budget is twice this number.
   */
  restarts: 300,
  /** Retries of a single inning before abandoning a restart. */
  inningRetries: 20,
  /** Cap on enumerated batting-order gender patterns. */
  maxPatternCandidates: 2000,
  /**
   * Walk every combination when C(n, femaleSpots) is at or below this.
   * Valid patterns are a vanishing fraction of the space at tight roster
   * sizes, so random sampling can miss them entirely; exhaustive walking is
   * the only way to guarantee we find one that exists.
   */
  exhaustiveEnumerationLimit: 1_000_000,
} as const
