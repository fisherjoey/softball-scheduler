import type { RosterStatus } from '@/lib/types'

export interface RosterStatusBannerProps {
  status: RosterStatus
}

/**
 * Live readout of `validateRoster`'s verdict on the currently-checked
 * attendance, not whatever was last saved. Blockers mean the game is a
 * default and render in `role="alert"`; warnings mean it's playable but
 * something is off and render in `role="status"`. Renders nothing at all
 * when both are empty so a clean roster doesn't clutter the screen.
 */
export function RosterStatusBanner({ status }: RosterStatusBannerProps) {
  const { blockers, warnings } = status
  if (blockers.length === 0 && warnings.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {blockers.length > 0 && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border-2 border-red-600 bg-red-50 p-4 text-sm font-medium text-red-800 dark:border-red-500 dark:bg-red-950 dark:text-red-200"
        >
          {blockers.map((b, i) => (
            <p key={i}>{b}</p>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm font-medium text-amber-800 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-200"
        >
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
    </div>
  )
}
