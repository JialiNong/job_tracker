"""
Postgres storage for the browser scrapers (LinkedIn / Indeed).

The scrapers save through five functions from `core.db_mongo`; with
TRACKER_STORE=postgres, `core.db_mongo` hands them these instead, so the
scraper code itself does not change (docs/pg-schema.md has the tables).

Rows are written the way the Mongo -> Postgres migration writes them
(packages/db/src/transform.ts), so a job scraped after the cutover looks
like one migrated from before it.

Connection: DATABASE_URL (the same variable the Next.js app uses).
"""
from __future__ import annotations

import os
import secrets
import time
from datetime import timezone
from zoneinfo import ZoneInfo

from core import clock
from core.job_url import indeed_job_id_variants, posting_key_fields

BERLIN = ZoneInfo("Europe/Berlin")
STAT_KEYS = ("title_passed_clicked", "german_filtered", "ai_title_filtered", "detail_timeout")

_conn = None


def _connect():
    """One autocommit connection per process (scrapers write one row at a time)."""
    global _conn
    if _conn is None or _conn.closed:
        import psycopg
        from psycopg.rows import dict_row

        url = os.getenv("DATABASE_URL", "").strip()
        if not url:
            raise RuntimeError("DATABASE_URL is not set (needed with TRACKER_STORE=postgres)")
        _conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)
    return _conn


def _now():
    """Timezone-aware now (honours the pinned test clock)."""
    return clock.now(timezone.utc)


def new_record_id() -> str:
    """24-hex id like a Mongo ObjectId: 4 bytes of seconds, then random (same as apps/web ids.ts)."""
    return f"{int(time.time()):08x}{secrets.token_hex(8)}"


def _id_variants(job_id, source) -> list[str]:
    """The job ids to match (Indeed stored jk with job_/sj_ prefixes too)."""
    job_id = str(job_id or "").strip()
    if source == "indeed":
        return indeed_job_id_variants(job_id) or [job_id]
    return [job_id]


def init_db() -> None:
    """Check the connection (Postgres tables come from Prisma migrations, not from here)."""
    _connect().execute("SELECT 1")
    print("Postgres store ready (jobs, scrape_timeouts, scraper stats)")


def is_job_id_exists(job_id, source="linkedin") -> bool:
    """True if this posting is already stored (Tracker cards included: they share the jobs row)."""
    row = _connect().execute(
        "SELECT 1 FROM jobs WHERE source = %s AND external_id = ANY(%s) LIMIT 1",
        (source, _id_variants(job_id, source)),
    ).fetchone()
    return row is not None


