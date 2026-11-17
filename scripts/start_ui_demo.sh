#!/bin/bash
# Tracker UI against the screenshot/demo database (never production).
# Seed first: python3 scripts/db/seed_demo.py
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${DATABASE_NAME:-}" = "job_scraper" ]; then
  echo "Refusing DATABASE_NAME=job_scraper (production)." >&2
  echo "  Unset it, or use job_scraper_demo." >&2
  exit 2
fi
export DATABASE_NAME="${DATABASE_NAME:-job_scraper_demo}"
PORT="${1:-5051}"

cd "$PROJECT_DIR" || exit 1

echo "Demo Tracker UI"
echo "  DATABASE_NAME=${DATABASE_NAME}"
echo "  http://127.0.0.1:${PORT}"
echo "  Production DB is not used. Ctrl+C to stop."
echo ""

exec "$PROJECT_DIR/scripts/start_ui.sh" "$PORT"
