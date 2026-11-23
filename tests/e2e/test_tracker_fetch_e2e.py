"""Fetch details, Run AI, and batch select actions on the Tracker."""
from __future__ import annotations

import os
import re
import unittest

from harness import APPLIED_ID, DELETE_ID, E2ECase, PENDING_ID, wait_for
from playwright.sync_api import expect


class TrackerFetchE2E(E2ECase):
    @unittest.skipUnless(os.getenv("E2E_FAKE_OPENAI"), "Next.js only: Run AI against tests/e2e/fake_openai.py")
    def test_run_ai_scores_card_from_stored_jd(self):
        self.open_card(PENDING_ID)
        card = self.page.locator(f"#card-{PENDING_ID}")
        card.locator(".btn-run-ai").click()
        expect(self.page.locator("#toast")).to_contain_text("AI done score")
        job = self.api_job(PENDING_ID)
        self.assertEqual(job["summary"], "E2E fake AI summary")
        expect(card.locator(".card-summary").first).to_contain_text("E2E fake AI summary")

    @unittest.skipUnless(os.getenv("E2E_FAKE_SCRAPER"), "Next.js only: Fetch details against the fake scraper")
    def test_fetch_details_saves_scraped_fields(self):
        # Regression: on localhost the app answered "Playwright not available … run locally".
        # An applied card with no JD, like the one that hit it.
        self.make_link_only(APPLIED_ID)
        self.open_card(APPLIED_ID)
        card = self.page.locator(f"#card-{APPLIED_ID}")
        card.locator(".btn-fetch-details").click()
        expect(self.page.locator("#toast")).to_contain_text("Details fetched")
        job = wait_for(lambda: (j := self.job(APPLIED_ID)) and j["details_fetched_at"] and j, "details saved")
        self.assertEqual(job["title"], "E2E Fetched Backend Engineer")
        self.assertEqual(job["company"], "E2E Fetched GmbH")
        self.assertEqual(job["location"], "Hamburg, Germany")
        self.assertIn("E2E fetched description", job["description"])
        self.assertEqual(job["status"], "applied", "fetching details must not touch the status")
        self.assertEqual(len(job["application_timeline"]), 1, "nor the timeline")
        expect(card.locator(".row-title")).to_have_text("E2E Fetched Backend Engineer")
        expect(card.locator(".btn-fetch-details")).to_have_count(0)

    @unittest.skipUnless(os.getenv("E2E_FAKE_SCRAPER"), "Next.js only: Fetch details against the fake scraper")
    def test_fetch_details_failure_shows_error_and_keeps_card(self):
        self.make_link_only(PENDING_ID, link="https://jobs.example.com/scrape-fails/1")
        self.open_card(PENDING_ID)
        self.page.locator(f"#card-{PENDING_ID} .btn-fetch-details").click()
        expect(self.page.locator("#toast")).to_contain_text("E2E fake scrape failure")
        job = self.job(PENDING_ID)
        self.assertEqual(job["title"], "(Link only) linkedin")
        self.assertIsNone(job["details_fetched_at"])

    @unittest.skipUnless(os.getenv("E2E_FAKE_SCRAPER"), "Next.js only: Fetch details against the fake scraper")
    def test_batch_fetch_details_for_selected_cards(self):
        self.make_link_only(PENDING_ID)
        self.make_link_only(DELETE_ID)
        self.page.goto(self.base + "/")
        self.page.click("#selectModeBtn")
        self.page.click("#selectMissingBtn")
        expect(self.page.locator("#batchFetchMeta")).to_contain_text("2 selected")
        self.page.click("#fetchSelectedBtn")
        expect(self.page.locator("#batchFetchBanner")).to_contain_text("Fetch details finished — 2 updated")
        for oid in (PENDING_ID, DELETE_ID):
            self.assertEqual(self.job(oid)["title"], "E2E Fetched Backend Engineer")

    @unittest.skipUnless(os.getenv("E2E_FAKE_OPENAI"), "Next.js only: Run AI against tests/e2e/fake_openai.py")
    def test_batch_run_ai_for_selected_cards(self):
        self.page.goto(self.base + "/")
        self.page.click("#selectModeBtn")
        self.page.locator(f"#card-{PENDING_ID} .card-select").check()
        expect(self.page.locator("#batchFetchMeta")).to_contain_text("1 selected")
        self.page.click("#runAiSelectedBtn")
        expect(self.page.locator("#batchFetchBanner")).to_contain_text("Run AI finished — 1 updated")
        self.assertEqual(self.api_job(PENDING_ID)["summary"], "E2E fake AI summary")

    @unittest.skipUnless(os.getenv("E2E_FAKE_SCRAPER"), "Next.js only: Fetch details against the fake scraper")
    def test_select_missing_details_includes_applied_untagged_stubs(self):
        # Applied Save-Link-Only cards with no recommended_by used to be skipped.
        self.make_link_only(APPLIED_ID)
        self.page.goto(self.base + "/")
        self.page.click("#selectModeBtn")
        self.page.click("#selectMissingBtn")
        expect(self.page.locator("#toast")).to_contain_text("missing-details")
        expect(self.page.locator(f"#card-{APPLIED_ID}")).to_have_class(re.compile(r".*\bfetch-selected\b.*"))
        expect(self.page.locator(f"#card-{APPLIED_ID} .card-select")).to_be_checked()
        self.page.click("#fetchSelectedBtn")
        expect(self.page.locator("#batchFetchBanner")).to_contain_text("updated")
        self.assertEqual(self.job(APPLIED_ID)["title"], "E2E Fetched Backend Engineer")
        self.assertEqual(self.job(APPLIED_ID)["status"], "applied")

    def test_batch_delete_selected_cards(self):
        self.page.goto(self.base + "/")
        self.page.click("#selectModeBtn")
        self.page.locator(f"#card-{DELETE_ID} .card-select").check()
        expect(self.page.locator("#batchFetchMeta")).to_contain_text("1 selected")
        self.page.click("#deleteSelectedBtn")
        self.confirm_modal()
        expect(self.page.locator(f"#card-{DELETE_ID}")).to_have_count(0)
        wait_for(lambda: self.job(DELETE_ID) is None, "selected job deleted")
        self.assertIsNotNone(self.job(PENDING_ID), "other cards must stay")
        self.assertIsNotNone(self.job(APPLIED_ID))
