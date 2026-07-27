import Link from 'next/link'
import { RULES } from '@/lib/rules/config'

/**
 * The home screen doubles as the instructions.
 *
 * There is one user and they use this a handful of times a season, which is
 * exactly long enough to forget the order of operations between games. Three
 * numbered steps and the rules being enforced cost one screen and save the
 * "wait, do I add everyone again?" moment at the diamond.
 *
 * The rule numbers are read from `RULES` rather than written out, so this page
 * cannot drift away from what the solver actually enforces.
 */

const STEPS = [
  {
    n: 1,
    title: 'Build your roster — once',
    href: '/roster',
    linkText: 'Go to roster',
    body: 'Add every player and sub. Mark who counts toward the female minimum, and tap the position chips to set where each person can play: once for backup, twice for primary, again to clear. You only do this once — the roster carries between games.',
  },
  {
    n: 2,
    title: 'Take a headcount',
    href: '/games',
    linkText: 'Go to games',
    body: 'Create a game, then mark who turned up. Everyone on the roster starts as Present, so you untick the no-shows. If somebody arrives late or leaves early, set their innings on their row. The banner tells you straight away if you are short.',
  },
  {
    n: 3,
    title: 'Generate, then adjust',
    href: '/games',
    linkText: 'Go to games',
    body: 'Hit Generate for a full fielding grid and batting order. Reshuffle for a different one. Tap any player to swap them with someone else on the field or on the bench. Pin somebody to hold them in place. Save it, then Print / share for a PDF or an image.',
  },
]

export default function Home() {
  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Softball lineups</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Builds a legal, fair lineup for Calgary Sport &amp; Social Club co-ed slo-pitch.
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {STEPS.map((step) => (
          <li
            key={step.n}
            className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                {step.n}
              </span>
              <h2 className="text-base font-semibold text-foreground">{step.title}</h2>
            </div>
            <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{step.body}</p>
            <Link
              href={step.href}
              className="flex h-11 w-full items-center justify-center rounded-md border-2 border-zinc-400 px-4 text-sm font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-300 sm:w-auto sm:self-start"
            >
              {step.linkText}
            </Link>
          </li>
        ))}
      </ol>

      <details className="rounded-lg border border-zinc-300 dark:border-zinc-700">
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 py-3 text-base font-medium text-foreground">
          What it enforces
        </summary>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          <p>
            Every lineup it gives you is legal. It refuses to produce one that is not, and says why
            rather than quietly bending a rule.
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>
              {RULES.fullFieldSize} on the field — pitcher, catcher, four infielders, three
              outfielders, a rover — with at least {RULES.minFemalesOnField} women and no more than{' '}
              {RULES.maxMalesOnField} M/X.
            </li>
            <li>
              With only 2 women you field {RULES.fullFieldSize - 1}, not {RULES.fullFieldSize}. The{' '}
              {RULES.maxMalesOnField} M/X cap is what limits it, not the women.
            </li>
            <li>
              Everyone present bats. At most {RULES.maxSameGenderRun} of the same gender in a row,
              and that can happen only once in the whole order — including the wrap from the bottom
              back to the top.
            </li>
            <li>
              At least {RULES.femaleSpotsInOpening.count} female spots in the first{' '}
              {RULES.femaleSpotsInOpening.within} batters. Short on women and every{' '}
              {RULES.autoOutEveryNthFemaleSpot}rd female spot becomes an automatic out.
            </li>
            <li>
              Below {RULES.defaultMinPlayers} players or {RULES.defaultMinFemales} women it is a
              default, and it says so instead of generating.
            </li>
          </ul>
        </div>
      </details>

      <details className="rounded-lg border border-zinc-300 dark:border-zinc-700">
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 py-3 text-base font-medium text-foreground">
          How it decides who plays
        </summary>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          <p>Within the rules it balances four things:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>Nobody plays a position they are not listed for.</li>
            <li>Innings spread evenly across roster players.</li>
            <li>Subs sit whenever your paying players can cover the field.</li>
            <li>People move around rather than being parked in one spot.</li>
          </ul>
          <p>
            Those conflict sometimes. When they do it favours correct positions, so you may see a
            slightly uneven bench in exchange for nobody standing somewhere they cannot play.
          </p>
        </div>
      </details>
    </main>
  )
}
