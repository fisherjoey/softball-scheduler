#!/usr/bin/env bash
# Runs any command with the app's three secrets injected from Bitwarden.
# Nothing is written to disk and no value is ever echoed.
#
#   ./scripts/with-secrets.sh npm run dev
#   ./scripts/with-secrets.sh npm run build
#   ./scripts/with-secrets.sh npm run test:db
#   ./scripts/with-secrets.sh npx drizzle-kit push
#
# If it reports the vault is locked, run:  bw-agent unlock
set -euo pipefail

BW="$HOME/.local/bin/bw-agent"
[ -x "$BW" ] || { echo "bw-agent not found at $BW" >&2; exit 1; }
[ $# -gt 0 ] || { echo "usage: $0 <command> [args...]" >&2; exit 1; }

exec "$BW" exec softball-database-url   --env DATABASE_URL \
  -- "$BW" exec softball-app-password   --env APP_PASSWORD \
  -- "$BW" exec softball-session-secret --env SESSION_SECRET \
  -- "$@"
