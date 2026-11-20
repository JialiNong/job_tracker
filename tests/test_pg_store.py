"""
core/pg_store.py against the local test Postgres (pnpm db:up; tracker_test).

Skipped when that database is not reachable. Only touches rows it creates
(external ids starting with "pgstore-test-") and removes them afterwards.
"""
import os
import unittest

TEST_DB = os.getenv("PG_STORE_TEST_URL", "postgresql://tracker:tracker@127.0.0.1:54329/tracker_test")

try:
    import psycopg

    _conn = psycopg.connect(TEST_DB, autocommit=True, connect_timeout=2)
except Exception:  # noqa: BLE001 — no Postgres here: skip
    _conn = None


@unittest.skipIf(_conn is None, "test Postgres (tracker_test) not reachable")
class PgStoreTest(unittest.TestCase):
    def setUp(self):
        assert TEST_DB.rsplit("/", 1)[-1].endswith("_test"), "pg_store tests only run on a *_test database"
        os.environ["DATABASE_URL"] = TEST_DB
        from core import pg_store

        if pg_store._conn is not None:
            pg_store._conn.close()
        pg_store._conn = None
        self.store = pg_store
        self._cleanup()
        self.totals_before = self._totals()

    def tearDown(self):
        self._cleanup()
        if self.store._conn is not None:
            self.store._conn.close()
            self.store._conn = None

    def _cleanup(self):
        _conn.execute("DELETE FROM jobs WHERE external_id LIKE 'pgstore-test-%' OR external_id LIKE '%pgstoretest%'")
        _conn.execute("DELETE FROM scrape_timeouts WHERE external_id LIKE 'pgstore-test-%'")

    def _totals(self):
        row = _conn.execute("SELECT detail_timeout, german_filtered FROM scraper_totals WHERE id = 1").fetchone()
        return row or (0, 0)

    def _job(self, **extra):
        return {
            "title": "Frontend Engineer", "company": "Acme", "location": "Berlin", "status": "new",
            "link": "https://www.linkedin.com/jobs/view/pgstore-test-1/", "job_id": "pgstore-test-1",
            "applicants": "12 applicants", "description": "We build things.", "source": "linkedin",
            "description_empty": False, "description_incomplete": True,
            "description_quality": "incomplete", "description_quality_reason": "too short",
            **extra,
        }

    def test_save_job_then_duplicate_is_rejected(self):
        self.assertFalse(self.store.is_job_id_exists("pgstore-test-1", "linkedin"))
        self.assertTrue(self.store.save_job(self._job()))
        self.assertTrue(self.store.is_job_id_exists("pgstore-test-1", "linkedin"))
        self.assertFalse(self.store.save_job(self._job()))
        row = _conn.execute(
            "SELECT title, applicants, description_quality, description_incomplete, analysis_state, "
            "length(id) FROM jobs WHERE external_id = 'pgstore-test-1'"
        ).fetchone()
        self.assertEqual(row, ("Frontend Engineer", "12 applicants", "incomplete", True, "none", 24))

    def test_applied_card_is_not_saved(self):
        self.assertFalse(self.store.save_job(self._job(status="Applied")))
        self.assertFalse(self.store.save_job(self._job(status="Applied 2 days ago")))
        self.assertFalse(self.store.is_job_id_exists("pgstore-test-1", "linkedin"))
        self.assertTrue(self.store.save_job(self._job(status="Viewed")))

    def test_same_posting_under_another_id_is_a_duplicate(self):
        link = "https://boards.greenhouse.io/pgstoretest/jobs/123"
        self.assertTrue(self.store.save_job(self._job(source="ats", job_id="pgstore-test-a", link=link)))
        self.assertFalse(self.store.save_job(self._job(source="ats", job_id="pgstore-test-b", link=link)))

    def test_indeed_id_variants(self):
        self.assertTrue(self.store.save_job(self._job(
            source="indeed", job_id="pgstore-test-jk1", link="https://de.indeed.com/viewjob?jk=pgstore-test-jk1")))
        self.assertTrue(self.store.is_job_id_exists("pgstore-test-jk1", "indeed"))

    def test_timeout_saved_counted_then_skipped_once_added(self):
        args = dict(title="Frontend Engineer", job_id="pgstore-test-t1", link="", source="linkedin",
                    company="Hooli", location="Hamburg", keyword="frontend")
        self.assertTrue(self.store.save_timeout_job(**args))
        self.assertTrue(self.store.save_timeout_job(**args))
        row = _conn.execute(
            "SELECT link, timeout_count, review_status, keyword FROM scrape_timeouts WHERE external_id = 'pgstore-test-t1'"
        ).fetchone()
        self.assertEqual(row, ("https://www.linkedin.com/jobs/view/pgstore-test-t1/", 2, "open", "frontend"))
        self.assertEqual(self._totals()[0], self.totals_before[0] + 2)
        _conn.execute("UPDATE scrape_timeouts SET review_status = 'added' WHERE external_id = 'pgstore-test-t1'")
        self.assertFalse(self.store.save_timeout_job(**args))

    def test_timeout_skipped_when_posting_is_stored(self):
        self.store.save_job(self._job())
        self.assertFalse(self.store.save_timeout_job(title="x", job_id="pgstore-test-1", link="", source="linkedin"))

    def test_scraper_stat_counts_total_and_berlin_day(self):
        self.store.increment_scraper_stat("german_filtered", 3)
        self.assertEqual(self._totals()[1], self.totals_before[1] + 3)
        with self.assertRaises(ValueError):
            self.store.increment_scraper_stat("drop table")

    def test_db_mongo_switches_on_tracker_store(self):
        import importlib

        import core.db_mongo as db_mongo

        os.environ["TRACKER_STORE"] = "postgres"
        try:
            importlib.reload(db_mongo)
            self.assertIs(db_mongo.save_job, self.store.save_job)
            self.assertEqual(db_mongo.save_job.__module__, "core.pg_store")
        finally:
            os.environ.pop("TRACKER_STORE")
            importlib.reload(db_mongo)
        self.assertEqual(db_mongo.save_job.__module__, "core.mongo.jobs")


if __name__ == "__main__":
    unittest.main()
