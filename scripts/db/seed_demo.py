#!/usr/bin/env python3
"""
Load a fictional screenshot dataset into a separate Mongo database.

Does not read or copy production collections. Defaults to `job_scraper_demo`
and refuses the production name `job_scraper` unless you pass --force.

  python3 scripts/db/seed_demo.py
  DATABASE_NAME=job_scraper_demo ./scripts/start_ui_demo.sh
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv
from pymongo import MongoClient

from demo_dataset import build_demo_dataset, dataset_summary

load_dotenv(ROOT / ".env")

PRODUCTION_DB_NAMES = frozenset({"job_scraper"})
DEFAULT_DB = "job_scraper_demo"


def refuses_production_db(db_name: str, force: bool = False) -> bool:
    """True when seeding this name would hit production without --force."""
    return (db_name or "").strip() in PRODUCTION_DB_NAMES and not force


def _redact_uri(uri: str) -> str:
    """Host only — never print DB user/password."""
    parts = urlsplit(uri)
    host = parts.hostname or "localhost"
    netloc = host
    if parts.port:
        netloc = f"{host}:{parts.port}"
    return urlunsplit((parts.scheme or "mongodb", netloc, parts.path, "", ""))


def _indexes(db) -> None:
    jobs = db["jobs"]
    jobs.create_index("link", unique=True)
    jobs.create_index("job_id")
    jobs.create_index("source")
    jobs.create_index("matched_at")
    jobs.create_index("match_score")
    jobs.create_index([("match_score", 1), ("matched_at", -1)])
    jobs.create_index("agent_recommended_at", sparse=True)

    matched = db["matched_jobs"]
    matched.create_index([("matched_at", -1)])
    matched.create_index("status")
    matched.create_index([("status", 1), ("applied_at", -1)])
    matched.create_index("source")
    matched.create_index("origin")
    matched.create_index("link")
    matched.create_index("posting_key", sparse=True)


def seed_database(db, today: datetime | None = None, seed: int = 17) -> dict:
    data = build_demo_dataset(today=today, seed=seed)
    for name in ("matched_jobs", "jobs", "timeout_jobs", "scraper_stats"):
        db.drop_collection(name)
    for name, docs in data.items():
        if docs:
            db[name].insert_many(docs)
    _indexes(db)
    return dataset_summary(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--uri", default=os.getenv("MONGO_URI", "mongodb://localhost:27017/"),
                        help="Mongo URI (default: MONGO_URI from .env)")
    parser.add_argument("--db", default=DEFAULT_DB,
                        help=f"Database name (default: {DEFAULT_DB})")
    parser.add_argument("--force", action="store_true",
                        help="Allow seeding a production database name")
    parser.add_argument("--seed", type=int, default=17, help="RNG seed")
    args = parser.parse_args()

    db_name = (args.db or "").strip()
    if refuses_production_db(db_name, force=args.force):
        print(
            f"Refusing to seed {db_name!r} (production default). "
            f"Use --db {DEFAULT_DB} or pass --force.",
            file=sys.stderr,
        )
        return 2

    print(f"Seeding DEMO database {db_name!r}")
    print(f"  URI: {_redact_uri(args.uri)}")
    client = MongoClient(args.uri, serverSelectionTimeoutMS=8000)
    client.admin.command("ping")
    summary = seed_database(client[db_name], seed=args.seed)
    print(f"  matched_jobs:     {summary['matched_jobs']}")
    print(f"  unmatched jobs:   {summary['unmatched_jobs']}")
    print(f"  applications:     {summary['applications']}")
    print(f"  activity days:    {summary['scraper_stats_days']}")
    print(f"  origins:          {summary['by_origin']}")
    print(f"  scraper origin:   {summary['pipeline_origin']} (always 0)")
    print()
    print("Start the Tracker against this DB (not production):")
    print(f"  DATABASE_NAME={db_name} ./scripts/start_ui_demo.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
