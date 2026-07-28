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

  // A silently short drop list would leave activePositions larger than
  // maxFielders, which no solver can satisfy. Fail loudly instead.
  if (dropped.length < dropCount) {
    throw new Error(
      `positionDropOrder has ${RULES.positionDropOrder.length} entries but ${dropCount} positions must be dropped. Extend RULES.positionDropOrder.`,
    )
  }

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
  }
  if (rosterFemales < requiredFemalesOnField) {
    warnings.push(
      `Only ${rosterFemales} female roster player${rosterFemales === 1 ? '' : 's'} — a female sub has to field to meet the ${requiredFemalesOnField}-women minimum.`,
    )
  }

  // Inverted From/To innings (arrived after they left) are a data-entry slip
  // the captain would not otherwise notice: the player still bats, but
  // isAvailable filters them out of every inning and they silently field
  // nothing all game.
  for (const p of present) {
    if (p.leftInning !== null && p.leftInning < p.arrivedInning) {
      warnings.push(
        `${p.name} arrives in inning ${p.arrivedInning} but leaves after inning ${p.leftInning} — zero innings of availability, so they will never field. Check their From/To innings.`,
      )
    }
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
