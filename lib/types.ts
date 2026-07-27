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
