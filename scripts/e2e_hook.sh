#!/usr/bin/env bash
# Claude Code Stop hook: when Claude finishes a turn, run unit + browser E2E
# tests IF the web UI's code changed since the last run.
#
#   - Watches the content of the Next.js app (apps/web), the TS packages, the
#     Python web/scraper code, scripts/tools and tests/ (not git state, so
#     committing does not trigger a re-run).
#   - Runs: Python unit tests; the Next.js e2e suite (./scripts/run_e2e_next.sh)
#     when the local test Postgres is up; the old Mongo e2e when mongod exists.
#   - Pass: prints a one-line note and lets Claude stop.
#   - Fail: exit 2 + failure summary on stderr, so Claude sees it and fixes it.
#     The same failing code is reported once only (no endless loop).
#   - Full output of the last run: logs/e2e_last.log
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0

PYTHON="${PYTHON:-/opt/miniconda3/bin/python3}"
STATE_FILE="logs/.e2e_hook_state"
LOG_FILE="logs/e2e_last.log"
mkdir -p logs

fingerprint=$(git ls-files -co --exclude-standard -- \
    apps/web/src apps/web/next.config.ts packages/core/src packages/db/src packages/db/prisma \
    packages/matching/src packages/pipeline/src \
    src/web src/services src/core src/scrapers templates static tests scripts/tools scripts/run_e2e_next.sh \
  | grep -v '__pycache__' | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)

last=""
[ -f "$STATE_FILE" ] && last=$(cut -d' ' -f1 "$STATE_FILE")
[ "$fingerprint" = "$last" ] && exit 0   # nothing relevant changed (or already reported)

pg_up() { nc -z 127.0.0.1 54329 >/dev/null 2>&1 && [ -f apps/web/.env.contract ]; }
has_mongod() { command -v mongod >/dev/null || [ -x /opt/homebrew/bin/mongod ]; }
skipped=""

{
  echo "== unit tests =="; "$PYTHON" -m unittest discover -s tests 2>&1; unit=$?
  next=0
  if pg_up; then
    echo; echo "== next e2e tests =="; PYTHON="$PYTHON" ./scripts/run_e2e_next.sh 2>&1; next=$?
  else
    echo; echo "== next e2e skipped: test Postgres not up (pnpm db:up) =="
  fi
  e2e=0
  if has_mongod; then
    echo; echo "== mongo e2e tests =="; "$PYTHON" -m unittest discover -s tests/e2e -v 2>&1; e2e=$?
  fi
  echo "unit_exit=$unit next_exit=$next e2e_exit=$e2e"
} > "$LOG_FILE" 2>&1

pg_up || skipped=" (Next e2e skipped: run pnpm db:up)"

if grep -q "unit_exit=0 next_exit=0 e2e_exit=0" "$LOG_FILE"; then
  echo "$fingerprint pass" > "$STATE_FILE"
  ran=$(grep -E "^Ran [0-9]+ tests" "$LOG_FILE" | awk '{s+=$2} END {print s}')
  echo "{\"systemMessage\": \"Tests passed: ${ran} (unit + E2E)${skipped}\"}"
  exit 0
fi

echo "$fingerprint fail" > "$STATE_FILE"
{
  echo "Unit/E2E tests failed after your changes. Fix them before finishing."
  echo "Full log: $LOG_FILE (rerun: ./scripts/run_e2e_next.sh)"
  echo
  # Failure blocks (FAIL:/ERROR: headers + tracebacks), capped
  awk '/^(FAIL|ERROR):/{p=1} /^Ran [0-9]+ tests/{p=0} p' "$LOG_FILE" | head -80
  grep -E "^(FAILED|OK)" "$LOG_FILE"
} >&2
exit 2
