#!/bin/bash
# start_ui.sh - Start the Job Tracker Web UI
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-python3}"  # override: PYTHON=/path/to/python3 ./scripts/start_ui.sh
# Avoid 5000: macOS AirPlay Receiver binds *:5000 and returns HTTP 403.
PORT="${1:-5050}"

cd "$PROJECT_DIR" || exit 1

if ! "$PYTHON" -c 'import flask, pymongo, web' 2>/dev/null; then
    echo "error: $PYTHON cannot import the project dependencies." >&2
    echo "  Activate the project environment, or run: PYTHON=/path/to/python3 $0" >&2
    exit 1
fi

echo "🌐 Starting Job Tracker UI at http://127.0.0.1:${PORT}"
echo "   HTML/Python saves restart the server; the browser then refreshes."
echo "   Tracker HTML is not cached, so a refresh also picks up template edits."
echo "   Press Ctrl+C to stop."
echo ""

# Open browser after a short delay
(sleep 1.5 && open "http://127.0.0.1:${PORT}") &

exec "$PYTHON" src/web/web_app.py --port "$PORT" --reload
