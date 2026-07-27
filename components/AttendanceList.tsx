'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { RosterStatusBanner } from './RosterStatusBanner'
import { saveAttendance } from '@/app/games/actions'
import { validateRoster } from '@/lib/solver/validateRoster'
import type { Player, PresentPlayer } from '@/lib/types'

export interface AttendanceRecord {
  playerId: string
  isPresent: boolean
  arrivedInning: number
  leftInning: number | null
}

export interface AttendanceListProps {
  gameId: string
  /** Innings this game runs, used to bound the arrived/left selectors. */
  innings: number
  /** Every active player, roster and subs together. */
  players: Player[]
  /** Previously saved attendance, if any (empty for a brand-new game). */
  initialAttendance: AttendanceRecord[]
}

interface RowState {
  isPresent: boolean
  arrivedInning: number
  leftInning: number | null
}

function initialRowState(players: Player[], attendance: AttendanceRecord[]): Map<string, RowState> {
  const byId = new Map(attendance.map((a) => [a.playerId, a]))
  return new Map(
    players.map((p) => {
      const saved = byId.get(p.id)
      return [
        p.id,
        saved
          ? {
              isPresent: saved.isPresent,
              arrivedInning: saved.arrivedInning,
              leftInning: saved.leftInning,
            }
          : { isPresent: false, arrivedInning: 1, leftInning: null },
      ]
    }),
  )
}

const TOGGLE_BASE =
  'flex h-11 min-w-24 items-center justify-center rounded-md border-2 px-3 text-sm font-semibold transition-colors'
const TOGGLE_ON =
  'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
const TOGGLE_OFF = 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full border-2 border-zinc-400 px-2 text-xs font-bold text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
      {children}
    </span>
  )
}

function PlayerAttendanceRow({
  player,
  state,
  innings,
  onChange,
}: {
  player: Player
  state: RowState
  innings: number
  onChange: (next: RowState) => void
}) {
  const inningOptions = Array.from({ length: innings }, (_, i) => i + 1)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={state.isPresent}
          aria-label={`${player.name} present`}
          onClick={() => onChange({ ...state, isPresent: !state.isPresent })}
          className={`${TOGGLE_BASE} ${state.isPresent ? TOGGLE_ON : TOGGLE_OFF}`}
        >
          {state.isPresent ? 'Present' : 'Absent'}
        </button>
        <span className="flex-1 text-base font-medium text-foreground">{player.name}</span>
        {player.isFemale && <Badge>F</Badge>}
        {player.isSub && <Badge>Sub</Badge>}
      </div>

      {state.isPresent && (
        <div className="flex flex-wrap items-center gap-3 pl-1 text-sm">
          <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            From inning
            <select
              value={state.arrivedInning}
              onChange={(e) => onChange({ ...state, arrivedInning: Number(e.target.value) })}
              className="h-11 rounded-md border border-zinc-300 bg-transparent px-2 text-base text-foreground dark:border-zinc-700"
            >
              {inningOptions.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            To inning
            <select
              value={state.leftInning ?? 'end'}
              onChange={(e) =>
                onChange({
                  ...state,
                  leftInning: e.target.value === 'end' ? null : Number(e.target.value),
                })
              }
              className="h-11 rounded-md border border-zinc-300 bg-transparent px-2 text-base text-foreground dark:border-zinc-700"
            >
              <option value="end">End</option>
              {inningOptions.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

/**
 * The live attendance checklist for a game: every active player, roster
 * players grouped above subs, each with a present toggle and (once present)
 * arrived/left inning selectors. Owns the checkbox state itself — the
 * `RosterStatusBanner` above it and the Generate button below both derive
 * from these same live checkboxes, never from what's saved, so the captain
 * sees the verdict update the instant they tap someone present or absent.
 *
 * "Save attendance" persists the current state via the `saveAttendance`
 * server action. "Generate lineup" is disabled until both the roster clears
 * every blocker AND the current state has been saved — generating a lineup
 * from checkboxes nobody has committed to the database would silently
 * disagree with what the next screen reads back.
 */
export function AttendanceList({ gameId, innings, players, initialAttendance }: AttendanceListProps) {
  const [rows, setRows] = useState<Map<string, RowState>>(() =>
    initialRowState(players, initialAttendance),
  )
  const [saved, setSaved] = useState(initialAttendance.length > 0)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const rosterPlayers = players.filter((p) => !p.isSub)
  const subs = players.filter((p) => p.isSub)

  const present = useMemo<PresentPlayer[]>(
    () =>
      players
        .filter((p) => rows.get(p.id)?.isPresent)
        .map((p) => {
          const s = rows.get(p.id)!
          return { ...p, arrivedInning: s.arrivedInning, leftInning: s.leftInning }
        }),
    [players, rows],
  )

  const status = useMemo(() => validateRoster(present), [present])

  function updateRow(playerId: string, next: RowState) {
    setSaved(false)
    setRows((prev) => {
      const copy = new Map(prev)
      copy.set(playerId, next)
      return copy
    })
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        const payload: AttendanceRecord[] = players.map((p) => {
          const s = rows.get(p.id)!
          return {
            playerId: p.id,
            isPresent: s.isPresent,
            arrivedInning: s.arrivedInning,
            leftInning: s.leftInning,
          }
        })
        await saveAttendance(gameId, payload)
        setSaved(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      }
    })
  }

  const canGenerate = saved && status.blockers.length === 0

  return (
    <div className="flex flex-col gap-6">
      <RosterStatusBanner status={status} />

      <section className="flex flex-col gap-3" aria-label="Roster attendance">
        {rosterPlayers.map((player) => (
          <PlayerAttendanceRow
            key={player.id}
            player={player}
            state={rows.get(player.id)!}
            innings={innings}
            onChange={(next) => updateRow(player.id, next)}
          />
        ))}
      </section>

      {subs.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Subs attendance">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Subs</h2>
          {subs.map((player) => (
            <PlayerAttendanceRow
              key={player.id}
              player={player}
              state={rows.get(player.id)!}
              innings={innings}
              onChange={(next) => updateRow(player.id, next)}
            />
          ))}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-3 pb-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="flex h-11 flex-1 items-center justify-center rounded-md bg-zinc-900 px-4 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isPending ? 'Saving…' : 'Save attendance'}
        </button>
        {canGenerate ? (
          <Link
            href={`/games/${gameId}/lineup`}
            className="flex h-11 flex-1 items-center justify-center rounded-md border-2 border-zinc-900 px-4 text-base font-medium text-foreground dark:border-zinc-100"
          >
            Generate lineup
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            title={
              status.blockers.length > 0
                ? 'Resolve the blockers above before generating a lineup.'
                : 'Save attendance before generating a lineup.'
            }
            className="flex h-11 flex-1 items-center justify-center rounded-md border-2 border-zinc-300 px-4 text-base font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
          >
            Generate lineup
          </button>
        )}
      </div>
    </div>
  )
}
