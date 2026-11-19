#!/usr/bin/env bash
# API contract snapshots (tests/contract): every Tracker endpoint's JSON for
# a fixed dataset at a pinned time. Throwaway mongod + server; never touches
# the real database.
#   ./scripts/run_contract.sh            compare against snapshots
#   ./scripts/run_contract.sh --update   rewrite snapshots (review the diff!)
#   ./scripts/run_contract.sh --base-url URL --seed-cmd "..."   another server
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-/opt/miniconda3/bin/python3}"
exec "$PYTHON" tests/contract/run_contract.py "$@"
