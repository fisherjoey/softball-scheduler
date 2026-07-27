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
