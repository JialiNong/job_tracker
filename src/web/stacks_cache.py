"""Cached Stacks tab numbers.

Building them reads every applied job's full JD from Atlas (~1.7 MB for ~350
jobs) and runs ~60 regexes over each one: a few seconds locally and far more
on Render's free plan. The result is ~7 KB, so it is stored in one Mongo
document and the tab reads that instead.

Refreshed nightly by .github/workflows/stack-stats.yml (`python -m
web.stacks_cache`), on demand from the tab's Recompute button, and in the
background when the stored copy is older than MAX_AGE (e.g. the nightly run
failed). No Flask imports: the GitHub runner only has pymongo + python-dotenv.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

from core.db_mongo import APPLICATION_QUERY, get_collection
from web.stacks import build_stack_stats

CACHE_COLLECTION = "stats_cache"
CACHE_ID = "stacks"

# Nightly run + slack. Older than this, the stale copy is still served at once
# and a background refresh replaces it for the next load.
MAX_AGE = timedelta(hours=26)

# The JD text is the input, plus what decides rejected / apply date.
STACKS_PROJECTION = {
    "title": 1,
    "description": 1,
    "status": 1,
    "application_timeline": 1,
    "applied_at": 1,
    "updated_at": 1,
    "matched_at": 1,
}

_refresh_lock = threading.Lock()


def _as_utc(value: datetime) -> datetime:
    # pymongo returns naive datetimes that are UTC
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _response(doc: dict) -> dict:
    computed_at = _as_utc(doc["computed_at"])
    return {**doc["data"], "computed_at": computed_at.isoformat().replace("+00:00", "Z")}


def refresh_stack_stats() -> dict:
    """Recompute from every applied job, store it, and return the API payload.

    Concurrent callers share one run: a second caller waits for the first and
    then returns what it stored instead of reading every JD again.
    """
    started = datetime.now(timezone.utc)
    with _refresh_lock:
        cache = get_collection(CACHE_COLLECTION)
        doc = cache.find_one({"_id": CACHE_ID})
        if doc and _as_utc(doc["computed_at"]) >= started:
            return _response(doc)
        jobs = list(get_collection("matched_jobs").find(APPLICATION_QUERY, STACKS_PROJECTION))
        doc = {
            "_id": CACHE_ID,
            "computed_at": datetime.now(timezone.utc),
            "data": build_stack_stats(jobs),
        }
        cache.replace_one({"_id": CACHE_ID}, doc, upsert=True)
        return _response(doc)


def _refresh_in_background() -> None:
    if _refresh_lock.locked():
        return  # one is already running

    def run():
        try:
            refresh_stack_stats()
        except Exception as exc:  # noqa: BLE001 - keep serving the stale copy
            print(f"[stacks] background refresh failed: {exc}")

    threading.Thread(target=run, name="stacks-refresh", daemon=True).start()


def get_stack_stats(now: datetime | None = None) -> dict:
    """Stored numbers when there are any (refreshing stale ones in the background),
    else compute them now."""
    doc = get_collection(CACHE_COLLECTION).find_one({"_id": CACHE_ID})
    if not doc:
        return refresh_stack_stats()
    now = now or datetime.now(timezone.utc)
    if now - _as_utc(doc["computed_at"]) > MAX_AGE:
        _refresh_in_background()
    return _response(doc)


if __name__ == "__main__":
    result = refresh_stack_stats()
    print(f"[stacks] cached {result['all']['applied']} applications at {result['computed_at']}")
