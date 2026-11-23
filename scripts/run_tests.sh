#!/usr/bin/env bash
# Run the tests that belong to one area of the Next.js app (unit + e2e).
#
# Suites follow the pages / features, not the old Flask tree. Python unit
# tests are only in `scrape` (the LinkedIn / Indeed browser scrapers).
#
#   ./scripts/run_tests.sh                 list suites
#   ./scripts/run_tests.sh tracker         Jobs list, cards, timeline, filters, Overview
#   ./scripts/run_tests.sh fetch           Fetch details / batch / Run AI
#   ./scripts/run_tests.sh log-job         Log Job page + agent push
#   ./scripts/run_tests.sh unmatched
#   ./scripts/run_tests.sh timeouts
#   ./scripts/run_tests.sh matching        AI matcher (packages/matching + Run AI e2e)
#   ./scripts/run_tests.sh scrape          Sources + Python page scrapers
#   ./scripts/run_tests.sh ui              Display helpers + every page loads
#   ./scripts/run_tests.sh unit            Every Vitest suite (no e2e, no Flask)
#   ./scripts/run_tests.sh e2e             Every browser e2e test (Next.js)
#
# Extra args after the suite go to that runner (e.g. ./scripts/run_tests.sh fetch -v).
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-/opt/miniconda3/bin/python3}"

usage() {
  cat <<'EOF'
Suites — change one area, run that suite (Vitest unit + the matching e2e):

  login        Login / logout
  tracker      Tracker Jobs: list, chips, search, filters, cards, timeline, Overview / Stacks
  fetch        Fetch details, Run AI, batch select / delete
  unmatched    Unmatched page
  timeouts     Timeouts page
  log-job      Log Job page + POST /api/agent/jobs
  matching     AI matcher, JD quality, Run AI
  scrape       API / ATS sources (packages/pipeline) + Python page scrapers
  ui           Display helpers + every page loads
  unit         All Vitest packages + apps/web (no e2e, no Flask)
  e2e          All browser e2e tests against Next.js (./scripts/run_e2e_next.sh)

E2E files (tests/e2e/test_*_e2e.py), grouped by page:

  Login              test_login_e2e.py
  Tracker list       test_tracker_list_e2e.py
  Tracker cards      test_tracker_card_e2e.py
  Tracker Overview   test_tracker_overview_e2e.py
  Fetch / Run AI     test_tracker_fetch_e2e.py
  Unmatched          test_unmatched_e2e.py
  Timeouts           test_timeouts_e2e.py
  Log Job            test_log_job_e2e.py
  Pages load         test_pages_e2e.py

Vitest (Next.js + packages), grouped by feature:

  tracker      apps/web test/filters, tracker-jobs, format, overview-layout, timeline
               + @tracker/core
  fetch        apps/web test/fetch-details, fetch-targets, batch-progress
  matching     @tracker/matching
  scrape       @tracker/pipeline  (+ Python page scrapers only)
  ui           apps/web test/format, overview-layout

Examples:
  ./scripts/run_tests.sh fetch
  ./scripts/run_tests.sh tracker -k chip
  ./scripts/run_tests.sh e2e -k Unmatched
EOF
}

py_scrape() {
  echo "== python scrapers: $* =="
  (cd tests && "$PYTHON" -m unittest "$@")
}

vitest_pkg() {
  echo "== vitest: $* =="
  pnpm --filter "$1" test
}

vitest_web() {
  echo "== vitest @tracker/web: $* =="
  pnpm --filter @tracker/web test -- "$@"
}

e2e() {
  echo "== e2e: $* =="
  PYTHON="$PYTHON" ./scripts/run_e2e_next.sh "$@"
}

SUITE="${1:-}"
if [[ -z "$SUITE" || "$SUITE" == "-h" || "$SUITE" == "--help" ]]; then
  usage
  exit 0
fi
shift || true

case "$SUITE" in
  login)
    e2e test_login_e2e.py "$@"
    ;;
  tracker)
    vitest_pkg @tracker/core
    vitest_web test/filters.test.ts test/tracker-jobs.test.ts test/format.test.ts \
      test/overview-layout.test.ts test/timeline.test.ts
    # Pass the page modules (not three -k class names): unittest -k is OR, so
    # extra -k after class names would not narrow (./scripts/run_tests.sh tracker -k chip).
    e2e test_tracker_list_e2e.py test_tracker_card_e2e.py test_tracker_overview_e2e.py "$@"
    ;;
  fetch)
    vitest_web test/fetch-details.test.ts test/fetch-targets.test.ts test/batch-progress.test.ts
    e2e test_tracker_fetch_e2e.py "$@"
    ;;
  unmatched)
    e2e test_unmatched_e2e.py "$@"
    ;;
  timeouts)
    e2e test_timeouts_e2e.py "$@"
    ;;
  log-job)
    e2e test_log_job_e2e.py "$@"
    ;;
  matching)
    vitest_pkg @tracker/matching
    e2e test_tracker_fetch_e2e.py -k run_ai "$@"
    ;;
  scrape)
    vitest_pkg @tracker/pipeline
    py_scrape \
      test_scrape_job_page_cli test_job_page_generic test_content_wait \
      test_title_gate test_manual_linkedin_scrape
    ;;
  ui)
    vitest_web test/format.test.ts test/overview-layout.test.ts
    e2e test_pages_e2e.py test_login_e2e.py "$@"
    ;;
  unit)
    echo "== vitest: packages + apps/web =="
    pnpm --filter @tracker/core test
    pnpm --filter @tracker/db test
    pnpm --filter @tracker/matching test
    pnpm --filter @tracker/pipeline test
    pnpm --filter @tracker/web test
    ;;
  e2e)
    e2e "$@"
    ;;
  *)
    echo "Unknown suite: $SUITE" >&2
    usage >&2
    exit 1
    ;;
esac
