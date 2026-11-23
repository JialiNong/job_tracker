"""Log Job page: lookup, Save Link Only, Scrape & Log, Clear, agent API."""
from __future__ import annotations

import os
import re
import unittest

from harness import AGENT_TOKEN, E2ECase, PENDING_ID, wait_for
from playwright.sync_api import expect


class LogJobE2E(E2ECase):
    def test_log_job_lookup_finds_existing_tracker_card(self):
        url = "https://www.linkedin.com/jobs/view/4100000001/"
        self.page.goto(self.base + "/manual-apply")
        self.page.fill("#urlBox", url)
        expect(self.page.get_by_text("Already on Tracker").first).to_be_visible()
        expect(self.page.get_by_text("Backend Engineer")).to_be_visible()
        self.assertEqual(self.store.tracker_job_count(), 3)

    def test_log_job_link_only(self):
        url = "https://www.linkedin.com/jobs/view/4400000001/"
        self.page.goto(self.base + "/manual-apply")
        self.page.fill("#urlBox", url)
        self.page.fill("#jobTitle", "Data Engineer")
        self.page.fill("#jobCompany", "Wayne Enterprises")
        self.page.click("#linkOnlyBtn")
        saved = wait_for(
            lambda: self.store.tracker_job_by_job_id("4400000001"),
            "link-only job saved",
        )
        self.assertEqual(saved["title"], "Data Engineer")
        self.assertEqual(saved["company"], "Wayne Enterprises")
        self.assertEqual(saved["status"], "pending")
        expect(self.page.locator("#logCounter")).to_have_text("1 saved, 0 skipped, 0 failed")
        expect(self.page.locator("#statusBanner")).to_contain_text("1 saved as Not Applied")
        expect(self.page.locator("#logBody")).to_contain_text(re.compile(r"Saved to (matched_jobs|the Tracker)"))

    def test_log_job_clear_empties_the_form(self):
        self.page.goto(self.base + "/manual-apply")
        self.page.fill("#urlBox", "https://www.linkedin.com/jobs/view/4400000001/")
        self.page.fill("#jobTitle", "Data Engineer")
        self.page.fill("#jobCompany", "Wayne")
        self.page.fill("#jobLocation", "Berlin")
        self.page.select_option("#recommendedBy", "cursor")
        self.page.select_option("#jobStatus", "applied")
        self.page.click("#clearBtn")
        expect(self.page.locator("#urlBox")).to_have_value("")
        expect(self.page.locator("#jobTitle")).to_have_value("")
        expect(self.page.locator("#jobCompany")).to_have_value("")
        expect(self.page.locator("#jobLocation")).to_have_value("")
        expect(self.page.locator("#recommendedBy")).to_have_value("")
        expect(self.page.locator("#jobStatus")).to_have_value("pending")

    def test_log_job_link_only_with_recommended_by(self):
        url = "https://www.linkedin.com/jobs/view/4400000002/"
        self.page.goto(self.base + "/manual-apply")
        self.page.fill("#urlBox", url)
        self.page.fill("#jobTitle", "ML Engineer")
        self.page.select_option("#recommendedBy", "cursor")
        self.page.click("#linkOnlyBtn")
        saved = wait_for(
            lambda: self.store.tracker_job_by_job_id("4400000002"),
            "link-only job saved",
        )
        job = self.api_job(saved["_id"])
        self.assertEqual(job.get("recommended_by"), "cursor")

    @unittest.skipUnless(os.getenv("E2E_FAKE_SCRAPER"), "Next.js only: Scrape & log against the fake scraper")
    def test_log_job_scrape_saves_details_and_runs_ai(self):
        url = "https://www.linkedin.com/jobs/view/4400000001/"
        self.page.goto(self.base + "/manual-apply")
        self.page.fill("#urlBox", url)
        self.page.select_option("#jobStatus", "applied")
        self.page.click("#submitBtn")
        expect(self.page.locator("#statusBanner")).to_contain_text("1 saved as Applied", timeout=30_000)
        saved = self.store.tracker_job_by_job_id("4400000001")
        self.assertEqual(saved["title"], "E2E Fetched Backend Engineer")
        self.assertEqual(saved["company"], "E2E Fetched GmbH")
        self.assertEqual(saved["status"], "applied")
        self.assertIsNotNone(saved["details_fetched_at"])
        job = self.api_job(saved["_id"])
        self.assertEqual(job["summary"], "E2E fake AI summary")
        expect(self.page.locator("#logBody")).to_contain_text("AI score")

    @unittest.skipUnless(os.getenv("E2E_FAKE_SCRAPER"), "Next.js only: Scrape & log against the fake scraper")
    def test_log_job_scrape_refreshes_existing_link_only_card(self):
        self.make_link_only(PENDING_ID)
        url = self.job(PENDING_ID)["link"]
        self.page.goto(self.base + "/manual-apply")
        self.page.fill("#urlBox", url)
        self.page.click("#submitBtn")
        expect(self.page.locator("#statusBanner")).to_contain_text("1 saved", timeout=30_000)
        job = self.job(PENDING_ID)
        self.assertEqual(job["title"], "E2E Fetched Backend Engineer")
        self.assertEqual(self.store.tracker_job_count(), 3, "refreshes the card, never a second one")

    @unittest.skipUnless(os.getenv("E2E_FAKE_SCRAPER"), "Next.js only: Scrape & log against the fake scraper")
    def test_log_job_scrape_failure_keeps_link_only_card(self):
        self.page.goto(self.base + "/manual-apply")
        self.page.fill("#urlBox", "https://jobs.example.com/scrape-fails/42")
        self.page.click("#submitBtn")
        expect(self.page.locator("#statusBanner")).to_contain_text("1 saved", timeout=30_000)
        expect(self.page.locator("#logBody")).to_contain_text("E2E fake scrape failure")
        self.assertEqual(self.store.tracker_job_count(), 4, "the link is still saved, AI pending")

    def test_log_job_link_only_as_applied_keeps_the_date_and_location(self):
        url = "https://www.linkedin.com/jobs/view/4400000003/"
        self.page.goto(self.base + "/manual-apply")
        self.page.select_option("#jobStatus", "applied")
        expect(self.page.locator("#appliedDateGroup")).to_be_visible()
        self.page.fill("#appliedDate", "2026-03-10")
        self.page.fill("#urlBox", url)
        self.page.fill("#jobTitle", "Data Engineer")
        self.page.fill("#jobCompany", "Wayne Enterprises")
        self.page.fill("#jobLocation", "Leipzig, Germany")
        self.page.click("#linkOnlyBtn")
        saved = wait_for(
            lambda: self.store.tracker_job_by_job_id("4400000003"),
            "applied link-only job saved",
        )
        self.assertEqual(saved["status"], "applied")
        self.assertEqual(saved["location"], "Leipzig, Germany")
        job = self.api_job(saved["_id"])
        self.assertTrue(str(job.get("applied_at") or "").startswith("2026-03-10"), job.get("applied_at"))

    def test_log_job_link_only_two_urls(self):
        self.page.goto(self.base + "/manual-apply")
        self.page.fill(
            "#urlBox",
            "https://www.linkedin.com/jobs/view/4400000004/\nhttps://www.linkedin.com/jobs/view/4400000005/",
        )
        self.page.click("#linkOnlyBtn")
        expect(self.page.locator("#logCounter")).to_have_text("2 saved, 0 skipped, 0 failed")
        self.assertIsNotNone(self.store.tracker_job_by_job_id("4400000004"))
        self.assertIsNotNone(self.store.tracker_job_by_job_id("4400000005"))

    def test_log_job_skips_a_url_already_on_the_tracker(self):
        url = "https://www.linkedin.com/jobs/view/4100000001/"
        self.page.goto(self.base + "/manual-apply")
        self.page.fill("#urlBox", url)
        expect(self.page.get_by_text("Already on Tracker").first).to_be_visible()
        self.page.click("#linkOnlyBtn")
        self.assertEqual(self.store.tracker_job_count(), 3, "existing Tracker cards must not duplicate")

    def test_agent_api_requires_token_and_saves(self):
        url = "https://www.linkedin.com/jobs/view/4500000001/"
        api = self.ctx.request
        bad = api.post(self.base + "/api/agent/jobs", data={"jobs": [url]},
                       headers={"Authorization": "Bearer nope"})
        self.assertEqual(bad.status, 401)
        ok = api.post(self.base + "/api/agent/jobs",
                      data={"jobs": [{"url": url, "title": "ML Engineer", "reason": "fits"}]},
                      headers={"Authorization": f"Bearer {AGENT_TOKEN}"})
        self.assertEqual(ok.status, 200, ok.text())
        self.assertEqual(ok.json()["saved"], 1)
        self.assertIsNotNone(self.store.tracker_job_by_job_id("4500000001"))
