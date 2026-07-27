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
