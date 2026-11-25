#!/usr/bin/env python3
"""
Build the fictional demo dataset and print Extended JSON for Postgres seeding.

Used by `pnpm db demo:seed` (packages/db). Never reads production data.
Assigns deterministic 24-hex ids so transform() can load rows into Neon.

Uses only the stdlib (no bson package): emits `$oid` / `$date` shapes that
`EJSON.parse` in packages/db understands.

  python3 scripts/db/export_demo_json.py > /tmp/demo.json
  python3 scripts/db/export_demo_json.py --seed 17 --today 2026-11-17T15:00:00
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date, datetime
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parents[1]
sys.path.insert(0, str(_ROOT / "src"))  # core.*
sys.path.insert(0, str(_HERE))
from demo_dataset import build_demo_dataset  # noqa: E402


def demo_oid_hex(kind: str, index: int) -> str:
    """Stable 24-hex id from kind + index (not random)."""
    return hashlib.md5(f"demo:{kind}:{index}".encode()).hexdigest()[:24]


def ejson_default(obj: object):
    if isinstance(obj, datetime):
        return {"$date": obj.isoformat()}
    if isinstance(obj, date):
        return {"$date": datetime(obj.year, obj.month, obj.day).isoformat()}
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def assign_ids(data: dict) -> dict:
    matched = []
    for i, doc in enumerate(data["matched_jobs"]):
        row = dict(doc)
        row["_id"] = {"$oid": demo_oid_hex("matched", i)}
        matched.append(row)

    unmatched = []
    for i, doc in enumerate(data["jobs"]):
        row = dict(doc)
        row["_id"] = {"$oid": demo_oid_hex("unmatched", i)}
        unmatched.append(row)

    return {
        "matched_jobs": matched,
        "jobs": unmatched,
        "timeout_jobs": data.get("timeout_jobs") or [],
        "scraper_stats": data["scraper_stats"],
        "company_profiles": data.get("company_profiles") or [],
        "stats_cache": data.get("stats_cache") or [],
    }


def parse_today(raw: str | None) -> datetime | None:
    if not raw:
        return None
    text = raw.strip()
    if text.endswith("Z"):
        text = text[:-1]
    return datetime.fromisoformat(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seed", type=int, default=17, help="RNG seed (default 17)")
    parser.add_argument("--today", default=None, help="ISO datetime pinned as 'today' (tests)")
    args = parser.parse_args()

    data = build_demo_dataset(today=parse_today(args.today), seed=args.seed)
    payload = {"collections": assign_ids(data)}
    json.dump(payload, sys.stdout, default=ejson_default, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
