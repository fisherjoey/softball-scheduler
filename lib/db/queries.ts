import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './client'
import { battingOrders, gameAttendance, games, playerPositions, players, lineups, lineupMeta } from './schema'
import { toPlayer, type PlayerRow, type PositionRow } from './mappers'
import { RULES } from '@/lib/rules/config'
import {
  POSITIONS,
  type BattingOrder,
  type BattingSlot,
  type FieldingGrid,
  type InningAssignment,
  type Player,
  type Position,
  type SlotHistory,
  type Tier,
} from '@/lib/types'

const isPosition = (value: string): value is Position =>
  (POSITIONS as readonly string[]).includes(value)

/** Reads every player and folds their eligible positions in, active first then by name. */
export async function listPlayers(): Promise<Player[]> {
  const playerRows: PlayerRow[] = await db
    .select({
      id: players.id,
      name: players.name,
      isFemale: players.isFemale,
      isSub: players.isSub,
      isActive: players.isActive,
    })
    .from(players)
    .orderBy(desc(players.isActive), asc(players.name))

  const positionRows: PositionRow[] = await db
    .select({
      playerId: playerPositions.playerId,
      position: playerPositions.position,
      tier: playerPositions.tier,
    })
    .from(playerPositions)

  return playerRows.map((row) => toPlayer(row, positionRows))
}

/** Inserts a new player, or updates an existing one when `id` is supplied. Returns the player id. */
export async function upsertPlayer(input: {
  id?: string
  name: string
  isFemale: boolean
  isSub: boolean
  isActive: boolean
}): Promise<string> {
  if (input.id) {
    const [row] = await db
      .update(players)
      .set({
        name: input.name,
        isFemale: input.isFemale,
        isSub: input.isSub,
        isActive: input.isActive,
      })
      .where(eq(players.id, input.id))
      .returning({ id: players.id })
    if (!row) throw new Error(`Player ${input.id} not found`)
    return row.id
  }

  const [row] = await db
    .insert(players)
    .values({
      name: input.name,
      isFemale: input.isFemale,
      isSub: input.isSub,
      isActive: input.isActive,
    })
    .returning({ id: players.id })
  return row.id
}

/** Replaces a player's eligible positions wholesale. */
export async function setPlayerPositions(
  playerId: string,
  positions: Partial<Record<Position, Tier>>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(playerPositions).where(eq(playerPositions.playerId, playerId))
    const rows = Object.entries(positions).map(([position, tier]) => ({
      playerId,
      position,
      tier: tier as Tier,
    }))
    if (rows.length > 0) {
      await tx.insert(playerPositions).values(rows)
    }
  })
}

/** All games, newest first. */
export async function listGames(): Promise<
  Array<{ id: string; date: string; opponent: string | null; innings: number }>
> {
  return db
    .select({
      id: games.id,
      date: games.date,
      opponent: games.opponent,
      innings: games.innings,
    })
    .from(games)
    .orderBy(desc(games.date), desc(games.createdAt))
}

export interface GameDetail {
  id: string
  date: string
  opponent: string | null
  notes: string | null
  innings: number
  attendance: Array<{
    playerId: string
    isPresent: boolean
    arrivedInning: number
    leftInning: number | null
  }>
}

/** A single game plus its attendance rows. Null when the game doesn't exist. */
export async function getGame(id: string): Promise<GameDetail | null> {
  const [game] = await db.select().from(games).where(eq(games.id, id))
  if (!game) return null

  const attendance = await db
    .select({
      playerId: gameAttendance.playerId,
      isPresent: gameAttendance.isPresent,
      arrivedInning: gameAttendance.arrivedInning,
      leftInning: gameAttendance.leftInning,
    })
    .from(gameAttendance)
    .where(eq(gameAttendance.gameId, id))

  return {
    id: game.id,
    date: game.date,
    opponent: game.opponent,
    notes: game.notes,
    innings: game.innings,
    attendance,
  }
}

/** Creates a game. Returns the new game id. */
export async function createGame(input: {
  date: string
  opponent?: string
  notes?: string
  innings?: number
}): Promise<string> {
  const [row] = await db
    .insert(games)
    .values({
      date: input.date,
      opponent: input.opponent ?? null,
      notes: input.notes ?? null,
      innings: input.innings ?? RULES.inningsPerGame,
    })
    .returning({ id: games.id })
  return row.id
}

/** Replaces a game's attendance wholesale. */
export async function setAttendance(
  gameId: string,
  rows: Array<{ playerId: string; isPresent: boolean; arrivedInning: number; leftInning: number | null }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(gameAttendance).where(eq(gameAttendance.gameId, gameId))
    if (rows.length > 0) {
      await tx.insert(gameAttendance).values(
        rows.map((r) => ({
          gameId,
          playerId: r.playerId,
          isPresent: r.isPresent,
          arrivedInning: r.arrivedInning,
          leftInning: r.leftInning,
        })),
      )
    }
  })
}

/**
 * Replaces a game's saved fielding grid and batting order wholesale,
 * including the solver-run metadata (grid warnings/score/seed, batting
 * warnings/pattern). That metadata is persisted rather than re-derived on
 * read: the solver is history-dependent (`recentSlotHistory` changes as more
 * games are saved), so re-solving later would produce a different grid with
 * different warnings than the one actually shown to and saved by the
 * captain. All three tables commit or none do.
 */
