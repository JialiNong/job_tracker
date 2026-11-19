"""Single source of "now" for the Tracker.

Contract and e2e tests pin the clock so date-dependent responses (heatmap,
weekly bars, "applied 30+ days ago") stay stable from day to day:

    TRACKER_FIXED_NOW=2026-11-13T12:00   (local wall-clock time, no zone)

It is honoured only when TRACKER_ALLOW_FIXED_NOW=1 is also set, so a stray
variable in production cannot freeze time. The replacement stack (Next.js)
reads the same two variables.

`now()` and `utcnow()` keep the two behaviours the code already had: naive
local time and naive UTC. Both move together when the clock is pinned.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone


def _fixed_now() -> datetime | None:
    if os.getenv("TRACKER_ALLOW_FIXED_NOW") != "1":
        return None
    raw = (os.getenv("TRACKER_FIXED_NOW") or "").strip()
    if not raw:
        return None
    return datetime.fromisoformat(raw).replace(tzinfo=None)


def now(tz: timezone | None = None) -> datetime:
    """Like datetime.now(tz)."""
    fixed = _fixed_now()
    if fixed is None:
        return datetime.now(tz)
    if tz is None:
        return fixed
    return fixed.astimezone(tz)


def utcnow() -> datetime:
    """Like the deprecated datetime.utcnow(): naive UTC."""
    fixed = _fixed_now()
    if fixed is None:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    return fixed.astimezone(timezone.utc).replace(tzinfo=None)


def today() -> date:
    """Like date.today()."""
    return now().date()
