#!/usr/bin/env bash
# Browser e2e suite against the Next.js app (apps/web) on the local test
# Postgres (tracker_test), with the Postgres store (tests/e2e/pg_store.py).
#   ./scripts/run_e2e_next.sh                 every test
#   ./scripts/run_e2e_next.sh -k tracker      unittest -k patterns
# Needs: pnpm db:up, apps/web/.env.contract, pip install -r requirements-dev.txt
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-/opt/miniconda3/bin/python3}"
PORT="${E2E_PORT:-3200}"
LOG="${TMPDIR:-/tmp}/tracker_next_e2e_${PORT}.log"

(
  cd apps/web
  set -a; . ./.env.contract; set +a
  node scripts/copy-legacy-static.mjs >/dev/null
  # The e2e suite logs in and clicks around: real wall clock, not the pinned one
  unset TRACKER_ALLOW_FIXED_NOW TRACKER_FIXED_NOW
  TZ=UTC NODE_ENV=development exec npx next dev --port "$PORT" >"$LOG" 2>&1
) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; pkill -f "next dev --port $PORT" 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "next dev did not start, see $LOG"; exit 1; }

cd tests/e2e
E2E_STORE=pg_store:PostgresStore E2E_BASE_URL="http://127.0.0.1:$PORT" \
  "$PYTHON" -m unittest test_tracker_e2e "$@"
