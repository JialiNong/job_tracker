"""Interview cancelled before it happened: progress step, not a live interview.

Does not touch a live MongoDB.
"""
from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import patch

import core.db_mongo as db_mongo  # noqa: E402
from core.paths import PROJECT_ROOT as ROOT

with patch.object(db_mongo, "ensure_indexes"):
    from web.flow import classify_flow_sink, job_flow_links  # noqa: E402
    from web.status import (  # noqa: E402
        CANCELLED_TIMELINE_STEP,
        GOT_INTERVIEW_FILTER,
        INTERVIEW_TIMELINE_STEPS,
        JOURNEY_INTERVIEW_STEPS,
        JOURNEY_TRACK_STEPS,
        TIMELINE_STEPS,
        _hydrate_timeline,
        _normalize_timeline,
        _status_from_timeline,
        _timeline_update_fields,
        application_progress,
        chip_status_counts,
        job_matches_status_filter,
        job_reached_interview,
        jobs_status_filter_query,
    )

from page_source import page_source  # noqa: E402

HTML = page_source("index")

APPLIED_AT = datetime(2026, 3, 10, 14, 30)
INVITE_AT = datetime(2026, 4, 2, 11, 0)
CANCEL_AT = datetime(2026, 11, 17, 10, 0)


def _job(**overrides):
    job = {
        "status": "interview_cancelled",
        "applied_at": APPLIED_AT,
        "application_timeline": [
            {"step": "applied", "at": APPLIED_AT},
            {"step": "interview_invite", "at": INVITE_AT},
            {"step": CANCELLED_TIMELINE_STEP, "at": CANCEL_AT},
        ],
    }
    job.update(overrides)
    return job


class CancelledStatusTests(unittest.TestCase):
    def test_step_is_known(self):
        self.assertEqual(TIMELINE_STEPS[CANCELLED_TIMELINE_STEP], "Cancelled")
        self.assertIn(CANCELLED_TIMELINE_STEP, JOURNEY_TRACK_STEPS)
        self.assertNotIn(CANCELLED_TIMELINE_STEP, JOURNEY_INTERVIEW_STEPS)
        self.assertNotIn(CANCELLED_TIMELINE_STEP, INTERVIEW_TIMELINE_STEPS)
        raw = [{"step": CANCELLED_TIMELINE_STEP, "at": "2026-11-17 10:00"}]
        self.assertEqual(_normalize_timeline(raw)[0]["step"], CANCELLED_TIMELINE_STEP)

    def test_latest_cancelled_is_cancelled_progress(self):
        self.assertEqual(application_progress(_job()), CANCELLED_TIMELINE_STEP)
        self.assertEqual(
            _status_from_timeline(_job()["application_timeline"]),
            CANCELLED_TIMELINE_STEP,
        )

    def test_got_interview_stays_after_cancel(self):
        job = _job()
        self.assertTrue(job_reached_interview(job))
        self.assertTrue(job_matches_status_filter(job, GOT_INTERVIEW_FILTER))
        self.assertTrue(job_matches_status_filter(job, CANCELLED_TIMELINE_STEP))
        self.assertFalse(job_matches_status_filter(job, "interview"))
        self.assertFalse(job_matches_status_filter(job, "applied"))
        self.assertFalse(job_matches_status_filter(job, "rejected"))
        self.assertTrue(job_matches_status_filter(job, "active"))

    def test_invite_without_cancel_is_still_interview(self):
        job = _job(
            status="interview",
            application_timeline=[
                {"step": "applied", "at": APPLIED_AT},
                {"step": "interview_invite", "at": INVITE_AT},
            ],
        )
        self.assertEqual(application_progress(job), "interview")
        self.assertTrue(job_reached_interview(job))
        self.assertFalse(job_matches_status_filter(job, CANCELLED_TIMELINE_STEP))

    def test_new_invite_after_cancel_is_interview(self):
        later = datetime(2026, 11, 20, 9, 0)
        job = _job(
            status="interview",
            application_timeline=[
                {"step": "applied", "at": APPLIED_AT},
                {"step": "interview_invite", "at": INVITE_AT},
                {"step": CANCELLED_TIMELINE_STEP, "at": CANCEL_AT},
                {"step": "interview_invite", "at": later},
            ],
        )
        self.assertEqual(application_progress(job), "interview")
        self.assertTrue(job_reached_interview(job))
        self.assertFalse(job_matches_status_filter(job, CANCELLED_TIMELINE_STEP))

    def test_side_status_keeps_cancelled_progress(self):
        job = _job(status="unsuitable")
        self.assertEqual(application_progress(job), CANCELLED_TIMELINE_STEP)
        self.assertTrue(job_matches_status_filter(job, CANCELLED_TIMELINE_STEP))
        self.assertTrue(job_matches_status_filter(job, "unsuitable"))
        self.assertTrue(job_reached_interview(job))

    def test_backfilled_screening_does_not_hide_cancelled(self):
        job = _job(
            application_timeline=[
                {"step": "applied", "at": APPLIED_AT},
                {"step": "interview_invite", "at": INVITE_AT},
                {"step": CANCELLED_TIMELINE_STEP, "at": CANCEL_AT},
                {"step": "screening", "at": datetime(2026, 11, 17, 18, 0)},
            ],
        )
        self.assertEqual(_status_from_timeline(job["application_timeline"]), CANCELLED_TIMELINE_STEP)
        self.assertEqual(application_progress(job), CANCELLED_TIMELINE_STEP)

    def test_chip_counts_cancelled_and_got_interview(self):
        jobs = [
            _job(),
            _job(
                status="interview",
                application_timeline=[
                    {"step": "applied", "at": APPLIED_AT},
                    {"step": "interview_invite", "at": INVITE_AT},
                ],
            ),
            {
                "status": "applied",
                "applied_at": APPLIED_AT,
                "application_timeline": [{"step": "applied", "at": APPLIED_AT}],
            },
        ]
        counts = chip_status_counts(jobs)
        self.assertEqual(counts.get(CANCELLED_TIMELINE_STEP), 1)
        self.assertEqual(counts.get("interview"), 1)
        self.assertEqual(counts.get(GOT_INTERVIEW_FILTER), 2)
        self.assertEqual(counts.get("applied"), 1)

    def test_flat_status_hydrates_invite_and_cancelled(self):
        job = {
            "status": CANCELLED_TIMELINE_STEP,
            "applied_at": APPLIED_AT,
            "application_timeline": [],
        }
        steps = [e["step"] for e in _hydrate_timeline(job)]
        self.assertEqual(steps, ["applied", "interview_invite", CANCELLED_TIMELINE_STEP])
        self.assertTrue(job_reached_interview(job))

    def test_timeline_write_sets_status_cancelled(self):
        job = {
            "status": "interview",
            "applied_at": APPLIED_AT,
            "application_timeline": [
                {"step": "applied", "at": APPLIED_AT},
                {"step": "interview_invite", "at": INVITE_AT},
            ],
        }
        fields = _timeline_update_fields(
            job,
            [
                {"step": "applied", "at": APPLIED_AT},
                {"step": "interview_invite", "at": INVITE_AT},
                {"step": CANCELLED_TIMELINE_STEP, "at": CANCEL_AT},
            ],
            CANCEL_AT,
        )
        self.assertEqual(fields["status"], CANCELLED_TIMELINE_STEP)

    def test_filter_query_is_progress_not_flat_status_only(self):
        query = jobs_status_filter_query(CANCELLED_TIMELINE_STEP)
        self.assertIn("$or", query)
        self.assertNotEqual(query, {"status": CANCELLED_TIMELINE_STEP})


