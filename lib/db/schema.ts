import {
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  real,
  date,
  timestamp,
  primaryKey,
  jsonb,
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

/**
 * Solver-run metadata for a saved lineup, one row per game. Kept separate
 * from `games` because this describes the lineup, not the game, and it lets
 * `saveLineup`/`getLineup` own it end to end. Persisted (not re-derived on
 * read) because the solver is history-dependent: re-solving later would
 * produce different warnings/score than what was actually saved and shown
 * to the captain.
 */
export const lineupMeta = softball.table('lineup_meta', {
  gameId: uuid('game_id')
    .primaryKey()
    .references(() => games.id, { onDelete: 'cascade' }),
  gridWarnings: jsonb('grid_warnings').notNull().default([]),
  gridScore: real('grid_score'),
  gridSeed: integer('grid_seed'),
  battingWarnings: jsonb('batting_warnings').notNull().default([]),
  battingPattern: jsonb('batting_pattern'),
})
