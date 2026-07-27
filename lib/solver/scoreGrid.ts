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