class CancelledFlowTests(unittest.TestCase):
    def test_cancelled_is_interview_path_not_waiting(self):
        job = _job()
        self.assertEqual(classify_flow_sink(job), "cancelled")
        self.assertEqual(
            job_flow_links(job),
            [("applied", "interview"), ("interview", "cancelled")],
        )

    def test_upcoming_round_then_cancelled_leaves_interview_path(self):
        upcoming = datetime(2026, 11, 20, 14, 0)
        job = {
            "status": "interview",
            "applied_at": APPLIED_AT,
            "application_timeline": [
                {"step": "applied", "at": APPLIED_AT},
                {"step": "interview_invite", "at": INVITE_AT},
                {"step": "interview_1", "at": upcoming},
            ],
        }
        fields = _timeline_update_fields(
            job,
            [
                {"step": "applied", "at": APPLIED_AT},
                {"step": "interview_invite", "at": INVITE_AT},
                {"step": "interview_1", "at": upcoming},
                {"step": CANCELLED_TIMELINE_STEP, "at": CANCEL_AT},
            ],
            CANCEL_AT,
        )
        steps = [e["step"] for e in fields["application_timeline"]]
        self.assertEqual(steps, ["applied", "interview_invite", CANCELLED_TIMELINE_STEP])
        self.assertEqual(fields["status"], CANCELLED_TIMELINE_STEP)
        saved = {**job, **fields}
        self.assertEqual(classify_flow_sink(saved, now=CANCEL_AT), "cancelled")
        self.assertTrue(job_reached_interview(saved))
        self.assertFalse(job_matches_status_filter(saved, "interview"))

    def test_rescheduled_round_after_cancel_is_kept(self):
        later = datetime(2026, 11, 25, 10, 0)
        job = _job()
        fields = _timeline_update_fields(
            job,
            [
                {"step": "applied", "at": APPLIED_AT},
                {"step": "interview_invite", "at": INVITE_AT},
                {"step": CANCELLED_TIMELINE_STEP, "at": CANCEL_AT},
                {"step": "interview_1", "at": later},
            ],
            later,
        )
        self.assertEqual(fields["status"], "interview")
        steps = [e["step"] for e in fields["application_timeline"]]
        self.assertIn("interview_1", steps)
        self.assertIn(CANCELLED_TIMELINE_STEP, steps)


class CancelledUiTests(unittest.TestCase):
    def test_chip_and_actions(self):
        self.assertIn('data-status="interview_cancelled"', HTML)
        self.assertIn("cnt-interview_cancelled", HTML)
        self.assertIn("interview_cancelled: 'Cancelled'", HTML)
        self.assertIn("step: 'interview_cancelled', label: '+ Cancelled'", HTML)
        self.assertIn("if (last === 'interview_cancelled')", HTML)
        self.assertIn(".status-pill.s-interview_cancelled", HTML)
        self.assertIn(".progress-node.step-cancelled", HTML)
        self.assertIn(".dot-interview_cancelled", HTML)
        self.assertIn("function applyChipDelta(from, to)", HTML)
        self.assertIn("function refreshTrackerStats()", HTML)
        self.assertIn("cache: 'no-store'", HTML)
        self.assertIn("statsAbortController.abort()", HTML)
        self.assertIn("if (step === 'interview_cancelled') {", HTML)
        self.assertIn("INTERVIEW_STEPS.includes(ev && ev.step)", HTML)


class JsonCacheTests(unittest.TestCase):
    def test_json_responses_set_no_store(self):
        text = (ROOT / "src" / "web" / "web_app.py").read_text()
        self.assertIn('ctype.startswith("application/json")', text)
        self.assertIn('cache: \'no-store\'', HTML)


if __name__ == "__main__":
    unittest.main()
