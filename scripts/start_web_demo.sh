#!/bin/bash
# Next.js Tracker against the fictional Postgres demo database (never production).
# Seed first: DATABASE_URL=…/tracker_demo DIRECT_DATABASE_URL=… pnpm db demo:seed
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-3001}"

# Prefer explicit DEMO_* URLs, else local docker tracker_demo.
export DATABASE_URL="${DEMO_DATABASE_URL:-${DATABASE_URL:-postgresql://tracker:tracker@127.0.0.1:54329/tracker_demo}}"
export DIRECT_DATABASE_URL="${DEMO_DIRECT_DATABASE_URL:-${DIRECT_DATABASE_URL:-$DATABASE_URL}}"
export TRACKER_DEMO=1
# Session secret still required by iron-session imports even though login is skipped.
export SESSION_SECRET="${SESSION_SECRET:-demo-only-session-secret-not-for-production-use-32}"
export TRACKER_USERNAME="${TRACKER_USERNAME:-demo}"
export TRACKER_PASSWORD_HASH="${TRACKER_PASSWORD_HASH:-\$2b\$12\$placeholderhashnotusedindemomodexxxxxxxxxxxx}"

check_demo_url() {
  local label="$1" url="$2"
  local name
  name="$(DATABASE_URL="$url" python3 - <<'PY'
import os
from urllib.parse import urlparse
print((urlparse(os.environ["DATABASE_URL"]).path or "/").lstrip("/").split("?")[0])
PY
)"
  case "$name" in
    *_demo) ;;
    *)
      echo "Refusing $label database name '$name' (must end with _demo)." >&2
      echo "  Set DEMO_DATABASE_URL / DEMO_DIRECT_DATABASE_URL to …/tracker_demo." >&2
      exit 2
      ;;
  esac
  echo "$name"
}
db_name="$(check_demo_url DATABASE_URL "$DATABASE_URL")"
check_demo_url DIRECT_DATABASE_URL "$DIRECT_DATABASE_URL" >/dev/null

cd "$PROJECT_DIR" || exit 1

echo "Demo Tracker (Next.js)"
echo "  TRACKER_DEMO=1"
echo "  DATABASE_URL host/db ends with: ${db_name}"
echo "  http://127.0.0.1:${PORT}"
echo "  Soft writes allowed; agent / Run AI / Fetch details blocked."
echo "  Ctrl+C to stop."
echo ""

exec pnpm --filter @tracker/web exec next dev --port "$PORT"
