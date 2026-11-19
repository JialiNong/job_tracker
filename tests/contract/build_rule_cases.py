#!/usr/bin/env python3
"""Write tests/contract/rule_cases.json: inputs and the Python answers for the
Tracker's pure rules (status from timeline, chips, filters, country, origin,
missing details, links, serialization). packages/core runs the same inputs
and must give the same answers, so the TypeScript port is checked against
the code it replaces instead of against hand-copied expectations.

Dates are written as "YYYY-MM-DDTHH:MM:SS" wall-clock (Europe/Berlin).

    python3 tests/contract/build_rule_cases.py
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

os.environ.setdefault("TRACKER_ALLOW_FIXED_NOW", "1")
os.environ.setdefault("TRACKER_FIXED_NOW", "2026-11-13T12:00")

from bson import json_util  # noqa: E402

from core.country import COUNTRY_LABELS, job_country  # noqa: E402
from core.job_origin import infer_origin  # noqa: E402
from core.manual_log import can_fetch_details, job_missing_details  # noqa: E402
from web.serialize import _normalize_link, _serialize, company_history_item  # noqa: E402
from web.status import (  # noqa: E402
    PROGRESS_STAGES,
    SIDE_STATUSES,
    _hydrate_timeline,
    _status_from_timeline,
    application_progress,
    chip_status_counts,
    job_matches_status_filter,
    job_reached_interview,
)

HERE = Path(__file__).resolve().parent
FILTERS = ["all", "active", "got_interview", "pending", *PROGRESS_STAGES, *SIDE_STATUSES]


def wall(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S") if isinstance(dt, datetime) else dt


def to_jsonable(value):
    if isinstance(value, datetime):
        return wall(value)
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_jsonable(v) for v in value]
    if hasattr(value, "binary"):  # ObjectId
        return str(value)
    return value


def d(text):
    return datetime.fromisoformat(text)


def synthetic_jobs() -> list[dict]:
    """Shapes the fixture does not cover: old records without a timeline, odd orders."""
    a, b, c = d("2026-10-01T10:00:00"), d("2026-10-05T09:00:00"), d("2026-10-09T15:00:00")
    out = []
    for status in ["pending", "applied", "screening", "interview", "interview_cancelled",
                   "offer", "rejected", *SIDE_STATUSES]:
        out.append({"status": status, "applied_at": a, "updated_at": b, "matched_at": a})
        out.append({"status": status, "applied_at": None, "updated_at": b, "matched_at": a})
    timelines = [
        [("applied", a), ("screening", b)],
        [("applied", a), ("screening", c), ("interview_invite", b)],  # backfilled screening dated last
        [("applied", a), ("interview_invite", b), ("interview_cancelled", c)],
        [("applied", a), ("rejected", b), ("reapplied", c)],
        [("applied", a), ("interview_1", b), ("rejected", c)],
        [("applied", a), ("offer", c), ("interview_final", b)],
        [("screening_done", b)],
        [("applied", None), ("interview_2", None)],
        [("applied", "2026-10-01 10:00"), ("interview_3", "2026-10-03T08:00:00")],
    ]
    for steps in timelines:
        for status in ["applied", "interview", "unsuitable", "closed"]:
            out.append({
                "status": status, "applied_at": a, "updated_at": c, "matched_at": a,
                "application_timeline": [{"step": s, "at": t} for s, t in steps],
            })
    return out


LOCATIONS = [
    "Berlin, Germany", "Berlin (hybrid) or Helsinki", "München", "Munich, Bavaria", "Köln",
    "Remote (Germany)", "Remote (Europe)", "Remote", "Fully remote, worldwide", "European Union (Remote)",
    "EMEA", "Amsterdam, Netherlands", "Wien", "Zürich", "Paris, France", "Brussels", "London, UK",
    "U.K.", "Dublin", "Copenhagen", "Stockholm", "Oslo", "Helsinki, Finland", "Tallinn", "Riga",
    "Vilnius", "Warsaw, Poland", "Łódź", "Prague", "Bratislava", "Budapest", "Bucharest", "Sofia",
    "Athens", "Zagreb", "Ljubljana", "Belgrade", "Valletta", "Limassol", "New York, USA",
    "San Francisco, US", "Toronto, Canada", "Bangalore", "Tel Aviv", "Dubai", "Leipzig", "Essen",
    "Kiel", "Bonn", "Hybrid", "", "   ", "Somewhere nice", "Lisboa", "Porto", "Milano", "Rome",
    "Barcelona", "Málaga", "Luxembourg", "Reykjavík", "Cork, Ireland", "Lund",
]


def main():
    fixture = json_util.loads((HERE / "fixture.json").read_text(encoding="utf-8"))
    tracker = fixture["collections"]["matched_jobs"]
    jobs = [*tracker, *synthetic_jobs()]

    rule_jobs = []
    for job in jobs:
        rule_jobs.append({
            "input": to_jsonable({k: job.get(k) for k in
                                  ("status", "applied_at", "updated_at", "matched_at", "application_timeline")
                                  if k in job}),
            "status_from_timeline": _status_from_timeline(job.get("application_timeline") or [], fallback=job.get("status") or "pending")
            if job.get("application_timeline") else None,
            "progress": application_progress(job),
            "reached_interview": job_reached_interview(job),
            "filters": {f: job_matches_status_filter(job, f) for f in FILTERS},
            "hydrated": to_jsonable(_hydrate_timeline(job)),
        })

    countries = [{"location": loc, "stored": None, "country": job_country(loc)} for loc in LOCATIONS]
    countries += [{"location": "Berlin", "stored": s, "country": job_country("Berlin", s)}
                  for s in ("uk", "remote", "GERMANY", "atlantis", "")]

    serialized = []
    for job in tracker:
        doc = dict(job)
        doc.pop("description", None)  # the list projection drops it
        serialized.append({"input": to_jsonable(job), "output": to_jsonable(_serialize(dict(doc)))})

    extras = [
        {"source": "linkedin", "job_id": "4100000001", "link": "/jobs/view/4100000001/?trk=x"},
        {"source": "linkedin", "job_id": "", "link": "/jobs/view/9/"},
        {"source": "linkedin", "job_id": "41", "link": "https://careers.acme.com/job/1"},
        {"source": "indeed", "job_id": "abc", "link": "https://de.indeed.com/viewjob?jk=abc"},
    ]
    links = [{"input": e, "link": _normalize_link(dict(e))} for e in extras]

    detail_inputs = [
        {"title": "(Link only) Acme", "summary": "x"},
        {"title": "Dev", "ai_pending": True},
        {"title": "Dev", "summary": ""},
        {"title": "Dev", "summary": "ok"},
        {"title": "Dev", "summary": "ok", "recommended_by": "claude"},
        {"title": "Dev", "summary": "ok", "link_replaced_at": d("2026-11-02T10:00:00")},
        {"title": "Dev", "summary": "ok", "link_replaced_at": d("2026-11-02T10:00:00"), "details_fetched_at": d("2026-11-03T10:00:00")},
        {"title": "(Link only) Dev", "details_fetched_at": d("2026-11-03T10:00:00")},
    ]
    details = [{"input": to_jsonable(x), "missing": job_missing_details(x), "can_fetch": can_fetch_details(x)}
               for x in detail_inputs]

    origins = [{"input": x, "origin": infer_origin(x)} for x in [
        {"origin": "pipeline", "source": "ats"}, {"origin": "pipeline", "source": "linkedin"},
        {"origin": "agent"}, {"origin": "", "from_unmatched": True, "source": "arbeitnow"},
        {"created_at": "x", "recommended_by": "cursor"}, {"created_at": "x"}, {"source": "indeed"},
        {"origin": "bogus", "source": "adzuna"},
    ]]

    history = [{"input": to_jsonable(j), "output": to_jsonable(company_history_item(j))} for j in tracker[:6]]

    out = {
        "now": os.environ["TRACKER_FIXED_NOW"],
        "filters": FILTERS,
        "country_labels": COUNTRY_LABELS,
        "jobs": rule_jobs,
        "chips": chip_status_counts(jobs),
        "countries": countries,
        "serialized": serialized,
        "links": links,
        "details": details,
        "origins": origins,
        "history": history,
    }
    (HERE / "rule_cases.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(rule_jobs)} job cases, {len(countries)} countries, {len(serialized)} serialized jobs")


if __name__ == "__main__":
    main()
