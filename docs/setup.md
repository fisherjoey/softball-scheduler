# Database setup (already applied)

This project shares a Supabase project (`fwckdmwwjrewwmijbwio`, "ContractTracker",
region `us-east-1`) with a paid client billing app (Tracker). The softball scheduler
gets its own Postgres schema and its own least-privilege role so it can never read
or write the client's `public` tables.

**This setup has already been run, once, by hand, in that project's Supabase SQL
editor.** It is recorded here for reproducibility (e.g. standing up a second
environment) — do not run it again against this project, and do not attempt to
create the schema or role from application code or migrations.

```sql
create schema if not exists softball;

create role softball_app login password 'REPLACE_ME';

grant usage, create on schema softball to softball_app;
grant all on all tables in schema softball to softball_app;
grant all on all sequences in schema softball to softball_app;
alter default privileges in schema softball grant all on tables to softball_app;
alter default privileges in schema softball grant all on sequences to softball_app;

-- Isolation: this app must never be able to reach public.time_entries.
revoke all on schema public from softball_app;
revoke all on all tables in schema public from softball_app;
```

Verified live (2026-07-27): schema `softball` exists and was empty of tables prior
to this task's migration; role `softball_app` exists with usage+create on
`softball`; a `select` against `public.time_entries` as `softball_app` returns
Postgres error `42501` (insufficient privilege) — the isolation holds.

## Connection

`DATABASE_URL` uses Supabase's **transaction pooler**, not a direct connection:

```
postgres://softball_app.<project-ref>:<password>@aws-1-us-east-1.pooler.supabase.com:6543/postgres
```

Notes:
- Host is `aws-1-us-east-1.pooler.supabase.com` (not `aws-0`).
- Username form is `softball_app.<project-ref>` (the project ref is part of the
  username, required by the pooler to route to the right project).
- Because this is the **transaction** pooler, `postgres.js` must be constructed
  with `{ prepare: false }` — session-level features like prepared statements
  are not supported across pooled transactions. `lib/db/client.ts` does this.
- The Supabase **service-role key is deliberately not used anywhere** in this
  project. All access goes through the scoped `softball_app` Postgres role over
  a plain connection string, so the blast radius of a leaked credential is
  limited to the `softball` schema.
- The real value lives in Bitwarden (`softball-database-url`) and is supplied at
  runtime via `bw-agent exec softball-database-url --env DATABASE_URL -- <cmd>`.
  It is never committed, never placed in `.env.local`, and never printed.

## Running migrations (`drizzle-kit push`)

`drizzle-kit push`'s introspection step (`[Pulling schema from database...]`)
fires several per-table metadata queries concurrently over a single
connection. Supabase's **transaction pooler** (port 6543, the one the app
uses) multiplexes each statement to a possibly different backend session and
does not support that concurrency; once there are real tables to introspect,
this reliably crashes `drizzle-kit push` with
`TypeError: Cannot read properties of undefined (reading 'replace')` deep in
its check-constraint parsing (a result row from the wrong query gets
attributed to the wrong statement). It does **not** show up on a brand-new,
empty schema, which is why the very first push in this project worked fine.

Workaround: run `drizzle-kit push` itself (only this one-off CLI operation,
never the app's runtime connection) against the same credential's **session
pooler** port instead — same host, same username/password, just `5432`
instead of `6543`. This is a standard Supabase convention (the pooler serves
both modes on the same hostname), not a different secret:

```bash
~/.local/bin/bw-agent exec softball-database-url --env DATABASE_URL -- node -e "
  const { execSync } = require('child_process');
  const u = new URL(process.env.DATABASE_URL);
  u.port = '5432';
  process.env.DATABASE_URL = u.toString();
  execSync('npx drizzle-kit push', { stdio: 'inherit', env: process.env });
"
```

`lib/db/client.ts` (the app's own connection) keeps using the transaction
pooler on 6543 with `{ prepare: false }` — this workaround only applies to
one-off `drizzle-kit` CLI runs.

## Running the database integration test

`lib/db/queries.integration.test.ts` round-trips real rows against the live
database and cleans up after itself. It's excluded from the default `npm
test` (via `vitest.config.ts`'s exclude glob) so the everyday unit suite
never needs a connection. Run it deliberately:

```bash
~/.local/bin/bw-agent exec softball-database-url --env DATABASE_URL -- npm run test:db
```
