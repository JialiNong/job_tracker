"""Screening: pre-interview questionnaire / Loom, not a live interview.

Does not touch a live MongoDB.
"""
from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import core.db_mongo as db_mongo  # noqa: E402

with patch.object(db_mongo, "ensure_indexes"):
    from web.flow import classify_flow_sink, job_flow_links  # noqa: E402
    from web.status import (  # noqa: E402
        GOT_INTERVIEW_FILTER,
        JOURNEY_TRACK_STEPS,
        SCREENING_TIMELINE_STEPS,
        TIMELINE_STEPS,
        _hydrate_timeline,
        _normalize_timeline,
        _status_from_timeline,
        _status_update_fields,
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
SCREEN_AT = datetime(2026, 3, 18, 16, 0)
NOW = datetime(2026, 11, 15, 21, 0)


def _job(**overrides):
    job = {
        "status": "screening",
        "applied_at": APPLIED_AT,
        "application_timeline": [
            {"step": "applied", "at": APPLIED_AT},
            {"step": "screening", "at": SCREEN_AT},
        ],
    }
    job.update(overrides)
    return job


class ScreeningStatusTests(unittest.TestCase):
    def test_step_is_known(self):
        self.assertEqual(TIMELINE_STEPS["screening"], "Screening")
        self.assertEqual(TIMELINE_STEPS["screening_done"], "Submitted")
        self.assertEqual(SCREENING_TIMELINE_STEPS, ("screening", "screening_done"))
        self.assertIn("screening", JOURNEY_TRACK_STEPS)
        self.assertIn("screening_done", JOURNEY_TRACK_STEPS)
        raw = [{"step": "screening", "at": "2026-03-18 16:00"}]
        self.assertEqual(_normalize_timeline(raw)[0]["step"], "screening")
        done = [{"step": "screening_done", "at": "2026-03-20 11:00"}]
        self.assertEqual(_normalize_timeline(done)[0]["step"], "screening_done")

    def test_latest_screening_is_screening_progress(self):
        self.assertEqual(_status_from_timeline(_job()["application_timeline"]), "screening")
        self.assertEqual(application_progress(_job()), "screening")

    def test_submitted_still_screening_progress(self):
        job = _job(
            application_timeline=[
                {"step": "applied", "at": APPLIED_AT},
                {"step": "screening", "at": SCREEN_AT},
                {"step": "screening_done", "at": NOW},
            ],
        )
        self.assertEqual(_status_from_timeline(job["application_timeline"]), "screening")
        self.assertEqual(application_progress(job), "screening")
        self.assertTrue(job_matches_status_filter(job, "screening"))
        self.assertFalse(job_reached_interview(job))
        self.assertFalse(job_matches_status_filter(job, "applied"))

    def test_screening_is_not_got_interview(self):
        job = _job()
        self.assertFalse(job_reached_interview(job))
        self.assertTrue(job_matches_status_filter(job, "screening"))
        self.assertTrue(job_matches_status_filter(job, "active"))
        self.assertFalse(job_matches_status_filter(job, "interview"))
        self.assertFalse(job_matches_status_filter(job, "applied"))
        self.assertFalse(job_matches_status_filter(job, GOT_INTERVIEW_FILTER))

    def test_invite_after_screening_is_interview(self):
        job = _job(
            status="interview",
            application_timeline=[
                {"step": "applied", "at": APPLIED_AT},
                {"step": "screening", "at": SCREEN_AT},
                {"step": "interview_invite", "at": NOW},
            ],
        )
        self.assertEqual(application_progress(job), "interview")
        self.assertTrue(job_reached_interview(job))
        self.assertFalse(job_matches_status_filter(job, "screening"))

    def test_side_status_keeps_screening_progress(self):
        job = _job(status="unsuitable")
        self.assertEqual(application_progress(job), "screening")
        self.assertTrue(job_matches_status_filter(job, "screening"))
        self.assertTrue(job_matches_status_filter(job, "unsuitable"))

    def test_query_matches_latest_screening_step(self):
        query = jobs_status_filter_query("screening")
        self.assertIn("$or", query)
        self.assertNotEqual(query, {"status": "screening"})
        blob = repr(query)
        self.assertIn("screening", blob)
        self.assertIn("screening_done", blob)

    def test_chip_counts_screening_separately(self):
        jobs = [
            _job(),
            _job(status="unsuitable"),
            _job(
                application_timeline=[
                    {"step": "applied", "at": APPLIED_AT},
                    {"step": "screening", "at": SCREEN_AT},
                    {"step": "screening_done", "at": NOW},
                ],
            ),
            {
                "status": "applied",
                "applied_at": APPLIED_AT,
                "application_timeline": [{"step": "applied", "at": APPLIED_AT}],
            },
        ]
        counts = chip_status_counts(jobs)
        self.assertEqual(counts.get("screening"), 3)
        self.assertEqual(counts.get("applied"), 1)
        self.assertEqual(counts.get("unsuitable"), 1)
        self.assertEqual(counts.get(GOT_INTERVIEW_FILTER), 0)

    def test_flat_status_hydrates_screening_step(self):
        job = {
            "status": "screening",
            "applied_at": APPLIED_AT,
            "application_timeline": [],
            "updated_at": SCREEN_AT,
        }
        self.assertEqual(
            [e["step"] for e in _hydrate_timeline(job)],
            ["applied", "screening"],
        )

    def test_timeline_write_sets_status_screening(self):
        job = {
            "status": "applied",
            "applied_at": APPLIED_AT,
            "application_timeline": [{"step": "applied", "at": APPLIED_AT}],
        }
        fields = _timeline_update_fields(
            job,
            [
                {"step": "applied", "at": APPLIED_AT},
                {"step": "screening", "at": SCREEN_AT},
            ],
            NOW,
        )
        self.assertEqual(fields["status"], "screening")

    def test_submitted_write_keeps_status_screening(self):
        job = _job()
        fields = _timeline_update_fields(
            job,
            [
                {"step": "applied", "at": APPLIED_AT},
                {"step": "screening", "at": SCREEN_AT},
                {"step": "screening_done", "at": NOW},
            ],
            NOW,
        )
        self.assertEqual(fields["status"], "screening")

    def test_status_patch_stamps_applied_at(self):
        job = {"status": "pending", "applied_at": None, "application_timeline": []}
        fields = _status_update_fields(job, "screening", NOW)
        self.assertEqual(fields["status"], "screening")
        self.assertEqual(fields["applied_at"], NOW)


class ScreeningFlowTests(unittest.TestCase):
    def test_current_screening_is_a_column1_sink(self):
        job = _job()
        self.assertEqual(classify_flow_sink(job), "screening")
        self.assertEqual(job_flow_links(job), [("applied", "screening")])

    def test_submitted_stays_screening_sink(self):
        job = _job(
            application_timeline=[
                {"step": "applied", "at": APPLIED_AT},
                {"step": "screening", "at": SCREEN_AT},
                {"step": "screening_done", "at": NOW},
            ],
        )
        self.assertEqual(classify_flow_sink(job), "screening")
        self.assertEqual(job_flow_links(job), [("applied", "screening")])

    def test_rejected_after_screening_without_invite_is_rejected(self):
        job = _job(
            status="rejected",
            application_timeline=[
                {"step": "applied", "at": APPLIED_AT},
                {"step": "screening", "at": SCREEN_AT},
                {"step": "rejected", "at": NOW},
            ],
        )
        self.assertEqual(classify_flow_sink(job), "rejected")


class ScreeningUiTests(unittest.TestCase):
    def test_chip_and_actions(self):
        self.assertIn('data-status="screening"', HTML)
        self.assertIn("cnt-screening", HTML)
        self.assertIn("screening:        'Screening'", HTML)
        self.assertIn("step: 'screening', label: '+ Screening'", HTML)
        self.assertIn("step: 'screening_done', label: '+ Submitted'", HTML)
        self.assertIn("if (last === 'screening')", HTML)
        self.assertIn("if (last === 'screening_done')", HTML)
        self.assertIn("screening_done:   'Submitted'", HTML)
        self.assertIn(".status-pill.s-screening", HTML)
        self.assertIn(".progress-node.step-screening", HTML)
        self.assertIn(".dot-screening", HTML)


if __name__ == "__main__":
    unittest.main()
