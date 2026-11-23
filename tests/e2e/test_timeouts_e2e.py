"""Timeouts page: add, dismiss, review-status filter."""
from __future__ import annotations

from harness import E2ECase, TIMEOUT_ID, wait_for
from playwright.sync_api import expect


class TimeoutsE2E(E2ECase):
    def test_timeout_add_as_not_applied(self):
        self.page.goto(self.base + "/timeouts")
        self.page.locator(f".card[data-id='{TIMEOUT_ID}']").get_by_role(
            "button", name="Add as Not Applied"
        ).click()
        wait_for(lambda: self.store.tracker_job_by_job_id("4300000001"), "timeout job on Tracker")
        wait_for(
            lambda: self.store.timeout_job(TIMEOUT_ID)["review_status"] == "added",
            "timeout marked added",
        )

    def test_timeout_dismiss_hides_it_from_open(self):
        self.page.goto(self.base + "/timeouts")
        card = self.page.locator(f".card[data-id='{TIMEOUT_ID}']")
        expect(card).to_be_visible()
        card.get_by_role("button", name="Dismiss").click()
        wait_for(
            lambda: self.store.timeout_job(TIMEOUT_ID)["review_status"] == "dismissed",
            "timeout marked dismissed",
        )
        expect(self.page.locator(f".card[data-id='{TIMEOUT_ID}']")).to_have_count(0)

    def test_timeout_status_filter_shows_dismissed(self):
        self.page.goto(self.base + "/timeouts")
        self.page.locator(f".card[data-id='{TIMEOUT_ID}']").get_by_role(
            "button", name="Dismiss"
        ).click()
        wait_for(
            lambda: self.store.timeout_job(TIMEOUT_ID)["review_status"] == "dismissed",
            "timeout marked dismissed",
        )
        self.page.select_option("#statusFilter", "dismissed")
        expect(self.page.locator(f".card[data-id='{TIMEOUT_ID}']")).to_be_visible()
        expect(self.page.locator(f".card[data-id='{TIMEOUT_ID}']")).to_contain_text("dismissed")

    def test_timeout_source_filter_hides_linkedin_when_indeed_picked(self):
        self.page.goto(self.base + "/timeouts")
        expect(self.page.locator(f".card[data-id='{TIMEOUT_ID}']")).to_be_visible()
        self.page.select_option("#sourceFilter", "indeed")
        expect(self.page.locator(f".card[data-id='{TIMEOUT_ID}']")).to_have_count(0)
        expect(self.page.locator("#list")).to_contain_text("No timeout jobs")

    def test_timeout_added_filter_after_add(self):
        self.page.goto(self.base + "/timeouts")
        self.page.locator(f".card[data-id='{TIMEOUT_ID}']").get_by_role(
            "button", name="Add as Not Applied"
        ).click()
        wait_for(
            lambda: self.store.timeout_job(TIMEOUT_ID)["review_status"] == "added",
            "timeout marked added",
        )
        expect(self.page.locator(f".card[data-id='{TIMEOUT_ID}']")).to_have_count(0)
        self.page.select_option("#statusFilter", "added")
        expect(self.page.locator(f".card[data-id='{TIMEOUT_ID}']")).to_be_visible()
        expect(self.page.locator(f".card[data-id='{TIMEOUT_ID}']")).to_contain_text("added")
