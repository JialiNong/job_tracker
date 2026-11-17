"""services.log_job.process_urls returns where every URL ended up.

No Chrome, AI or MongoDB: the browser, matcher and save steps are stubbed.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import services.log_job as lj

URL_A = "https://de.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa"
URL_B = "https://de.indeed.com/viewjob?jk=bbbbbbbbbbbbbbbb"
URL_C = "https://de.indeed.com/viewjob?jk=cccccccccccccccc"


def _fake_playwright():
    sync_playwright = MagicMock()
    sync_playwright.return_value.__enter__.return_value = MagicMock()
    sync_playwright.return_value.__exit__.return_value = False
    return sync_playwright


class ProcessUrlsResultTests(unittest.TestCase):
    def _run(self, urls, **patches):
        with patch.object(lj, "load_playwright", return_value=_fake_playwright()), \
                patch.object(lj, "first_cdp_page", return_value=MagicMock()), \
                patch("matching.ai_matcher.load_user_profile", return_value=""), \
                patch("matching.ai_matcher.load_matching_rules", return_value=""), \
                patch.object(lj, "reuse_saved_posting", side_effect=lambda u, s, j: (s, j)), \
                patch.object(lj, "pause"), \
                patch.multiple(lj, **patches):
            return lj.process_urls(urls)

    def test_each_url_lands_in_exactly_one_list(self):
        existing = {"job_id": "bbbbbbbbbbbbbbbb", "source": "indeed"}
        results = self._run(
            [URL_A, URL_B, URL_C, "   "],
            resolve_job_id=lambda url, source: None if url == URL_C else url[-16:],
            get_tracker_job=lambda job_id, source: existing if job_id == existing["job_id"] else None,
            tracker_needs_scrape=lambda doc: False,
            handle_existing_tracker=MagicMock(return_value="skip"),
            scrape_job_page=MagicMock(return_value=None),
            save_job_record=MagicMock(return_value=True),
        )
        self.assertEqual(results["ok"], [URL_A])
        self.assertEqual(results["skipped"], [URL_B])
        self.assertEqual(results["failed"], [URL_C])  # blank paste lines are ignored

    def test_crash_mid_run_falls_back_to_link_only_for_the_rest(self):
        calls = []

        def get_tracker_job(job_id, source):
            calls.append(job_id)
            if len(calls) == 2:
                raise RuntimeError("Mongo went away")
            return None

        link_only = MagicMock(return_value={"ok": [URL_B, URL_C], "skipped": [], "failed": []})
        results = self._run(
            [URL_A, URL_B, URL_C],
            get_tracker_job=get_tracker_job,
            scrape_job_page=MagicMock(return_value=None),
            save_job_record=MagicMock(return_value=True),
            save_link_only_urls=link_only,
        )
        self.assertEqual(link_only.call_args[0][0], [URL_B, URL_C])
        self.assertEqual(results["ok"], [URL_A, URL_B, URL_C])
        self.assertEqual(results["failed"], [])

    def test_missing_playwright_returns_link_only_results(self):
        link_only = MagicMock(return_value={"ok": [URL_A], "skipped": [], "failed": []})
        with patch.object(lj, "load_playwright", side_effect=ImportError("no playwright")), \
                patch.object(lj, "save_link_only_urls", link_only):
            results = lj.process_urls([URL_A], status="applied")
        self.assertEqual(results["ok"], [URL_A])
        self.assertEqual(link_only.call_args.kwargs["status"], "applied")


if __name__ == "__main__":
    unittest.main()
