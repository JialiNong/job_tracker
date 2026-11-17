"""Background Log Job / Run AI tasks: counts, captured log, busy guards.

Does not touch a live MongoDB or Chrome: the save / run step is injected.
"""
from __future__ import annotations

import threading
import time
import unittest
from unittest.mock import patch

import core.db_mongo as db_mongo

with patch.object(db_mongo, "ensure_indexes"):
    import web.chrome_tasks as ct

URLS = [
    "https://www.linkedin.com/jobs/view/4123456789/",
    "https://de.indeed.com/viewjob?jk=65ad798c3e603bb0",
    "https://careers.example.com/jobs/42",
]


def _wait_until_idle(state: dict, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while state["running"] and time.monotonic() < deadline:
        time.sleep(0.01)
    if state["running"]:
        raise AssertionError("background task did not finish")


def _start_log(save, urls=URLS):
    return ct.start_manual_log(
        urls, mode="scrape", status="pending", applied_date=None,
        recommended_by=None, identity=None, save=save,
    )


class StartManualLogTests(unittest.TestCase):
    def tearDown(self):
        _wait_until_idle(ct._manual_apply_state)

    def test_counts_come_from_returned_results_not_log_text(self):
        def save(urls, **kwargs):
            # Wording that the old log-parsing counter would have miscounted
            print("  ✅ Saved to matched_jobs (status=pending / Not Applied)")
            print("  ❌ Scraping failed — but this line is not a failure count")
            return {"ok": [urls[0]], "skipped": [urls[1]], "failed": [urls[2]]}

        payload, status = _start_log(save)
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "started")
        _wait_until_idle(ct._manual_apply_state)

        result = ct.manual_log_status()
        self.assertFalse(result["running"])
        self.assertEqual(
            (result["done_count"], result["skip_count"], result["fail_count"]), (1, 1, 1),
        )
        self.assertIn("  ✅ Saved to matched_jobs (status=pending / Not Applied)", result["log"])

    def test_status_since_returns_only_new_lines(self):
        def save(urls, **kwargs):
            for i in range(5):
                print(f"line {i}")
            return {"ok": list(urls), "skipped": [], "failed": []}

        _start_log(save)
        _wait_until_idle(ct._manual_apply_state)

        first = ct.manual_log_status(since=0)
        self.assertEqual(first["log_total"], 5)
        rest = ct.manual_log_status(since=3)
        self.assertEqual(rest["log"], ["line 3", "line 4"])
        self.assertEqual(ct.manual_log_status(since="junk")["log"], first["log"])

    def test_more_than_100_lines_are_all_reachable(self):
        def save(urls, **kwargs):
            for i in range(250):
                print(f"line {i}")
            return {"ok": [], "skipped": [], "failed": []}

        _start_log(save)
        _wait_until_idle(ct._manual_apply_state)
        self.assertEqual(ct.manual_log_status(since=240)["log"][-1], "line 249")

    def test_crash_is_logged_and_counts_every_url_as_failed(self):
        def save(urls, **kwargs):
            raise RuntimeError("boom")

        _start_log(save)
        _wait_until_idle(ct._manual_apply_state)
        result = ct.manual_log_status()
        self.assertEqual(result["fail_count"], len(URLS))
        self.assertTrue(any("Fatal error: boom" in line for line in result["log"]))
        self.assertTrue(ct._manual_apply_lock.acquire(blocking=False))
        ct._manual_apply_lock.release()

    def test_second_run_is_refused_while_the_first_is_running(self):
        release = threading.Event()

        def slow_save(urls, **kwargs):
            release.wait(5)
            return {"ok": [], "skipped": [], "failed": []}

        _start_log(slow_save)
        try:
            payload, status = _start_log(slow_save)
            self.assertEqual(status, 429)
            self.assertIn("error", payload)
        finally:
            release.set()

    def test_log_of_another_thread_is_not_captured(self):
        stop = threading.Event()

        def noisy():
            while not stop.is_set():
                print("request thread noise")
                time.sleep(0.001)

        other = threading.Thread(target=noisy)
        other.start()
        try:
            def save(urls, **kwargs):
                for _ in range(20):
                    print("task line")
                    time.sleep(0.001)
                return {"ok": [], "skipped": [], "failed": []}

            _start_log(save)
            _wait_until_idle(ct._manual_apply_state)
        finally:
            stop.set()
            other.join()
        self.assertEqual(set(ct.manual_log_status()["log"]), {"task line"})


class StartRunAiTests(unittest.TestCase):
    DOC = {"job_id": "4300000001", "source": "linkedin", "title": "(Link only) LinkedIn job"}

    def tearDown(self):
        _wait_until_idle(ct._run_ai_state)

    def test_result_and_log_are_reported_for_this_job(self):
        def run_one(doc):
            print("🤖 Run AI for Tracker job")
            return {"ok": True, "match_score": 8.0, "match_gate": "scored", "gate_reason": ""}

        payload, status = ct.start_run_ai(self.DOC, "abc", run_one=run_one)
        self.assertEqual(status, 200)
        self.assertFalse(payload["uses_stored_jd"])
        _wait_until_idle(ct._run_ai_state)

        mine = ct.run_ai_status("abc")
        self.assertTrue(mine["ok"])
        self.assertEqual(mine["match_score"], 8.0)
        self.assertIn("🤖 Run AI for Tracker job", mine["log"])
        other = ct.run_ai_status("someone-else")
        self.assertIsNone(other["ok"])
        self.assertIsNone(other["match_score"])

    def test_scrape_is_refused_while_a_batch_holds_chrome(self):
        with patch.dict(ct._fetch_batch_state, {"running": True}):
            payload, status = ct.start_run_ai(self.DOC, "abc", run_one=lambda d: {"ok": True})
        self.assertEqual(status, 429)
        self.assertEqual(payload["error"], ct.BATCH_BUSY_MSG)
        self.assertTrue(ct._run_ai_lock.acquire(blocking=False))
        ct._run_ai_lock.release()


if __name__ == "__main__":
    unittest.main()
