"""Postgres store for the browser e2e suite (Next.js + Postgres stack).

Same methods as harness.MongoStore, returning documents in the Tracker's
Mongo-era field names, so test_tracker_e2e.py runs unchanged:

    E2E_STORE=pg_store:PostgresStore E2E_BASE_URL=http://127.0.0.1:3100 \\
        python3 -m unittest discover -s tests/e2e

Seeding reuses harness.seed(): its inserts are recorded instead of written to
Mongo, saved as a fixture file, and loaded through the same transform as the
real migration (`pnpm db contract:seed`). Only the local tracker_test
database is ever touched.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import psycopg
from bson import json_util
from psycopg.rows import dict_row

from harness import seed

ROOT = Path(__file__).resolve().parents[2]
TEST_DB = os.getenv("E2E_PG_URL", "postgresql://tracker:tracker@127.0.0.1:54329/tracker_test")
if not TEST_DB.rsplit("/", 1)[-1].endswith("_test"):
    raise RuntimeError("E2E refused: the Postgres database name must end with _test")


class _RecordingCollection:
    def __init__(self):
        self.docs = []

    def insert_many(self, docs):
        self.docs.extend(docs)

    def insert_one(self, doc):
        self.docs.append(doc)


class _RecordingDb:
    """Stands in for a pymongo Database inside harness.seed()."""

    def __init__(self):
        self.collections: dict[str, _RecordingCollection] = {}

    def list_collection_names(self):
        return []

    def drop_collection(self, _name):
        pass

    def __getattr__(self, name):
        return self.collections.setdefault(name, _RecordingCollection())


def _id(value) -> str:
    return str(value)


class PostgresStore:
    uri = None  # the server under test is started separately (E2E_BASE_URL)

    def __init__(self):
        self.conn = psycopg.connect(TEST_DB, autocommit=True, row_factory=dict_row)
        fd, self.fixture_path = tempfile.mkstemp(prefix="tracker_e2e_", suffix=".json")
        os.close(fd)

    # ── seeding ──────────────────────────────────────────────────────────

    def seed(self):
        recorder = _RecordingDb()
        seed(recorder)
        fixture = {"collections": {name: c.docs for name, c in recorder.collections.items()}}
        Path(self.fixture_path).write_text(json_util.dumps(fixture, json_options=json_util.RELAXED_JSON_OPTIONS))
        env = {**os.environ, "DATABASE_URL": TEST_DB, "DIRECT_DATABASE_URL": TEST_DB,
               "CONTRACT_FIXTURE": self.fixture_path}
        subprocess.run(["pnpm", "--silent", "db", "contract:seed"], cwd=ROOT, env=env, check=True,
                       stdout=subprocess.DEVNULL)

    # ── reads, in the old document shape ─────────────────────────────────

    def _events(self, application_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT step::text AS step, at FROM application_events WHERE application_id = %s ORDER BY at, id",
            (application_id,),
        ).fetchall()
        return [{"step": r["step"], "at": r["at"]} for r in rows]

    def _card(self, where: str, value) -> dict | None:
        row = self.conn.execute(
            f"""SELECT a.id, a.status::text AS status, a.applied_at, a.notes, a.applicant_position,
                       j.title, j.company, j.location, j.link, j.source, j.external_id,
                       j.posting_key, j.link_replaced_at, j.description, j.details_fetched_at
                  FROM applications a JOIN jobs j ON j.id = a.job_id
                 WHERE {where} = %s""",
            (value,),
        ).fetchone()
        if not row:
            return None
        doc = {
            "_id": row["id"], "status": row["status"], "applied_at": row["applied_at"],
            "notes": row["notes"], "applicant_position": row["applicant_position"],
            "title": row["title"], "company": row["company"], "location": row["location"],
            "link": row["link"], "source": row["source"], "job_id": row["external_id"],
            "link_replaced_at": row["link_replaced_at"],
            "description": row["description"], "details_fetched_at": row["details_fetched_at"],
            "application_timeline": self._events(row["id"]),
        }
        if row["posting_key"]:
            doc["posting_key"] = row["posting_key"]
        return doc

    def tracker_job(self, job_oid):
        return self._card("a.id", _id(job_oid))

    def tracker_job_by_job_id(self, job_id):
        return self._card("j.external_id", str(job_id))

    def tracker_job_count(self) -> int:
        return self.conn.execute("SELECT count(*) AS n FROM applications").fetchone()["n"]

    def set_tracker_fields(self, job_oid, fields: dict):
        columns = {"source": "source", "link": "link", "title": "title", "company": "company",
                   "location": "location", "job_id": "external_id", "description": "description"}
        sets = ", ".join(f"{columns[k]} = %s" for k in fields)
        self.conn.execute(
            f"UPDATE jobs SET {sets} WHERE id = (SELECT job_id FROM applications WHERE id = %s)",
            (*fields.values(), _id(job_oid)),
        )

    def scraped_job(self, job_id, source=None):
        sql = "SELECT id, source, external_id, title, link FROM jobs WHERE external_id = %s"
        params: list = [str(job_id)]
        if source:
            sql += " AND source = %s"
            params.append(source)
        row = self.conn.execute(sql, params).fetchone()
        if not row:
            return None
        return {"_id": row["id"], "source": row["source"], "job_id": row["external_id"],
                "title": row["title"], "link": row["link"]}

    def scraped_job_count(self, job_id) -> int:
        return self.conn.execute("SELECT count(*) AS n FROM jobs WHERE external_id = %s", (str(job_id),)).fetchone()["n"]

    def add_scraped_job(self, doc: dict):
        # In Postgres the Tracker card and its posting are one row (docs/pg-schema.md,
        # D1): a "scraped twin" of an existing card is already there.
        if self.scraped_job(doc.get("job_id"), doc.get("source")):
            return
        self.conn.execute(
            "INSERT INTO jobs (id, source, external_id, title, link, updated_at) "
            "VALUES (substr(md5(random()::text), 1, 24), %s, %s, %s, %s, now())",
            (doc.get("source", ""), str(doc.get("job_id", "")), doc.get("title", ""), doc.get("link", "")),
        )

    def timeout_job(self, doc_oid):
        row = self.conn.execute(
            "SELECT id, review_status, external_id, source FROM scrape_timeouts WHERE id = %s", (_id(doc_oid),),
        ).fetchone()
        return None if not row else {"_id": row["id"], "review_status": row["review_status"],
                                     "job_id": row["external_id"], "source": row["source"]}

    def stop(self):
        self.conn.close()
        Path(self.fixture_path).unlink(missing_ok=True)