def save_job(job_data: dict) -> bool:
    """
    Store one scraped posting. False when it is already there (same source +
    job id, or the same ad under another URL: posting_key), like the Mongo
    unique index.
    """
    now = _now()
    source = job_data.get("source") or "linkedin"
    link = job_data.get("link") or ""
    posting_key = job_data.get("posting_key") or posting_key_fields(link).get("posting_key")
    try:
        row = _connect().execute(
            """
            INSERT INTO jobs (
                id, source, external_id, link, title, company, location, description, applicants,
                posting_key, dedup_key, keyword, run_id,
                description_quality, description_quality_reason, description_empty, description_incomplete,
                scraped_at, updated_at
            ) VALUES (
                %(id)s, %(source)s, %(external_id)s, %(link)s, %(title)s, %(company)s, %(location)s,
                %(description)s, %(applicants)s, %(posting_key)s, %(dedup_key)s, %(keyword)s, %(run_id)s,
                %(quality)s, %(quality_reason)s, %(empty)s, %(incomplete)s, %(now)s, %(now)s
            )
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            {
                "id": new_record_id(),
                "source": source,
                "external_id": str(job_data.get("job_id") or ""),
                "link": link,
                "title": job_data.get("title") or "",
                "company": job_data.get("company") or "",
                "location": job_data.get("location") or "",
                "description": job_data.get("description") or "",
                "applicants": job_data.get("applicants") or "",
                "posting_key": posting_key or None,
                "dedup_key": job_data.get("dedup_key") or None,
                "keyword": job_data.get("keyword") or None,
                "run_id": job_data.get("run_id") or os.getenv("PIPELINE_RUN_ID", "").strip() or None,
                "quality": job_data.get("description_quality") or None,
                "quality_reason": job_data.get("description_quality_reason") or None,
                "empty": bool(job_data.get("description_empty")),
                "incomplete": bool(job_data.get("description_incomplete")),
                "now": now,
            },
        ).fetchone()
    except Exception as e:
        print(f"❌ Error saving job: {e}")
        return False
    if row is None:
        print(f"⚠️  Job already exists: {job_data.get('title', 'Untitled')}")
        return False
    print(f"✅ Saved job: {job_data.get('title', 'Untitled')} (ID: {row['id']})")
    return True


def increment_scraper_stat(key: str, amount: int = 1) -> None:
    """Add to the all-time counter and to today's (Berlin day) counter."""
    if key not in STAT_KEYS:
        raise ValueError(f"Unknown scraper stat: {key}")
    now = _now()
    day = now.astimezone(BERLIN).date()
    conn = _connect()
    # key is checked against STAT_KEYS above, so it is safe as a column name
    conn.execute(
        f"""
        INSERT INTO scraper_totals (id, {key}, updated_at) VALUES (1, %(n)s, %(now)s)
        ON CONFLICT (id) DO UPDATE SET {key} = scraper_totals.{key} + %(n)s, updated_at = %(now)s
        """,
        {"n": amount, "now": now},
    )
    conn.execute(
        f"""
        INSERT INTO scraper_daily_stats (day, {key}, updated_at) VALUES (%(day)s, %(n)s, %(now)s)
        ON CONFLICT (day) DO UPDATE SET {key} = scraper_daily_stats.{key} + %(n)s, updated_at = %(now)s
        """,
        {"day": day, "n": amount, "now": now},
    )


def save_timeout_job(
    *,
    title,
    job_id,
    link,
    source,
    company="",
    location="",
    keyword="",
    reason="detail_timeout",
) -> bool:
    """
    Keep a title-qualified card whose detail panel timed out, for the
    Timeouts page. Skipped when the posting is already stored or was added
    to the Tracker from Timeouts before.
    """
    title = (title or "").strip()
    job_id = str(job_id or "").strip()
    source = (source or "").strip().lower()
    if not title or not job_id or not source:
        return False
    if is_job_id_exists(job_id, source):
        return False

    conn = _connect()
    variants = _id_variants(job_id, source)
    existing = conn.execute(
        "SELECT id, review_status FROM scrape_timeouts WHERE source = %s AND external_id = ANY(%s) LIMIT 1",
        (source, variants),
    ).fetchone()
    if existing and existing["review_status"] == "added":
        return False

    link = (link or "").strip()
    if source == "indeed" and (not link or not link.startswith("http")):
        link = f"https://de.indeed.com/viewjob?jk={job_id}"
    if source == "linkedin":
        link = f"https://www.linkedin.com/jobs/view/{job_id}/"
    fields = {
        "title": title, "link": link, "company": (company or "").strip(), "location": (location or "").strip(),
        "keyword": (keyword or "").strip() or None, "reason": reason, "now": _now(),
    }
    if existing:
        conn.execute(
            """
            UPDATE scrape_timeouts SET title = %(title)s, link = %(link)s, company = %(company)s,
                location = %(location)s, keyword = %(keyword)s, reason = %(reason)s, review_status = 'open',
                timeout_count = timeout_count + 1, updated_at = %(now)s
            WHERE id = %(id)s
            """,
            {**fields, "id": existing["id"]},
        )
    else:
        conn.execute(
            """
            INSERT INTO scrape_timeouts (id, source, external_id, link, title, company, location, keyword,
                reason, review_status, timeout_count, created_at, updated_at)
            VALUES (%(id)s, %(source)s, %(external_id)s, %(link)s, %(title)s, %(company)s, %(location)s,
                %(keyword)s, %(reason)s, 'open', 1, %(now)s, %(now)s)
            """,
            {**fields, "id": new_record_id(), "source": source, "external_id": job_id},
        )
    increment_scraper_stat("detail_timeout")
    print(f"Job timeout saved for review: {title} ({source}/{job_id})")
    return True
