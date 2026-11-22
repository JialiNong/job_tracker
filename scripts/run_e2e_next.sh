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
OPENAI_PORT="${E2E_OPENAI_PORT:-3299}"

# Run AI talks to a local fake OpenAI (tests/e2e/fake_openai.py): no key, no cost
"$PYTHON" tests/e2e/fake_openai.py "$OPENAI_PORT" &
FAKE_OPENAI=$!
disown "$FAKE_OPENAI"

(
  cd apps/web
  set -a; . ./.env.contract; set +a
  # next dev (15.5.29+) expands $ in variables that are already set, which
  # cuts the bcrypt hash ($2b$12$...) to a few characters: escape it here
  case "${TRACKER_PASSWORD_HASH:-}" in *\\*) ;; *) export TRACKER_PASSWORD_HASH="${TRACKER_PASSWORD_HASH//\$/\\\$}" ;; esac
  node scripts/copy-legacy-static.mjs >/dev/null
  # The e2e suite logs in and clicks around: real wall clock, not the pinned one
  unset TRACKER_ALLOW_FIXED_NOW TRACKER_FIXED_NOW
  export OPENAI_API_KEY=e2e-fake OPENAI_BASE_URL="http://127.0.0.1:$OPENAI_PORT/v1"
  export MATCH_PROFILE_PATH="$PWD/../../tests/e2e/fake_cv.md"
  # Fetch details runs a fake scraper (tests/e2e/fake_scrape_job_page.py): no Chrome, no website
  export FETCH_DETAILS_SCRAPER="$PWD/../../tests/e2e/fake_scrape_job_page.py" PYTHON="$PYTHON"
  TZ=UTC NODE_ENV=development exec npx next dev --port "$PORT" >"$LOG" 2>&1
) &
SERVER=$!
trap 'kill $SERVER $FAKE_OPENAI 2>/dev/null; pkill -f "next dev --port $PORT" 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "next dev did not start, see $LOG"; exit 1; }

cd tests/e2e
E2E_STORE=pg_store:PostgresStore E2E_BASE_URL="http://127.0.0.1:$PORT" E2E_FAKE_OPENAI=1 E2E_FAKE_SCRAPER=1 \
  "$PYTHON" -m unittest test_tracker_e2e "$@"
