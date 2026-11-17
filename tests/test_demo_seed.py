"""Synthetic screenshot dataset: volume, statuses, no scraper origin."""
from __future__ import annotations

import sys
import unittest
from collections import Counter
from datetime import datetime
from pathlib import Path

# scripts/db is not a package: import its modules the way the scripts run
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "db"))

from core.applied_location import is_germany_or_remote, normalize_applied_location  # noqa: E402
from demo_dataset import build_demo_dataset, dataset_summary  # noqa: E402
from seed_demo import _redact_uri, refuses_production_db  # noqa: E402
from web.flow import build_sankey, build_weekly_by_platform, classify_flow_sink  # noqa: E402
from web.status import JOURNEY_INTERVIEW_STEPS  # noqa: E402

TODAY = datetime(2026, 11, 17, 15, 0)


def _applied(job: dict) -> bool:
    if job.get("applied_at"):
        return True
    if job.get("application_timeline"):
        return True
    return False


class DemoDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = build_demo_dataset(today=TODAY, seed=17)
        cls.matched = cls.data["matched_jobs"]
        cls.summary = dataset_summary(cls.data)

    def test_no_pipeline_origin(self):
        self.assertEqual(self.summary["pipeline_origin"], 0)
        self.assertFalse(any(j.get("origin") == "pipeline" for j in self.matched))
        self.assertFalse(any(j.get("origin") == "pipeline" for j in self.data["jobs"]))

    def test_does_not_seed_timeouts(self):
        self.assertNotIn("timeout_jobs", self.data)

    def test_enough_tracker_rows(self):
        self.assertGreaterEqual(len(self.matched), 140)
        self.assertGreaterEqual(self.summary["applications"], 110)
        self.assertGreaterEqual(len(self.data["jobs"]), 40)

    def test_all_progress_statuses_present(self):
        statuses = {j.get("status") for j in self.matched}
        for needed in (
            "pending", "applied", "screening", "interview",
            "interview_cancelled", "offer", "rejected",
            "unsuitable", "closed", "closed_no_reply",
            "prev_rejected", "too_many_questions", "repost", "duplicate",
        ):
            self.assertIn(needed, statuses, f"missing status {needed}")

    def test_origins_are_api_manual_agent(self):
        origins = {j.get("origin") for j in self.matched}
        self.assertTrue(origins <= {"api", "manual", "agent"})
        self.assertIn("api", origins)
        self.assertIn("manual", origins)
        self.assertIn("agent", origins)

    def test_location_bubbles_have_several_cities(self):
        counter = Counter()
        for job in self.matched:
            if not _applied(job):
                continue
            n = 1 + sum(
                1 for item in job.get("application_timeline") or []
                if item.get("step") == "reapplied"
            )
            raw = job.get("location") or ""
            name = normalize_applied_location(raw)
            if is_germany_or_remote(raw, name):
                counter[name] += n
        cities = {name for name, count in counter.items() if count >= 2}
        for needed in ("Berlin", "Munich", "Hamburg", "Leipzig", "Remote", "Cologne"):
            self.assertIn(needed, cities, f"{needed} missing or <2 applications")
        self.assertGreaterEqual(len(cities), 10)

    def test_applied_dates_cover_the_heatmap_window(self):
        dates = []
        for job in self.matched:
            at = job.get("applied_at")
            if at:
                dates.append(at.date())
        self.assertTrue(dates)
        span = (max(dates) - min(dates)).days
        self.assertGreaterEqual(span, 80)

    def test_sankey_sinks_are_populated(self):
        applied = [j for j in self.matched if _applied(j)]
        chart = build_sankey(applied, now=TODAY)
        ids = {n["id"] for n in chart["nodes"]}
        for needed in (
            "applied", "waiting", "screening", "rejected", "interview",
            "awaiting", "cancelled", "offer",
        ):
            self.assertIn(needed, ids, f"sankey missing {needed}")
        self.assertGreaterEqual(chart["total"], 100)

    def test_journey_tracks_stay_around_ten(self):
        tracks = []
        for job in self.matched:
            steps = {
                item.get("step")
                for item in job.get("application_timeline") or []
                if isinstance(item, dict)
            }
            if steps & JOURNEY_INTERVIEW_STEPS:
                tracks.append(job)
        self.assertGreaterEqual(len(tracks), 8)
        self.assertLessEqual(len(tracks), 11)

    def test_weekly_bars_include_all_platforms(self):
        applied = [j for j in self.matched if _applied(j)]
        weekly = build_weekly_by_platform(applied, today=TODAY.date())
        totals = weekly["totals"]
        self.assertGreater(totals["linkedin"], 0)
        self.assertGreater(totals["indeed"], 0)
        self.assertGreater(totals["other"], 0)
        self.assertGreaterEqual(len(weekly["weeks"]), 10)

    def test_unmatched_has_agent_reminders(self):
        unmatched = self.data["jobs"]
        agents = [j for j in unmatched if j.get("agent_recommended_by")]
        self.assertGreaterEqual(len(agents), 6)
        gates = {j.get("match_gate") for j in unmatched}
        self.assertIn("german", gates)
        self.assertTrue(all((j.get("match_score") or 0) < 7.0 for j in unmatched))

    def test_scraper_stats_cover_daily_activity(self):
        daily = [d for d in self.data["scraper_stats"] if str(d["_id"]).startswith("daily_")]
        self.assertGreaterEqual(len(daily), 90)
        clicked = sum(d["title_passed_clicked"] for d in daily)
        german = sum(d["german_filtered"] for d in daily)
        self.assertGreater(clicked, 800)
        self.assertGreater(german, 80)
        global_doc = next(d for d in self.data["scraper_stats"] if d["_id"] == "global")
        self.assertEqual(global_doc["title_passed_clicked"], clicked)

    def test_weekends_have_no_activity(self):
        for job in self.matched:
            for key in ("applied_at", "matched_at"):
                at = job.get(key)
                if at:
                    self.assertLess(at.weekday(), 5, f"{key} landed on a weekend")
            for item in job.get("application_timeline") or []:
                at = item.get("at")
                if at:
                    self.assertLess(at.weekday(), 5, f"timeline {item.get('step')} on weekend")
        for job in self.data["jobs"]:
            for key in ("matched_at", "created_at", "agent_recommended_at"):
                at = job.get(key)
                if at:
                    self.assertLess(at.weekday(), 5, f"unmatched {key} landed on a weekend")
        for doc in self.data["scraper_stats"]:
            date = doc.get("date")
            if not date:
                continue
            day = datetime.strptime(date, "%Y-%m-%d")
            if day.weekday() >= 5:
                self.assertEqual(doc.get("title_passed_clicked"), 0)
                self.assertEqual(doc.get("german_filtered"), 0)

    def test_mongo_uri_is_redacted_in_cli(self):
        shown = _redact_uri("mongodb+srv://user:secret@cluster.example.net/db")
        self.assertNotIn("secret", shown)
        self.assertNotIn("user", shown)
        self.assertIn("cluster.example.net", shown)

    def test_production_db_name_is_refused_without_force(self):
        self.assertTrue(refuses_production_db("job_scraper"))
        self.assertTrue(refuses_production_db(" job_scraper "))
        self.assertFalse(refuses_production_db("job_scraper", force=True))
        self.assertFalse(refuses_production_db("job_scraper_demo"))
        self.assertFalse(refuses_production_db("job_scraper_e2e"))

    def test_seeded_links_are_unique(self):
        for name in ("matched_jobs", "jobs"):
            links = [j.get("link") for j in self.data[name]]
            self.assertEqual(len(links), len(set(links)), f"duplicate link in {name}")
            keys = [j.get("posting_key") for j in self.data[name] if j.get("posting_key")]
            self.assertEqual(len(keys), len(set(keys)), f"duplicate posting_key in {name}")

    def test_flow_sinks_include_upcoming_rounds(self):
        sinks = {classify_flow_sink(j, now=TODAY) for j in self.matched if _applied(j)}
        self.assertIn("round_1_upcoming", sinks)


if __name__ == "__main__":
    unittest.main()
