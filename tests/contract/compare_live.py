#!/usr/bin/env python3
"""
Parallel week: compare the live Flask app with the live Next.js app.

Logs in to both, sends the read-only (GET) contract cases to each, and
prints where what the frontend reads differs (consumer_fields.json, null =
missing key, the same rule as the contract snapshots). Nothing is written:
only GET requests.

    python3 tests/contract/compare_live.py --old https://<render-app>.onrender.com --new https://<your-app>.vercel.app

The username comes from LIVE_USERNAME or TRACKER_USERNAME in the repo .env;
the password from LIVE_PASSWORD, else it is asked for (not echoed).

Run it after the nightly Mongo -> Postgres sync (both sides then hold the
same data). Differences right after a change in the old app are expected
until the next sync.
"""
from __future__ import annotations

import argparse
import getpass
import json
import re
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from run_contract import Client, consumer_view, diff_summary  # noqa: E402

# Pages of the Tracker list worth comparing beyond the contract cases
EXTRA_PATHS = [
    "/api/jobs?status=active&country=germany&page=1",
    "/api/jobs?status=all&country=all&page=2",
    "/api/jobs?status=applied&country=all&page=1",
    "/api/unmatched-jobs?page=2",
]
# Fields that differ on purpose (see tests/contract/cases.json drop_keys_why)
DROP_ONLY_FOR = {"/api/unmatched-jobs": {"status", "origin"}, "/api/stats/stacks": {"computed_at"}}


def read_paths() -> list[str]:
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    paths = [
        c["path"] for c in cases
        if c.get("method", "GET") == "GET" and "{" not in c["path"] and c["path"].startswith("/api/")
    ]
    return list(dict.fromkeys(paths + EXTRA_PATHS))


def drop(value, keys: set):
    if isinstance(value, dict):
        return {k: drop(v, keys) for k, v in value.items() if k not in keys}
    if isinstance(value, list):
        return [drop(v, keys) for v in value]
    return value


def keys_to_drop(path: str) -> set:
    for prefix, keys in DROP_ONLY_FOR.items():
        if path.startswith(prefix):
            return keys
    return set()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", required=True, help="Flask app base URL")
    ap.add_argument("--new", required=True, help="Next.js app base URL")
    ap.add_argument("-k", dest="only", help="only paths containing this text")
    args = ap.parse_args()
    user = os.getenv("LIVE_USERNAME", "")
    if not user and (HERE.parents[1] / ".env").exists():
        m = re.search(r"^TRACKER_USERNAME=(.*)$", (HERE.parents[1] / ".env").read_text(encoding="utf-8"), re.M)
        user = m.group(1).strip().strip("'\"") if m else ""
    if not user:
        print("Set LIVE_USERNAME (the Tracker login, same on both apps)")
        return 2
    password = os.getenv("LIVE_PASSWORD") or getpass.getpass(f"Tracker password for {user}: ")

    job_fields = frozenset(json.loads((HERE / "consumer_fields.json").read_text(encoding="utf-8"))["job"])
    old, new = Client(args.old), Client(args.new)
    old.login(user, password)
    new.login(user, password)

    failed = 0
    for path in read_paths():
        if args.only and args.only not in path:
            continue
        s1, b1 = old.json("GET", path)
        s2, b2 = new.json("GET", path)
        dropped = keys_to_drop(path)
        a = consumer_view(drop({"status": s1, "body": b1}, dropped), job_fields)
        b = consumer_view(drop({"status": s2, "body": b2}, dropped), job_fields)
        if a == b:
            print(f"  same {path}")
            continue
        failed += 1
        print(f"  DIFF {path}")
        for line in diff_summary(a, b):
            print(f"         {line}")
    print(f"\n{failed} endpoint(s) differ")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
