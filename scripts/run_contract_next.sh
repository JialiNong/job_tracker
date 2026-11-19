#!/usr/bin/env bash
# Contract snapshots against the Next.js app (apps/web) on the local test
# Postgres (tracker_test). Starts `next dev` with apps/web/.env.contract,
# runs tests/contract/run_contract.py against it, then stops the server.
#   ./scripts/run_contract_next.sh                      every case
#   ./scripts/run_contract_next.sh -k jobs- --exclude write-
# Needs: pnpm db:up, and apps/web/.env.contract (see docs/migration-contracts.md).
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-/opt/miniconda3/bin/python3}"
PORT="${CONTRACT_PORT:-3100}"
LOG="${TMPDIR:-/tmp}/tracker_next_contract_${PORT}.log"
TEST_DB="postgresql://tracker:tracker@127.0.0.1:54329/tracker_test"

(
  cd apps/web
  set -a; . ./.env.contract; set +a
  node scripts/copy-legacy-static.mjs >/dev/null
  # TZ=UTC on purpose: dates must not depend on the server's zone
  TZ=UTC NODE_ENV=development exec npx next dev --port "$PORT" >"$LOG" 2>&1
) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; pkill -f "next dev --port $PORT" 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "next dev did not start, see $LOG"; exit 1; }

"$PYTHON" tests/contract/run_contract.py --base-url "http://127.0.0.1:$PORT" \
  --seed-cmd "env DATABASE_URL=$TEST_DB DIRECT_DATABASE_URL=$TEST_DB pnpm --silent db contract:seed" "$@"
