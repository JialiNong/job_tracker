"""Compare one old-pipeline run (Mongo) with one new-pipeline run (Postgres).

Parallel-week check: take a snapshot of Mongo into the local Postgres, run
scripts/run_jobs.sh (writes Mongo), then `pnpm pipeline scrape` against the
local Postgres. Both runs started from the same data, so the postings each
one added after the snapshot time should mostly be the same.

    PYTHONPATH=src python3 scripts/tools/compare_pipeline_runs.py --since "2026-11-21 10:00"

--since is Berlin wall time (the snapshot moment). Reads Mongo (MONGO_URI from
.env) and Postgres (DATABASE_URL, default: apps/web/.env.local). Read-only.
Job titles and companies are printed to the terminal only.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from dotenv import dotenv_values, load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from core.job_url import normalize_indeed_job_id  # noqa: E402
from core.mongo.client import get_db  # noqa: E402

BERLIN = ZoneInfo("Europe/Berlin")
THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "7.0"))


def key(source: str, job_id: str) -> tuple[str, str]:
    source = (source or "").lower()
    job_id = str(job_id or "")
    if source == "indeed":
        job_id = normalize_indeed_job_id(job_id) or job_id
    return source, job_id


def where(tracker: bool, score) -> str:
    if tracker:
        return "Tracker"
    if score is None:
        return "not scored"
    return "Unmatched"


def load_mongo(since_naive: datetime, sources: set[str]) -> dict:
    db = get_db()
    query = {"created_at": {"$gte": since_naive}}
    if sources:
        query["source"] = {"$in": sorted(sources)}
    rows = {}
    for d in db["jobs"].find(query, {"source": 1, "job_id": 1, "title": 1, "company": 1, "match_score": 1, "matched_at": 1}):
        rows[key(d.get("source"), d.get("job_id"))] = {
            "title": d.get("title") or "",
            "company": d.get("company") or "",
            "score": d.get("match_score") if d.get("matched_at") else None,
            "tracker": False,
        }
    if rows:
        ids = list({k[1] for k in rows} | {f"job_{k[1]}" for k in rows if k[0] == "indeed"})
        for m in db["matched_jobs"].find({"job_id": {"$in": ids}}, {"source": 1, "job_id": 1}):
            k = key(m.get("source"), m.get("job_id"))
            if k in rows:
                rows[k]["tracker"] = True
    return rows


def load_pg(since_aware: datetime, sources: set[str]) -> dict:
    import psycopg

    url = os.getenv("DATABASE_URL") or dotenv_values(ROOT / "apps/web/.env.local").get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set")
    if "neon.tech" in url:
        print("Note: DATABASE_URL points at Neon; during the parallel week Neon holds the nightly Mongo copy, not a new-pipeline run.\n")
    sql = """
        SELECT j.source, j.external_id, j.title, j.company, a.match_score, (ap.id IS NOT NULL) AS tracker
        FROM jobs j
        LEFT JOIN job_analyses a ON a.id = j.current_analysis_id
        LEFT JOIN applications ap ON ap.job_id = j.id
        WHERE j.scraped_at >= %s
    """
    params: list = [since_aware]
    if sources:
        sql += " AND j.source = ANY(%s)"
        params.append(sorted(sources))
    rows = {}
    with psycopg.connect(url, connect_timeout=15) as conn:
        for source, ext, title, company, score, tracker in conn.execute(sql, params):
            rows[key(source, ext)] = {"title": title, "company": company, "score": score, "tracker": tracker}
    return rows


def label(k, row) -> str:
    return f"  [{k[0]}] {row['title'][:60]} @ {row['company'][:30]}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", required=True, help='snapshot time, Berlin wall time, e.g. "2026-11-21 10:00"')
    ap.add_argument("--sources", default="linkedin,indeed", help="comma list; empty = all (default: linkedin,indeed)")
    ap.add_argument("--score-gap", type=float, default=2.0, help="report scores further apart than this (default 2.0)")
    args = ap.parse_args()

    since = datetime.fromisoformat(args.since)
    sources = {s.strip().lower() for s in args.sources.split(",") if s.strip()}
    old = load_mongo(since.replace(tzinfo=None), sources)
    new = load_pg(since.replace(tzinfo=BERLIN), sources)

    both = old.keys() & new.keys()
    only_old = old.keys() - new.keys()
    only_new = new.keys() - old.keys()

    print(f"Postings added since {args.since} ({', '.join(sorted(sources)) or 'all sources'})\n")
    print(f"{'':12}{'old (Mongo)':>14}{'new (Postgres)':>16}")
    for src in sorted({k[0] for k in old.keys() | new.keys()}):
        o = [r for k, r in old.items() if k[0] == src]
        n = [r for k, r in new.items() if k[0] == src]
        print(f"{src:12}{len(o):>14}{len(n):>16}")
        for name in ("Tracker", "Unmatched", "not scored"):
            oc = sum(where(r["tracker"], r["score"]) == name for r in o)
            nc = sum(where(r["tracker"], r["score"]) == name for r in n)
            print(f"  {name:10}{oc:>14}{nc:>16}")
    print(f"\nIn both: {len(both)}   only old: {len(only_old)}   only new: {len(only_new)}")

    moved = [k for k in both if where(old[k]["tracker"], old[k]["score"]) != where(new[k]["tracker"], new[k]["score"])]
    gaps = [
        k for k in both
        if old[k]["score"] is not None and new[k]["score"] is not None
        and abs(old[k]["score"] - new[k]["score"]) > args.score_gap
    ]

    if moved:
        print(f"\nSame posting, different place ({len(moved)}):")
        for k in sorted(moved):
            o, n = old[k], new[k]
            print(f"{label(k, o)}\n      old: {where(o['tracker'], o['score'])} {o['score']}   new: {where(n['tracker'], n['score'])} {n['score']}")
    if gaps:
        print(f"\nScores more than {args.score_gap} apart ({len(gaps)}):")
        for k in sorted(gaps):
            print(f"{label(k, old[k])}\n      old: {old[k]['score']}   new: {new[k]['score']}")
    for title, keys, rows in (("Only in the old run", only_old, old), ("Only in the new run", only_new, new)):
        if keys:
            print(f"\n{title} ({len(keys)}):")
            for k in sorted(keys):
                r = rows[k]
                print(f"{label(k, r)}  -> {where(r['tracker'], r['score'])} {r['score'] if r['score'] is not None else ''}")


if __name__ == "__main__":
    main()
