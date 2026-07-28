import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from './client'
import {
  battingOrders,
  gameAttendance,
  games,
  lineupMeta,
  lineups,
  playerPositions,
  players,
} from './schema'
import {
  createGame,
  getGame,
  getLineup,
  listGames,
  listPlayers,
  recentSlotHistory,
  saveLineup,
  setAttendance,
  setPlayerPositions,
  upsertPlayer,
} from './queries'
import type { BattingOrder, FieldingGrid } from '@/lib/types'

/**
 * Live-database round-trip check. Skips cleanly (not fails) without
 * DATABASE_URL so `npm test` stays green for anyone without credentials.
 * Run deliberately with:
 *   ~/.local/bin/bw-agent exec softball-database-url --env DATABASE_URL -- npm run test:db
 */
describe.skipIf(!process.env.DATABASE_URL)('db queries integration', () => {
  let playerId: string | undefined
  let playerId2: string | undefined
  let gameId: string | undefined

  afterAll(async () => {
    // Runs even if the test above throws, so a failed assertion never
    // leaves rows behind in the shared database.
    if (gameId) {
      await db.delete(games).where(eq(games.id, gameId))
    }
    if (playerId) {
      await db.delete(players).where(eq(players.id, playerId))
    }
    if (playerId2) {
      await db.delete(players).where(eq(players.id, playerId2))
    }

    // The softball schema has no other data at this stage of the project, so
    // this is a genuine end-to-end leak check, not just "our rows are gone."
    for (const table of [
      players,
      games,
      playerPositions,
      gameAttendance,
      lineups,
      battingOrders,
      lineupMeta,
    ]) {
      const rows = await db.select().from(table)
      expect(rows).toEqual([])
    }
  })

  it('round-trips a player, game, attendance, and lineup, including lineup_meta and autoOut', async () => {
    playerId = await upsertPlayer({
      name: 'Integration Test Player',
      isFemale: true,
      isSub: false,
      isActive: true,
    })
    await setPlayerPositions(playerId, { SS: 'primary', CF: 'backup' })

    const roster = await listPlayers()
    const found = roster.find((p) => p.id === playerId)
    expect(found).toBeDefined()
    expect(found?.positions).toEqual({ SS: 'primary', CF: 'backup' })
    expect(found?.isFemale).toBe(true)

    playerId2 = await upsertPlayer({
      name: 'Integration Test Player 2',
      isFemale: false,
      isSub: false,
      isActive: true,
    })

    gameId = await createGame({ date: '2026-07-27', opponent: 'Integration FC', innings: 7 })

    const gamesList = await listGames()
    expect(gamesList.some((g) => g.id === gameId)).toBe(true)

    await setAttendance(gameId, [
      { playerId, isPresent: true, arrivedInning: 1, leftInning: null },
      { playerId: playerId2, isPresent: true, arrivedInning: 1, leftInning: null },
    ])

    const gameDetail = await getGame(gameId)
    expect(gameDetail?.attendance).toHaveLength(2)

    const grid: FieldingGrid = {
      innings: 7,
      assignments: [
        { SS: playerId, CF: playerId2 },
        { SS: playerId },
        {},
        {},
        {},
        {},
        {},
      ],
      warnings: ['a sub is fielding because you are short a woman'],
      score: 42.5,
      seed: 7,
    }
    const order: BattingOrder = {
      slots: [
        { kind: 'player', playerId },
        { kind: 'autoOut' },
        { kind: 'player', playerId: playerId2 },
      ],
      pattern: ['F', 'F', 'M'],
      warnings: ['could not honour your pin on Dave'],
    }
    await saveLineup(gameId, grid, order)

    const saved = await getLineup(gameId)
    expect(saved).not.toBeNull()
    expect(saved?.grid).toEqual(grid)
    expect(saved?.order).toEqual(order)

    // lineup_meta fields specifically, spelled out so a silently-empty
    // default can't pass this by accident.
    expect(saved?.grid.warnings).toEqual(['a sub is fielding because you are short a woman'])
    expect(saved?.grid.score).toBe(42.5)
    expect(saved?.grid.seed).toBe(7)
    expect(saved?.order.warnings).toEqual(['could not honour your pin on Dave'])
    expect(saved?.order.pattern).toEqual(['F', 'F', 'M'])

    const history = await recentSlotHistory(4)
    expect(history.find((h) => h.playerId === playerId)?.slots).toContain(0)
    expect(history.find((h) => h.playerId === playerId2)?.slots).toContain(2)

    // With the game itself excluded — as the lineup page does when rebuilding
    // that game, so its own saved order can't rotate against itself — this is
    // the only game with a batting order, so the history must be empty.
    expect(await recentSlotHistory(4, gameId)).toEqual([])
  })
})
