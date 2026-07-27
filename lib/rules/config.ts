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