export async function saveLineup(gameId: string, grid: FieldingGrid, order: BattingOrder): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(lineups).where(eq(lineups.gameId, gameId))
    await tx.delete(battingOrders).where(eq(battingOrders.gameId, gameId))
    await tx.delete(lineupMeta).where(eq(lineupMeta.gameId, gameId))

    const lineupRows: Array<{ gameId: string; inning: number; position: string; playerId: string }> = []
    grid.assignments.forEach((inningAssignment, idx) => {
      const inning = idx + 1
      for (const position of POSITIONS) {
        const playerId = inningAssignment[position]
        if (playerId) {
          lineupRows.push({ gameId, inning, position, playerId })
        }
      }
    })
    if (lineupRows.length > 0) {
      await tx.insert(lineups).values(lineupRows)
    }

    const battingRows = order.slots.map((slot: BattingSlot, idx) => ({
      gameId,
      slot: idx,
      playerId: slot.kind === 'player' ? slot.playerId : null,
    }))
    if (battingRows.length > 0) {
      await tx.insert(battingOrders).values(battingRows)
    }

    await tx.insert(lineupMeta).values({
      gameId,
      gridWarnings: grid.warnings,
      gridScore: grid.score,
      gridSeed: grid.seed,
      battingWarnings: order.warnings,
      battingPattern: order.pattern,
    })
  })
}

/** Reads a saved fielding grid and batting order back. Null when nothing has been saved. */
export async function getLineup(
  gameId: string,
): Promise<{ grid: FieldingGrid; order: BattingOrder } | null> {
  const [game] = await db.select({ innings: games.innings }).from(games).where(eq(games.id, gameId))
  if (!game) return null

  const lineupRows = await db.select().from(lineups).where(eq(lineups.gameId, gameId))
  const battingRows = await db
    .select({
      slot: battingOrders.slot,
      playerId: battingOrders.playerId,
      isFemale: players.isFemale,
    })
    .from(battingOrders)
    .leftJoin(players, eq(players.id, battingOrders.playerId))
    .where(eq(battingOrders.gameId, gameId))
    .orderBy(asc(battingOrders.slot))

  const [meta] = await db.select().from(lineupMeta).where(eq(lineupMeta.gameId, gameId))

  if (lineupRows.length === 0 && battingRows.length === 0) return null

  const assignments: InningAssignment[] = Array.from({ length: game.innings }, () => ({}))
  for (const row of lineupRows) {
    const idx = row.inning - 1
    if (idx < 0 || idx >= assignments.length) continue
    if (!isPosition(row.position)) continue
    assignments[idx][row.position] = row.playerId
  }

  const slots: BattingSlot[] = battingRows.map((row) =>
    row.playerId ? { kind: 'player', playerId: row.playerId } : { kind: 'autoOut' },
  )

  // Prefer the stored pattern. It is only inferred as a fallback for lineups
  // saved before `lineup_meta` existed — inferring from the CURRENT
  // players.isFemale would otherwise silently rewrite the pattern of every
  // historical lineup whenever a player's gender flag is corrected.
  const pattern: ('F' | 'M')[] =
    (meta?.battingPattern as ('F' | 'M')[] | null | undefined) ??
    battingRows.map((row) => (row.playerId ? (row.isFemale ? 'F' : 'M') : 'F'))

  const grid: FieldingGrid = {
    innings: game.innings,
    assignments,
    warnings: (meta?.gridWarnings as string[] | undefined) ?? [],
    score: meta?.gridScore ?? 0,
    seed: meta?.gridSeed ?? 0,
  }
  const order: BattingOrder = {
    slots,
    pattern,
    warnings: (meta?.battingWarnings as string[] | undefined) ?? [],
  }

  return { grid, order }
}

/**
 * The last `limit` games with a saved batting order, newest first, folded
 * into one SlotHistory per player. Excludes subs.
 */
export async function recentSlotHistory(limit = 4): Promise<SlotHistory[]> {
  const recentGames = await db
    .select({ id: games.id })
    .from(games)
    .where(sql`exists (select 1 from ${battingOrders} where ${battingOrders.gameId} = ${games.id})`)
    .orderBy(desc(games.date), desc(games.createdAt))
    .limit(limit)

  const gameIds = recentGames.map((g) => g.id)
  if (gameIds.length === 0) return []

  const gameOrder = new Map(gameIds.map((id, idx) => [id, idx]))

  const rows = await db
    .select({
      gameId: battingOrders.gameId,
      slot: battingOrders.slot,
      playerId: battingOrders.playerId,
      isSub: players.isSub,
    })
    .from(battingOrders)
    .innerJoin(players, eq(players.id, battingOrders.playerId))
    .where(inArray(battingOrders.gameId, gameIds))

  const perPlayer = new Map<string, Map<number, number>>()
  for (const row of rows) {
    if (row.isSub || !row.playerId) continue
    const gameIdx = gameOrder.get(row.gameId)
    if (gameIdx === undefined) continue
    if (!perPlayer.has(row.playerId)) perPlayer.set(row.playerId, new Map())
    perPlayer.get(row.playerId)!.set(gameIdx, row.slot)
  }

  const history: SlotHistory[] = []
  for (const [playerId, slotsByGameIdx] of perPlayer) {
    const slots = [...slotsByGameIdx.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, slot]) => slot)
    history.push({ playerId, slots })
  }
  return history
}
