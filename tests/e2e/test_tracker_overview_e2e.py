"""Tracker Overview / Stacks tabs: panels render from the seeded cards."""
from __future__ import annotations

import os
import re
import unittest

from harness import APPLIED_ID, E2ECase, PENDING_ID, wait_for
from playwright.sync_api import expect


class TrackerOverviewE2E(E2ECase):
    def test_overview_panels_render(self):
        self.page.goto(self.base + "/")
        self.page.click("#tabOverview")
        overview = self.page.locator("#overviewView")
        expect(overview).to_be_visible()
        expect(overview.locator("#railBar")).to_be_visible()
        expect(overview.locator("#calSection")).to_be_visible()
        expect(overview.locator("#journeySection")).to_be_visible()
        expect(overview.locator("#locSection")).to_be_visible()
        expect(self.page.locator("#statsBar")).to_be_hidden()

    def test_heatmap_applied_day_opens_that_days_jobs(self):
        self.page.goto(self.base + "/")
        self.page.click("#tabOverview")
        cell = self.page.locator("#calSection .cal-cell.has-applied").first
        expect(cell).to_be_visible()
        with self.page.context.expect_page() as new_page:
            cell.click()
        jobs = new_page.value
        jobs.wait_for_load_state("domcontentloaded")
        expect(jobs.locator("#appliedFilterChip")).to_be_visible()
        expect(jobs.locator("#jobGrid .card")).to_have_count(1)
        jobs.close()

    def test_stacks_totals_render(self):
        self.page.goto(self.base + "/")
        self.page.click("#tabStacks")
        stacks = self.page.locator("#stacksView")
        expect(stacks).to_be_visible()
        expect(stacks.locator("#stacksTotals")).to_be_visible()
        expect(self.page.locator("#statsBar")).to_be_hidden()
        self.page.click("#tabJobs")
        expect(self.page.locator("#statsBar")).to_be_visible()

    @unittest.skipUnless(os.getenv("E2E_STORE"), "Next.js + Postgres: agent_push_runs")
    def test_agent_push_banner_lists_todays_saved_job(self):
        if not hasattr(self.store, "insert_agent_push"):
            self.skipTest("store.insert_agent_push")
        self.store.insert_agent_push(
            agent="cursor", title="Backend Engineer", company="Acme",
            card_id=str(PENDING_ID),
        )
        self.page.goto(self.base + "/")
        banner = self.page.locator(".agent-push-banner")
        expect(banner).to_be_visible()
        expect(banner).to_contain_text("Agent pushes today")
        expect(banner).to_contain_text("Cursor")
        expect(banner).to_contain_text("Saved")
        expect(banner).to_contain_text("Backend Engineer")
        banner.get_by_role("link", name="Open card").click()
        expect(self.page.locator(f"#progress-{PENDING_ID}")).to_be_visible()

    def test_berlin_bubble_opens_after_two_applications(self):
        progress = self.open_card(PENDING_ID)
        progress.get_by_role("button", name="+ Applied").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "applied", "status = applied")
        self.page.click("#tabOverview")
        bubble = self.page.locator(".loc-bubble")
        expect(bubble).to_be_visible()
        expect(bubble).to_have_attribute("aria-label", re.compile(r"Berlin: 2"))
        bubble.click()
        expect(bubble).to_have_class(re.compile(r".*\bis-open\b"))
        bubble.click()
        expect(bubble).not_to_have_class(re.compile(r".*\bis-open\b"))

    def test_journey_info_opens_company_popover(self):
        progress = self.open_card(PENDING_ID)
        progress.get_by_role("button", name="+ Applied").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "applied", "status = applied")
        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Invite").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "interview", "status = interview")
        self.page.click("#tabOverview")
        expect(self.page.locator(".jt-info")).to_be_visible()
        self.page.locator(".jt-info").click()
        pop = self.page.locator("#jtCompanyPop")
        expect(pop).to_be_visible()
        expect(pop).to_contain_text("Acme")
        expect(pop).to_contain_text("Backend Engineer")

    def test_phone_heatmap_double_tap_filters_that_day(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.add_init_script("""
            (() => {
              const orig = window.matchMedia.bind(window);
              window.matchMedia = (query) => {
                const forced = query === '(hover: none)' ? true
                  : query.includes('max-width: 768px') ? true
                  : query.includes('min-width: 901px') ? false
                  : orig(query).matches;
                return {
                  matches: forced, media: query, onchange: null,
                  addEventListener() {}, removeEventListener() {},
                  addListener() {}, removeListener() {},
                  dispatchEvent() { return false; },
                };
              };
            })();
        """)
        popups = []
        self.page.context.on("page", lambda p: popups.append(p))
        self.page.goto(self.base + "/")
        self.page.click("#tabOverview")
        cell = self.page.locator("#calSection .cal-cell.has-applied").first
        expect(cell).to_be_visible()
        expect(cell).to_have_attribute("title", re.compile(r"double-tap"))
        # Two clicks in one turn so the 400ms double-tap window cannot miss.
        cell.evaluate("el => { el.click(); el.click(); }")
        expect(self.page.locator("#jobsView")).to_be_visible()
        expect(self.page.locator("#appliedFilterChip")).to_be_visible()
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        expect(self.page.locator(f"#card-{APPLIED_ID}")).to_have_count(1)
        self.assertEqual(popups, [], "phone double-tap must not open a new tab")
