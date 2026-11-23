"""Unmatched page: list chrome, search, Can apply, close card."""
from __future__ import annotations

import re

from harness import E2ECase, UNMATCHED_ID, wait_for
from playwright.sync_api import expect


class UnmatchedE2E(E2ECase):
    def test_unmatched_card_uses_shared_chrome(self):
        self.page.goto(self.base + "/unmatched")
        card = self.page.locator(f"#card-{UNMATCHED_ID}")
        expect(card.locator(".card-row .score-ring")).to_be_visible()
        expect(card.locator(".row-sub .row-company")).to_have_text("Umbrella")
        expect(card.locator(".row-applicants")).to_have_text("80 applicants")
        expect(card.locator(".card-row .channel-chip")).to_be_visible()
        expect(card.locator(".card-body")).to_be_hidden()
        card.locator(".card-row").click()
        expect(card.locator(".card-body")).to_be_visible()
        expect(card.locator(".reason-box")).to_contain_text("Java backend required")
        expect(card.locator(".card-body .score-ring.score-lg")).to_be_visible()

    def test_unmatched_search_filters_the_list(self):
        self.page.goto(self.base + "/unmatched")
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        self.page.fill("#searchInput", "Java")
        expect(self.page.locator(f"#card-{UNMATCHED_ID}")).to_have_count(1)
        self.page.fill("#searchInput", "zzzz-no-such-job")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)
        expect(self.page.get_by_text("No Unmatched Jobs")).to_be_visible()
        self.assertEqual(
            self.store.scraped_job_count("4200000001"),
            1,
            "search must not delete the unmatched job",
        )

    def test_unmatched_can_apply_copies_to_tracker(self):
        self.page.goto(f"{self.base}/unmatched?open={UNMATCHED_ID}")
        self.page.select_option(f"select.status-select[data-id='{UNMATCHED_ID}']", "watchlist")
        copied = wait_for(
            lambda: self.store.tracker_job_by_job_id("4200000001"),
            "unmatched job copied to matched_jobs",
        )
        self.assertEqual(copied["status"], "pending")
        self.page.goto(self.base + "/")
        expect(self.page.locator(f"#card-{copied['_id']} .row-title")).to_have_text("Java Engineer")

    def test_unmatched_close_hides_the_body(self):
        # List layout opens the JD inline (no drawer ×). Click the row again, or Esc.
        self.page.goto(f"{self.base}/unmatched?open={UNMATCHED_ID}")
        card = self.page.locator(f"#card-{UNMATCHED_ID}")
        expect(card.locator(".card-body")).to_be_visible()
        self.page.keyboard.press("Escape")
        expect(card.locator(".card-body")).to_have_count(0)

    def test_unmatched_cards_layout_close_button(self):
        self.page.goto(self.base + "/unmatched")
        self.page.locator('#layoutToggle [data-layout="cards"]').click()
        card = self.page.locator(f"#card-{UNMATCHED_ID}")
        card.locator(".card-row").click()
        expect(card.locator(".card-body")).to_be_visible()
        card.locator(".panel-close").click()
        expect(card.locator(".card-body")).to_have_count(0)
        self.page.locator('#layoutToggle [data-layout="compact"]').click()

    def test_unmatched_watchlist_chip_filters_to_can_apply(self):
        self.page.goto(f"{self.base}/unmatched?open={UNMATCHED_ID}")
        self.page.select_option(f"select.status-select[data-id='{UNMATCHED_ID}']", "watchlist")
        wait_for(
            lambda: self.store.tracker_job_by_job_id("4200000001"),
            "copied to tracker",
        )
        self.page.locator(".watchlist-chip").first.click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        expect(self.page.locator(f"#card-{UNMATCHED_ID}")).to_have_count(1)

    def test_unmatched_gate_filter_can_empty_the_list(self):
        self.page.goto(self.base + "/unmatched")
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        self.page.click("#filterBtn")
        self.page.select_option("#gateFilter", "german")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)

    def test_unmatched_source_filter_hides_linkedin_when_indeed_picked(self):
        self.page.goto(self.base + "/unmatched")
        self.page.click("#filterBtn")
        self.page.select_option("#sourceFilter", "indeed")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)
        expect(self.page.get_by_text("No Unmatched Jobs")).to_be_visible()

    def test_unmatched_score_filter_hard_reject_hides_a_4(self):
        self.page.goto(self.base + "/unmatched")
        self.page.click("#filterBtn")
        self.page.select_option("#scorePreset", "0-3")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)

    def test_unmatched_agent_chip_can_empty_the_list(self):
        self.page.goto(self.base + "/unmatched")
        self.page.locator(".agent-chip").click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)
        expect(self.page.locator(".agent-chip")).to_have_class(re.compile(r".*\bactive\b.*"))

    def test_unmatched_layout_toggle(self):
        self.page.goto(self.base + "/unmatched")
        grid = self.page.locator("#jobGrid")
        self.page.locator('#layoutToggle [data-layout="cards"]').click()
        expect(grid).to_have_class(re.compile(r".*\blayout-cards\b.*"))
        expect(grid.locator(".card")).to_have_count(1)
        self.page.locator('#layoutToggle [data-layout="compact"]').click()
