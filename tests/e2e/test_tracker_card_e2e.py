"""Tracker card body: timeline, notes, edit, highlights, Q&A, delete."""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta

from harness import APPLIED_ID, DELETE_ID, E2ECase, PENDING_ID, wait_for
from playwright.sync_api import expect


class TrackerCardE2E(E2ECase):
    def test_record_applied_then_screening(self):
        progress = self.open_card(PENDING_ID)
        progress.get_by_role("button", name="+ Applied").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "applied", "status = applied")

        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Screening").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "screening", "status = screening")
        steps = [e["step"] for e in self.job(PENDING_ID)["application_timeline"]]
        self.assertEqual(steps, ["applied", "screening"])
        expect(progress.locator(".progress-node")).to_have_count(2)
        expect(progress.get_by_role("button", name="+ Submitted")).to_be_visible()

        progress.get_by_role("button", name="+ Submitted").click()
        self.confirm_modal()
        wait_for(
            lambda: [
                e["step"] for e in self.job(PENDING_ID)["application_timeline"]
            ] == ["applied", "screening", "screening_done"],
            "timeline includes submitted",
        )
        self.assertEqual(self.job(PENDING_ID)["status"], "screening")
        expect(progress.locator(".progress-node")).to_have_count(3)
        expect(progress.get_by_role("button", name="+ Invite")).to_be_visible()

    def test_record_applied_updates_status_chips(self):
        self.open_card(PENDING_ID)
        self.page.wait_for_function(
            "() => /^\\d+$/.test(document.getElementById('cnt-applied').textContent)"
            " && /^\\d+$/.test(document.getElementById('cnt-pending').textContent)"
            " && /^\\d+$/.test(document.getElementById('cnt-rejected').textContent)"
        )
        before_applied = int(self.page.locator("#cnt-applied").inner_text())
        before_pending = int(self.page.locator("#cnt-pending").inner_text())
        before_rejected = int(self.page.locator("#cnt-rejected").inner_text())

        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Applied").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "applied", "status = applied")
        wait_for(
            lambda: self.page.locator("#cnt-applied").inner_text() == str(before_applied + 1),
            "applied chip +1",
        )
        self.assertEqual(int(self.page.locator("#cnt-pending").inner_text()), before_pending - 1)

        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Rejected").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "rejected", "status = rejected")
        wait_for(
            lambda: self.page.locator("#cnt-rejected").inner_text() == str(before_rejected + 1),
            "rejected chip +1",
        )
        self.assertEqual(int(self.page.locator("#cnt-applied").inner_text()), before_applied)
        job = self.job(PENDING_ID)
        self.assertEqual([e["step"] for e in job["application_timeline"]], ["applied", "rejected"])
        self.assertIsNotNone(job["applied_at"], "+ Rejected must keep the Applied record")
        expect(self.page.locator(f"#card-{PENDING_ID} .status-pill")).to_have_text("Rejected")
        expect(progress.locator(".progress-node")).to_have_count(2)
        expect(progress.locator(".node-label").nth(1)).to_have_text("Rejected")

    def test_rejected_survives_undo_click_while_save_is_in_flight(self):
        """+ Rejected on an already-applied card: leftover Undo after Save must not wipe to Not applied."""
        progress = self.open_card(APPLIED_ID)
        held: list = []

        def hold_timeline(route):
            if route.request.method != "PATCH":
                route.continue_()
                return
            held.append(route)

        self.page.route("**/api/jobs/*/timeline", hold_timeline)
        try:
            progress.get_by_role("button", name="+ Rejected").click()
            self.page.locator(".tl-modal").wait_for(state="visible")
            # Undo is still enabled under the time modal; the write lock must ignore this.
            progress.locator("button.btn-undo").dispatch_event("click")
            self.confirm_modal()
            deadline = time.time() + 10
            while not held:
                if time.time() > deadline:
                    self.fail("rejected PATCH did not start")
                self.page.wait_for_timeout(50)
            self.assertEqual(len(held), 1, "Undo must not send a second timeline PATCH")
            payload = json.loads(held[0].request.post_data or "{}")
            self.assertEqual(
                [e["step"] for e in payload.get("timeline") or []],
                ["applied", "rejected"],
            )
            for req in list(held):
                req.continue_()
        finally:
            self.page.unroute("**/api/jobs/*/timeline")

        wait_for(lambda: self.job(APPLIED_ID)["status"] == "rejected", "status = rejected")
        job = self.job(APPLIED_ID)
        self.assertEqual([e["step"] for e in job["application_timeline"]], ["applied", "rejected"])
        self.assertIsNotNone(job["applied_at"])
        expect(self.page.locator(f"#card-{APPLIED_ID} .status-pill")).to_have_text("Rejected")
        expect(self.page.locator(f"#progress-{APPLIED_ID} .progress-node")).to_have_count(2)

    def test_record_invite_then_cancelled_keeps_got_interview(self):
        progress = self.open_card(PENDING_ID)
        progress.get_by_role("button", name="+ Applied").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "applied", "status = applied")

        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Invite").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "interview", "status = interview")
        before = self.settled_chip_counts("got_interview", "interview", "interview_cancelled")
        before_got = before["got_interview"]
        before_interview = before["interview"]
        before_cancelled = before["interview_cancelled"]

        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Cancelled").click()
        self.confirm_modal()
        wait_for(
            lambda: self.job(PENDING_ID)["status"] == "interview_cancelled",
            "status = interview_cancelled",
        )
        steps = [e["step"] for e in self.job(PENDING_ID)["application_timeline"]]
        self.assertEqual(steps, ["applied", "interview_invite", "interview_cancelled"])
        after = self.settled_chip_counts("got_interview", "interview", "interview_cancelled")
        self.assertEqual(after["interview_cancelled"], before_cancelled + 1)
        self.assertEqual(after["got_interview"], before_got)
        self.assertEqual(after["interview"], before_interview - 1)

    def test_record_applied_then_invite(self):
        progress = self.open_card(PENDING_ID)
        progress.get_by_role("button", name="+ Applied").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "applied", "status = applied")
        self.assertIsNotNone(self.job(PENDING_ID)["applied_at"])

        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Invite").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "interview", "status = interview")
        steps = [e["step"] for e in self.job(PENDING_ID)["application_timeline"]]
        self.assertEqual(steps, ["applied", "interview_invite"])
        expect(progress.locator(".progress-node")).to_have_count(2)

    def test_backfill_screening_after_invite(self):
        progress = self.open_card(PENDING_ID)
        progress.get_by_role("button", name="+ Applied").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "applied", "status = applied")

        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Invite").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "interview", "status = interview")
        expect(progress.get_by_role("button", name="+ Screening")).to_be_visible()
        expect(progress.get_by_role("button", name="+ Submitted")).to_be_visible()

        progress.get_by_role("button", name="+ Screening").click()
        self.confirm_modal()
        wait_for(
            lambda: "screening" in [
                e["step"] for e in self.job(PENDING_ID)["application_timeline"]
            ],
            "timeline includes screening",
        )
        job = self.job(PENDING_ID)
        self.assertEqual(job["status"], "interview")
        self.assertEqual(
            [e["step"] for e in job["application_timeline"]],
            ["applied", "screening", "interview_invite"],
        )
        expect(progress.locator(".progress-node")).to_have_count(3)

        progress.get_by_role("button", name="+ Submitted").click()
        self.confirm_modal()
        wait_for(
            lambda: [
                e["step"] for e in self.job(PENDING_ID)["application_timeline"]
            ] == ["applied", "screening", "screening_done", "interview_invite"],
            "submitted sits before invite",
        )
        self.assertEqual(self.job(PENDING_ID)["status"], "interview")
        expect(progress.locator(".progress-node")).to_have_count(4)

    def test_undo_applied_resets_to_not_applied(self):
        progress = self.open_card(APPLIED_ID)
        progress.get_by_role("button", name="↩ Undo").click()
        self.confirm_modal()
        wait_for(lambda: self.job(APPLIED_ID)["status"] == "pending", "status = pending")
        job = self.job(APPLIED_ID)
        self.assertEqual(job["application_timeline"], [])
        self.assertIsNone(job["applied_at"])

    def test_undo_applied_cancel_keeps_the_record(self):
        progress = self.open_card(APPLIED_ID)
        progress.get_by_role("button", name="↩ Undo").click()
        self.cancel_modal()
        self.page.locator(".tl-modal").wait_for(state="hidden")
        job = self.job(APPLIED_ID)
        self.assertEqual(job["status"], "applied")
        self.assertEqual([e["step"] for e in job["application_timeline"]], ["applied"])
        self.assertIsNotNone(job["applied_at"])

    def test_undo_later_step_asks_and_keeps_applied(self):
        progress = self.open_card(APPLIED_ID)
        progress.get_by_role("button", name="+ Rejected").click()
        self.confirm_modal()
        wait_for(lambda: self.job(APPLIED_ID)["status"] == "rejected", "status = rejected")

        progress = self.page.locator(f"#progress-{APPLIED_ID}")
        progress.get_by_role("button", name="↩ Undo").click()
        self.confirm_modal()
        wait_for(lambda: self.job(APPLIED_ID)["status"] == "applied", "undo rejected")
        job = self.job(APPLIED_ID)
        self.assertEqual([e["step"] for e in job["application_timeline"]], ["applied"])
        self.assertIsNotNone(job["applied_at"], "undoing Rejected must keep Applied")
        expect(progress.locator(".progress-node")).to_have_count(1)
        expect(self.page.locator(f"#card-{APPLIED_ID} .status-pill")).to_have_text("Applied")

    def test_undo_later_step_cancel_keeps_the_step(self):
        progress = self.open_card(APPLIED_ID)
        progress.get_by_role("button", name="+ Rejected").click()
        self.confirm_modal()
        wait_for(lambda: self.job(APPLIED_ID)["status"] == "rejected", "status = rejected")

        progress = self.page.locator(f"#progress-{APPLIED_ID}")
        progress.get_by_role("button", name="↩ Undo").click()
        self.cancel_modal()
        self.page.locator(".tl-modal").wait_for(state="hidden")
        job = self.job(APPLIED_ID)
        self.assertEqual(job["status"], "rejected")
        self.assertEqual([e["step"] for e in job["application_timeline"]], ["applied", "rejected"])
        self.assertIsNotNone(job["applied_at"])
        expect(progress.locator(".progress-node")).to_have_count(2)

    def test_side_status_keeps_application_record(self):
        self.open_card(APPLIED_ID)
        self.page.select_option(f".status-side-select[data-id='{APPLIED_ID}']", "unsuitable")
        wait_for(lambda: self.job(APPLIED_ID)["status"] == "unsuitable", "status = unsuitable")
        job = self.job(APPLIED_ID)
        self.assertIsNotNone(job["applied_at"], "side status must not wipe applied_at")
        self.assertEqual([e["step"] for e in job["application_timeline"]], ["applied"])

    def test_side_status_reset_not_applied_clears_the_record(self):
        self.open_card(APPLIED_ID)
        self.page.select_option(f".status-side-select[data-id='{APPLIED_ID}']", "closed")
        wait_for(lambda: self.job(APPLIED_ID)["status"] == "closed", "status = closed")
        self.page.select_option(f".status-side-select[data-id='{APPLIED_ID}']", "pending")
        self.confirm_modal()
        wait_for(lambda: self.job(APPLIED_ID)["status"] == "pending", "reset not applied")
        job = self.job(APPLIED_ID)
        self.assertEqual(job["application_timeline"], [])
        self.assertIsNone(job["applied_at"])

    def test_reset_not_applied_cancel_keeps_the_record(self):
        self.open_card(APPLIED_ID)
        self.page.select_option(f".status-side-select[data-id='{APPLIED_ID}']", "pending")
        self.cancel_modal()
        self.page.locator(".tl-modal").wait_for(state="hidden")
        job = self.job(APPLIED_ID)
        self.assertEqual(job["status"], "applied")
        self.assertEqual([e["step"] for e in job["application_timeline"]], ["applied"])
        self.assertIsNotNone(job["applied_at"])

    def test_save_notes(self):
        self.open_card(PENDING_ID)
        self.page.fill(f"textarea.notes-textarea[data-id='{PENDING_ID}']", "Recruiter call on Friday")
        self.page.click(f"button.btn-save[data-id='{PENDING_ID}']")
        wait_for(lambda: self.job(PENDING_ID)["notes"] == "Recruiter call on Friday", "notes saved")

    def test_save_applicant_position(self):
        self.open_card(APPLIED_ID)
        self.page.fill(f"#card-{APPLIED_ID} .applicant-pos-input", "25")
        self.page.click(f"#card-{APPLIED_ID} .applicant-pos-wrap .btn-save")
        wait_for(lambda: self.job(APPLIED_ID)["applicant_position"] == 25, "applicant # saved")

    def test_save_application_qa(self):
        self.open_card(PENDING_ID)
        card = self.page.locator(f"#card-{PENDING_ID}")
        card.locator(".qa-question").first.fill("Visa sponsorship?")
        card.locator(".qa-answer").first.fill("Yes, I have a Blue Card")
        card.locator(".qa-actions .btn-save").click()
        wait_for(
            lambda: (j := self.api_job(PENDING_ID)).get("application_qa")
            and j["application_qa"][0]["question"] == "Visa sponsorship?",
            "Q&A saved",
        )
        self.assertEqual(self.api_job(PENDING_ID)["application_qa"][0]["answer"], "Yes, I have a Blue Card")

    def test_highlight_then_filter(self):
        self.open_card(PENDING_ID)
        self.page.locator(f"#card-{PENDING_ID}").get_by_role("button", name="Leipzig", exact=True).click()
        wait_for(lambda: "Leipzig" in (self.api_job(PENDING_ID).get("highlights") or []), "highlight saved")
        self.page.locator(f"#card-{PENDING_ID} .panel-close").click()
        self.page.click("#highlightsFilter")
        expect(self.page.locator("#jobGrid .card")).to_have_count(1)
        expect(self.page.locator(f"#card-{PENDING_ID}")).to_have_count(1)

    def test_edit_original_description(self):
        self.open_card(PENDING_ID)
        card = self.page.locator(f"#card-{PENDING_ID}")
        pasted = "Pasted from the company-page modal. " * 12
        card.locator(".jd-edit-btn").click()
        card.locator(".jd-edit-textarea").wait_for(state="visible")
        card.locator(".jd-edit-textarea").fill(pasted)
        card.locator(".jd-save-btn").click()
        wait_for(
            lambda: (self.job(PENDING_ID).get("description") or "").startswith("Pasted from the company-page modal."),
            "original description saved",
        )
        job = self.job(PENDING_ID)
        self.assertIn("description", job.get("manual_fields") or [])
        expect(card.locator(".job-description-body")).to_contain_text("Pasted from the company-page modal.")

    def test_edit_job_info(self):
        self.open_card(PENDING_ID)
        card = self.page.locator(f"#card-{PENDING_ID}")
        card.locator(".edit-info-btn").click()
        card.locator(".info-input[data-field='title']").fill("Senior Backend Engineer")
        card.locator(".info-input[data-field='company']").fill("Acme Labs")
        card.locator(".info-input[data-field='location']").fill("Leipzig, Germany")
        card.locator(".info-save-btn").click()
        wait_for(lambda: self.job(PENDING_ID)["title"] == "Senior Backend Engineer", "title saved")
        job = self.job(PENDING_ID)
        self.assertEqual(job["company"], "Acme Labs")
        self.assertEqual(job["location"], "Leipzig, Germany")

    def test_replace_posting_link(self):
        pending = self.job(PENDING_ID)
        self.store.add_scraped_job({
            "job_id": pending["job_id"],
            "source": "linkedin",
            "title": pending["title"],
            "link": pending["link"],
        })
        self.open_card(PENDING_ID)
        new_url = "https://jobs.ashbyhq.com/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"
        card = self.page.locator(f"#card-{PENDING_ID}")
        card.locator(".replace-link-input").fill(new_url)
        card.locator(".replace-link-wrap .btn-save").click()
        wait_for(lambda: self.job(PENDING_ID)["source"] == "manual", "source = manual")
        job = self.job(PENDING_ID)
        self.assertEqual(job["link"], new_url)
        self.assertIsNotNone(job.get("link_replaced_at"))
        self.assertEqual(job.get("posting_key"), "ashby:0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b")
        twin = self.store.scraped_job(job["job_id"], "manual")
        self.assertIsNotNone(twin)
        self.assertEqual(twin["link"], new_url)
        expect(card.locator(".btn-apply")).to_have_attribute("href", new_url)
        expect(card.locator(".btn-fetch-details")).to_be_visible()

    def test_close_card_hides_the_body(self):
        self.open_card(PENDING_ID)
        card = self.page.locator(f"#card-{PENDING_ID}")
        expect(card.locator(".card-body")).to_be_visible()
        card.locator(".panel-close").click()
        expect(card.locator(".card-body")).to_have_count(0)

    def test_escape_closes_the_open_card(self):
        self.open_card(PENDING_ID)
        expect(self.page.locator(f"#card-{PENDING_ID} .card-body")).to_be_visible()
        self.page.keyboard.press("Escape")
        expect(self.page.locator(f"#card-{PENDING_ID} .card-body")).to_have_count(0)

    def test_delete_card_removes_matched_and_jobs_docs(self):
        self.open_card(DELETE_ID)
        self.page.click(f"#card-{DELETE_ID} .delete-job-btn")
        self.confirm_modal()
        expect(self.page.locator(f"#card-{DELETE_ID}")).to_have_count(0)
        wait_for(lambda: self.job(DELETE_ID) is None, "matched_jobs doc deleted")
        self.assertIsNone(self.store.scraped_job("4100000003"))
        self.assertIsNotNone(self.job(PENDING_ID), "other cards must stay")

    def test_edit_applied_datetime(self):
        progress = self.open_card(APPLIED_ID)
        progress.locator(".progress-node").first.click()
        self.confirm_time("2026-01-15T14:30")
        wait_for(
            lambda: (self.api_job(APPLIED_ID).get("application_timeline") or [{}])[0]
            .get("at", "").startswith("2026-01-15 14:30"),
            "applied time is 2026-01-15 14:30",
        )
        job = self.api_job(APPLIED_ID)
        self.assertEqual(job["applied_at"][:16], "2026-01-15 14:30")
        expect(progress.locator(".node-time")).to_contain_text("01-15")
        expect(progress.locator(".node-time")).to_contain_text("14:30")

    def test_reapplied_after_rejected(self):
        progress = self.open_card(APPLIED_ID)
        progress.get_by_role("button", name="+ Rejected").click()
        self.confirm_modal()
        wait_for(lambda: self.job(APPLIED_ID)["status"] == "rejected", "status = rejected")
        progress = self.page.locator(f"#progress-{APPLIED_ID}")
        expect(progress.get_by_role("button", name="+ Reapplied")).to_be_visible()
        progress.get_by_role("button", name="+ Reapplied").click()
        # Same-minute timestamps sort Reapplied before Rejected; pick a later wall clock.
        later = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")
        self.confirm_time(later)
        wait_for(
            lambda: [
                e["step"] for e in self.job(APPLIED_ID)["application_timeline"]
            ] == ["applied", "rejected", "reapplied"],
            "timeline includes reapplied",
        )
        self.assertEqual(self.job(APPLIED_ID)["status"], "applied")
        expect(progress.locator(".progress-node")).to_have_count(3)

    def test_offer_after_round_1(self):
        progress = self.open_card(PENDING_ID)
        progress.get_by_role("button", name="+ Applied").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "applied", "status = applied")
        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Invite").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "interview", "status = interview")
        progress = self.page.locator(f"#progress-{PENDING_ID}")
        progress.get_by_role("button", name="+ Round 1").click()
        self.confirm_modal()
        wait_for(
            lambda: "interview_1" in [
                e["step"] for e in self.job(PENDING_ID)["application_timeline"]
            ],
            "timeline includes round 1",
        )
        progress = self.page.locator(f"#progress-{PENDING_ID}")
        expect(progress.get_by_role("button", name="+ Offer")).to_be_visible()
        progress.get_by_role("button", name="+ Offer").click()
        self.confirm_modal()
        wait_for(lambda: self.job(PENDING_ID)["status"] == "offer", "status = offer")
        self.assertEqual(
            [e["step"] for e in self.job(PENDING_ID)["application_timeline"]],
            ["applied", "interview_invite", "interview_1", "offer"],
        )
        expect(progress.locator(".progress-node")).to_have_count(4)

    def test_stored_javascript_link_and_html_title_stay_inert(self):
        # A link / title saved before ingest validation, or from a third-party
        # API, must not run script on the Tracker. (LinkedIn links are rebuilt
        # from job_id by the server, so use an ATS job.)
        self.store.set_tracker_fields(PENDING_ID, {
            "source": "ats",
            "link": "javascript://%0Awindow.__xss=1",
            "title": '<img src=x onerror="window.__xss=1">',
        })
        self.open_card(PENDING_ID)
        card = self.page.locator(f"#card-{PENDING_ID}")
        expect(card.locator(".btn-apply")).to_have_attribute("href", "#")
        expect(card.locator(".row-title")).to_have_text('<img src=x onerror="window.__xss=1">')
        self.assertIsNone(self.page.evaluate("window.__xss"))
