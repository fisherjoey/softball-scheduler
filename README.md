# Softball Lineup Generator

Builds a legal, fair fielding grid and batting order for a Calgary Sport & Social Club co-ed
slo-pitch team, from a roster that persists between games. It replaces doing it by hand on a
clipboard while people are still arriving.

One user — the captain — on a phone, at the diamond. Draft a lineup the night before, then adjust
it at the field for whoever actually turned up.

## What it does

- **Roster** — players and subs, each with the positions they can cover (primary or backup).
- **Games** — a date, an opponent, and an attendance list, including who is arriving late and who
  is leaving early.
- **Lineup** — a fielding grid (every position, every inning) and a batting order, generated
  client-side so Reshuffle is instant and the screen still works on bad cell signal.
  - **Reshuffle** re-solves with the next seed.
  - **Pin** holds a player at a position for an inning; pinned cells survive Reshuffle.
  - **Swap** exchanges two players by tapping one then the other (or dragging, with a mouse).
    An illegal swap is refused with the rule it would break, and the grid is left alone.
  - **Mid-game** — say how many innings you have played, and Reshuffle only re-solves the rest.
    Innings already played are copied across untouched.
  - Warnings explain themselves: why a sub is fielding, why a pin was dropped, why an inning
    fields nine instead of ten.

## League rules encoded

Every rule parameter lives in [`lib/rules/config.ts`](lib/rules/config.ts) — a rulebook correction
is a constant change, not a code change. Nothing in the solver hardcodes a league number.

**Fielding**

- A full defence is 10: pitcher, catcher, four infielders, three outfielders, rover.
- At least 3 women on the field; at most 7 M/X players.
- Therefore `maxFielders = min(10, playersPresent, femalesAvailable + 7)` — with 2 women you field
  9, not 10, because the M/X cap binds. Positions are surrendered in a configured drop order,
  Rover first.
- Fewer than 7 players, or fewer than 2 women, is a default. The app says so and blocks generation
  rather than quietly producing an illegal lineup.

**Batting**

- Everyone present bats. You may bat without fielding, but not field without batting.
- 3 female spots within the first 10 slots.
- At most 3 of the same gender in a row, and a run of exactly 3 may occur only once in the whole
  order — including the wrap from the bottom back to the top.
- With fewer than 3 women present, every 3rd female spot is an automatic out. With 3 or more, a
  surplus female spot repeats a woman already in the order.

**Fairness** (goals, not rules — the solver optimises these and the captain can overrule them)

- Even innings across roster players; subs sit before roster players do.
- Spread people around positions rather than parking them.
- Honour position eligibility, preferring primary over backup.
- Rotate batting slots against the last four games.

Full design and the rulebook citations:
[`docs/superpowers/specs/2026-07-27-softball-scheduler-design.md`](docs/superpowers/specs/2026-07-27-softball-scheduler-design.md).

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · Drizzle ORM · Postgres (Supabase, own `softball`
schema and least-privilege role) · Vitest. The solver is pure TypeScript under `lib/solver/` with no
I/O, which is why it can run in the browser and be property-tested.

## Local setup

1. **Database.** The `softball` schema, its scoped `softball_app` role, and the connection details
   are documented in [`docs/setup.md`](docs/setup.md). That one-time SQL has already been applied
   to the live project — read it before running it anywhere.

2. **Environment.** Copy `.env.example` to `.env.local` and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   | Variable | What it is |
   |---|---|
   | `DATABASE_URL` | Supabase **transaction pooler** connection string for the `softball_app` role. Not the service-role key. |
   | `APP_PASSWORD` | The shared password for the single-user login gate. |
   | `SESSION_SECRET` | Random 32+ character string, used to sign the session cookie. |

   In this workspace the real `DATABASE_URL` is not written to a file at all — it lives in
   Bitwarden and is injected per command:

   ```bash
   ~/.local/bin/bw-agent exec softball-database-url --env DATABASE_URL -- npm run dev
   ```

3. **Run it.**

   ```bash
   npm install
   npm run dev      # http://localhost:3000
   ```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server. |
| `npm run build` | Production build. Needs `DATABASE_URL` set — the route modules import the database client at module scope. |
| `npm start` | Serve the production build. |
| `npm test` | The unit and component suite. No network, no database. |
| `npm run test:db` | The live-database integration test. Deliberately excluded from `npm test`; run it with `bw-agent exec` as above. |
| `npm run lint` | ESLint. |

## Deploying

Ready for `vercel deploy`. Three environment variables must be set on the Vercel project, for every
environment it should run in: `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`.
