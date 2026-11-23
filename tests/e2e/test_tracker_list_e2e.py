"""Tracker Jobs list: chips, search, filters, layout, select helpers, tabs."""
from __future__ import annotations

import re

from harness import APPLIED_ID, DELETE_ID, E2ECase, PENDING_ID
from playwright.sync_api import expect


class TrackerListE2E(E2ECase):
    def test_tracker_shows_only_seeded_jobs(self):
        # Also proves the server is on the throwaway DB, not your real one
        self.page.goto(self.base + "/")
        expect(self.page.locator("#jobGrid .card")).to_have_count(3)
        expect(self.page.locator(f"#card-{PENDING_ID} .row-title")).to_have_text("Backend Engineer")
        expect(self.page.locator(f"#card-{PENDING_ID} .card-row .score-ring")).to_be_visible()
        expect(self.page.locator(f"#card-{PENDING_ID} .row-sub")).to_be_visible()
        expect(self.page.locator(f"#card-{PENDING_ID} .row-applicants")).to_have_text("first 25")
        expect(self.page.locator(f"#card-{APPLIED_ID} .row-applicants")).to_have_text("#12 at apply")
        expect(self.page.locator(f"#card-{DELETE_ID} .row-applicants")).to_have_text("200+ applicants")

    def test_status_chip_filters_the_list(self):
        self.page.goto(self.base + "/")
        expect(self.page.locator("#jobGrid .card")).to_have_count(3)
        self.page.locator('.stat-chip[data-status="pending"]').click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(2)
        expect(self.page.locator(f"#card-{PENDING_ID}")).to_have_count(1)
        expect(self.page.locator(f"#card-{APPLIED_ID}")).to_have_count(0)
        expect(self.page.locator('.stat-chip[data-status="pending"].active')).to_be_visible()
        self.page.locator('.stat-chip[data-status="applied"]').click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        expect(self.page.locator(f"#card-{APPLIED_ID}")).to_have_count(1)

    def test_search_filters_the_list(self):
        self.page.goto(self.base + "/")
        self.page.fill("#searchInput", "Acme")
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        expect(self.page.locator(f"#card-{PENDING_ID}")).to_have_count(1)
        self.page.fill("#searchInput", "zzzz-no-such-job")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)
        expect(self.page.get_by_text("No Matched Jobs")).to_be_visible()
        self.assertEqual(self.store.tracker_job_count(), 3, "search must not delete jobs")

    def test_company_link_filters_to_that_company(self):
        self.open_card(PENDING_ID)
        self.page.locator(f"#card-{PENDING_ID} .company-link").click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        expect(self.page.locator(f"#card-{PENDING_ID}")).to_have_count(1)
        expect(self.page.locator(".search-chip .cfc-name")).to_have_text("Acme")

    def test_source_filter_hides_linkedin_when_indeed_picked(self):
        self.page.goto(self.base + "/")
        self.page.click("#filterBtn")
        self.page.select_option("#sourceFilter", "indeed")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)
        expect(self.page.get_by_text("No Matched Jobs")).to_be_visible()

    def test_country_europe_excludes_berlin_jobs(self):
        self.page.goto(self.base + "/")
        expect(self.page.locator("#jobGrid .card")).to_have_count(3)
        self.page.click("#filterBtn")
        self.page.select_option("#countryFilter", "europe")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)

    def test_applied_on_url_shows_that_days_application(self):
        # The URL and the filter use Berlin calendar days (same string the card API shows).
        applied = self.api_job(APPLIED_ID).get("applied_at") or ""
        day = str(applied)[:10]
        self.assertRegex(day, r"^\d{4}-\d{2}-\d{2}$", f"expected a Berlin date, got {applied!r}")
        self.page.goto(f"{self.base}/?applied={day}")
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        expect(self.page.locator(f"#card-{APPLIED_ID}")).to_have_count(1)
        expect(self.page.locator("#appliedFilterChip")).to_contain_text(day)

    def test_layout_toggle_keeps_cards_and_switches_class(self):
        self.page.goto(self.base + "/")
        grid = self.page.locator("#jobGrid")
        expect(grid).to_have_class(re.compile(r".*\blayout-compact\b.*"))
        self.page.locator('#layoutToggle [data-layout="cards"]').click()
        expect(grid).to_have_class(re.compile(r".*\blayout-cards\b.*"))
        expect(grid.locator(".card")).to_have_count(3)

    def test_select_all_then_clear_selection(self):
        self.page.goto(self.base + "/")
        self.page.click("#selectModeBtn")
        expect(self.page.locator("#selectModeBtn")).to_contain_text("Done selecting")
        self.page.click("#selectAllVisibleBtn")
        expect(self.page.locator("#batchFetchMeta")).to_contain_text("3 selected")
        self.page.click("#clearFetchSelectBtn")
        expect(self.page.locator("#batchFetchMeta")).to_contain_text("0 selected")

    def test_select_missing_ai_when_every_card_already_has_a_score(self):
        self.page.goto(self.base + "/")
        self.page.click("#selectModeBtn")
        self.page.click("#selectMissingAiBtn")
        expect(self.page.locator("#toast")).to_contain_text("No missing-AI")
        expect(self.page.locator("#batchFetchMeta")).to_contain_text("0 selected")

    def test_select_missing_ai_picks_a_pending_stub(self):
        self.make_link_only(PENDING_ID)
        self.page.goto(self.base + "/")
        self.page.click("#selectModeBtn")
        self.page.click("#selectMissingAiBtn")
        expect(self.page.locator("#toast")).to_contain_text("missing-AI")
        expect(self.page.locator(f"#card-{PENDING_ID} .card-select")).to_be_checked()
        expect(self.page.locator("#batchFetchMeta")).to_contain_text("1 selected")

    def test_pagination_next_and_previous(self):
        if not hasattr(self.store, "add_extra_tracker_jobs"):
            self.skipTest("store.add_extra_tracker_jobs")
        self.store.add_extra_tracker_jobs(18)
        self.page.goto(self.base + "/")
        expect(self.page.locator("#jobGrid .card")).to_have_count(20)
        expect(self.page.locator("#countLabel")).to_contain_text("Page 1 of 2 (21 total)")
        pager = self.page.locator("#pagination")
        expect(pager).to_be_visible()
        pager.get_by_role("button", name="Next").click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        expect(self.page.locator("#countLabel")).to_contain_text("Page 2 of 2")
        pager.get_by_role("button", name="Previous").click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(20)
        expect(self.page.locator("#countLabel")).to_contain_text("Page 1 of 2")

    def test_overview_and_stacks_tabs_load(self):
        self.page.goto(self.base + "/")
        self.page.click("#tabOverview")
        overview = self.page.locator("#overviewView")
        expect(overview).to_be_visible()
        expect(overview.locator("#calSection")).to_be_visible()
        expect(self.page.locator("#statsBar")).to_be_hidden()
        self.page.click("#tabStacks")
        stacks = self.page.locator("#stacksView")
        expect(stacks).to_be_visible()
        expect(stacks.locator("#stacksTotals")).to_be_visible()
        self.page.click("#tabJobs")
        expect(self.page.locator("#jobsView")).to_be_visible()
        expect(self.page.locator("#jobGrid .card")).to_have_count(3)
        expect(self.page.locator("#statsBar")).to_be_visible()

    def test_refresh_reloads_the_list(self):
        self.page.goto(self.base + "/")
        expect(self.page.locator("#jobGrid .card")).to_have_count(3)
        self.page.click("#refreshBtn")
        expect(self.page.locator("#jobGrid .card")).to_have_count(3)

    def test_origin_filter_hides_scraper_jobs_when_manual_picked(self):
        self.page.goto(self.base + "/")
        self.page.click("#filterBtn")
        self.page.select_option("#originFilter", "manual")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)
        expect(self.page.get_by_text("No Matched Jobs")).to_be_visible()
        expect(self.page.locator("#filterBtn")).to_contain_text("Filters (1)")

    def test_custom_date_range_can_empty_the_list(self):
        self.page.goto(self.base + "/")
        self.page.click("#filterBtn")
        self.page.select_option("#timePreset", "custom")
        expect(self.page.locator("#filterPop")).to_be_visible()
        self.page.fill("#dateFrom", "2020-01-01")
        self.page.fill("#dateTo", "2020-01-02")
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)

    def test_company_chip_remove_clears_the_company_filter(self):
        self.open_card(PENDING_ID)
        self.page.locator(f"#card-{PENDING_ID} .company-link").click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        self.page.locator('.search-chip button[aria-label="Remove Acme"]').click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(3)

    def test_filter_popover_closes_after_picking_a_source(self):
        self.page.goto(self.base + "/")
        self.page.click("#filterBtn")
        expect(self.page.locator("#filterPop")).to_be_visible()
        self.page.select_option("#sourceFilter", "linkedin")
        expect(self.page.locator("#filterPop")).to_be_hidden()
        expect(self.page.locator("#jobGrid .card")).to_have_count(3)

    def test_show_more_statuses_reveals_side_chips(self):
        self.page.goto(self.base + "/")
        self.page.locator(".stats-more-toggle").click()
        expect(self.page.locator('.stat-chip[data-status="unsuitable"]')).to_be_visible()
        self.page.locator('.stat-chip[data-status="unsuitable"]').click()
        expect(self.page.locator("#jobGrid .card")).to_have_count(0)

    def test_date_group_header_collapses_that_day(self):
        self.page.goto(self.base + "/")
        self.page.locator(".date-group-header").first.click()
        expect(self.page.locator(".date-group-header").first).to_have_class(re.compile(r".*\bcollapsed\b.*"))
        expect(self.page.locator(".date-group-cards.hidden .card")).not_to_have_count(0)
