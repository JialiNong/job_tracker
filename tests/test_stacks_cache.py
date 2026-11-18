"""Stacks tab cache (web.stacks_cache) with in-memory stand-ins for Mongo."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from web import stacks_cache


class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: d for d in (docs or [])}
        self.finds = 0

    def find_one(self, query):
        return self.docs.get(query["_id"])

    def replace_one(self, query, doc, upsert=False):
        self.docs[query["_id"]] = doc

    def find(self, query, projection):
        self.finds += 1
        return [{"title": "Node.js Engineer", "description": "React", "status": "rejected",
                 "applied_at": datetime(2026, 1, 5)}]


class StackCacheTests(unittest.TestCase):
    def setUp(self):
        self.cache = _FakeCollection()
        self.jobs = _FakeCollection()
        collections = {stacks_cache.CACHE_COLLECTION: self.cache, "matched_jobs": self.jobs}
        patcher = mock.patch.object(stacks_cache, "get_collection", side_effect=collections.__getitem__)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _store(self, age):
        # pymongo hands back naive UTC datetimes
        computed = (datetime.now(timezone.utc) - age).replace(tzinfo=None)
        self.cache.docs[stacks_cache.CACHE_ID] = {
            "_id": stacks_cache.CACHE_ID, "computed_at": computed,
            "data": {"settled_after_days": 30, "all": {"applied": 99}},
        }

    def test_empty_cache_computes_and_stores(self):
        out = stacks_cache.get_stack_stats()
        self.assertEqual(out["all"]["applied"], 1)
        self.assertTrue(out["computed_at"].endswith("Z"))
        self.assertIn(stacks_cache.CACHE_ID, self.cache.docs)
        self.assertEqual(self.jobs.finds, 1)

    def test_fresh_cache_skips_the_jobs_read(self):
        self._store(timedelta(hours=1))
        with mock.patch.object(stacks_cache, "_refresh_in_background") as bg:
            out = stacks_cache.get_stack_stats()
        self.assertEqual(out["all"]["applied"], 99)
        self.assertEqual(self.jobs.finds, 0)
        bg.assert_not_called()

    def test_stale_cache_is_served_and_refreshed_in_background(self):
        self._store(stacks_cache.MAX_AGE + timedelta(minutes=1))
        with mock.patch.object(stacks_cache, "_refresh_in_background") as bg:
            out = stacks_cache.get_stack_stats()
        self.assertEqual(out["all"]["applied"], 99)
        bg.assert_called_once()

    def test_refresh_recomputes_even_when_fresh(self):
        self._store(timedelta(hours=1))
        out = stacks_cache.refresh_stack_stats()
        self.assertEqual(out["all"]["applied"], 1)
        self.assertEqual(self.jobs.finds, 1)


if __name__ == "__main__":
    unittest.main()
