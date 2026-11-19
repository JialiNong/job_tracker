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

from core.applied_location import is_germany_or_remote, normalize_applied_location  # noqa: E402
from core.country import COUNTRY_LABELS, job_country  # noqa: E402
from core.db_mongo import reapplied_count, resolve_applied_at  # noqa: E402
from core.job_origin import infer_origin  # noqa: E402
from core.job_url import (  # noqa: E402
    canonical_job_link,
    canonicalize_url,
    detect_source,
    extract_indeed_jk_from_url,
    is_http_url,
    normalize_pasted_job_url,
    posting_key,
    replacement_link_fields,
    resolve_job_id,
)
from core.manual_log import can_fetch_details, job_missing_details  # noqa: E402
from web.flow import build_sankey, build_weekly_by_platform, classify_flow_sink  # noqa: E402
from web.serialize import _normalize_link, _serialize, company_history_item  # noqa: E402
from web.stacks import build_stack_stats  # noqa: E402
from web.status import (  # noqa: E402
    PROGRESS_STAGES,
    SIDE_STATUSES,
    _hydrate_timeline,
    _normalize_timeline,
    _status_from_timeline,
    _status_update_fields,
    _timeline_update_fields,
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


URLS = [
    "https://www.linkedin.com/jobs/view/4100000001/",
    "https://www.linkedin.com/jobs/view/frontend-engineer-at-acme-4361502751/?trk=x",
    "linkedin.com/jobs/search/?currentJobId=4361502751&keywords=react",
    "https://de.indeed.com/viewjob?jk=abc123def&from=serp",
    "https://de.indeed.com/jobs?q=react&vjk=0f1e2d3c4b5a6978",
    "https://de.indeed.com/rc/clk?jk%3Dabc999%26from%3Dx",
    "de.indeed.com/viewjob?jk=abcdef1234567890.",
    "\"https://boards.greenhouse.io/acme/jobs/4012345?gh_src=abc\"",
    "https://acme.com/careers?gh_jid=4012345&utm_source=linkedin",
    "https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/apply",
    "https://jobs.eu.lever.co/acme/0F1E2D3C-4B5A-6978-8A9B-0C1D2E3F4A5B",
    "https://jobs.ashbyhq.com/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b?utm_medium=x",
    "https://bookboost.jobs.personio.de/job/2811207?language=en&display=en",
    "https://Bookboost.Jobs.Personio.com/job/2811207/",
    "https://apply.workable.com/acme/j/AB12CD34EF/",
    "https://acme.workable.com/j/AB12CD34EF",
    "https://acme.recruitee.com/o/frontend-engineer-berlin",
    "https://jobs.smartrecruiters.com/Acme/743999123456789-frontend-engineer",
    "https://join.com/companies/acme/12345678-frontend-engineer",
    "https://acme.teamtailor.com/jobs/4567890-frontend-engineer",
    "https://acme.bamboohr.com/careers/123?source=aWQ9MTk%3D",
    "https://acme.wd3.myworkdayjobs.com/en-US/External/job/Berlin/Frontend-Engineer_R-12345",
    "https://www.acme.com/careers/frontend-engineer/?ref=homepage&team=web&b=2&a=1",
    "https://ACME.com/careers/Frontend%20Engineer/;jsessionid=XYZ?lang=de#apply",
    "https://acme.com:8443/jobs/12?q=a+b&q=c&empty=&flag",
    "https://acme.com/jobs/12?name=M%C3%BCller&city=K%C3%B6ln",
    "https://acme.com/jobs/12?x=%zz&y=%E2%82",
    "https://user:pw@acme.com/jobs/12",
    "//acme.com/jobs/12",
    "http://acme.com",
    "https://acme.com/",
    "acme.com/jobs/12),",
    "<https://acme.com/jobs/12>",
    "'https://acme.com/jobs/12'",
    "\"https://acme.com/jobs/12",
    "  https://acme.com/jobs/12\t",
    "https://acme.com/jobs/12\n",
    "javascript://%0Aalert(1)",
    "data:text/html,hi",
    "ftp://acme.com/jobs/12",
    "#anchor",
    "",
    "https://[2001:db8::1]:8080/jobs/12?a=1",
    "https://acme.com/a/../jobs/12",
    "https://acme.com/jobs/12?utm_campaign=x&UTM_SOURCE=y&Ref=z",
    "https://acme.com/jobs/12?ç=ñ&€=1",
]


APPLIED_LOCATIONS = [
    "Berlin", "berlin-kreuzberg", "Kreuzberg", "10407 Berlin", "Kastanienallee 97, 10435 Berlin",
    "München", "Muenchen, Bavaria", "Munich (Hybrid)", "Greater Munich Metropolitan Area",
    "Frankfurt Rhine-Main Metropolitan Area", "Frankfurt am Main", "Pullach near Munich",
    "Gilching near Munich", "Bavaria near Munich", "Köln", "Stuttgart, Ulm or Berlin", "Neu-Ulm",
    "Remote", "remote (Germany)", "Remote - Germany | UK", "Remote, UK", "Homeoffice", "100% Remote",
    "Germany", "Deutschland (Remote)", "European Union (Remote)", "EMEA", "DACH", "Europe",
    "European Remote", "Amsterdam, Netherlands", "London, United Kingdom", "Wien", "Zürich",
    "Manching", "Hauptstraße 5", "Gilching, Bavaria", "bad homburg", "Böblingen", "Boeblingen",
    "Düsseldorf / Köln", "Hamburg • Remote", "Leipzig, Saxony", "Dresden (On-site)", "Essen",
    "New York, USA", "us", "Toronto", "", "   ", "Somewhere-nice town", "Ulm", "nrw",
    "Frankfurt (Oder)", "Hybrid in Berlin", "Berlin or Remote",
]


def flow_scenarios():
    a, b, c, e = d("2026-10-01T10:00:00"), d("2026-10-05T09:00:00"), d("2026-10-09T15:00:00"), d("2026-11-20T11:00:00")
    base = {"applied_at": a, "updated_at": b, "matched_at": a, "source": "linkedin"}
    shapes = [
        [], [("applied", a)], [("applied", a), ("screening", b)], [("applied", a), ("rejected", b)],
        [("applied", a), ("interview_invite", b)], [("applied", a), ("interview_invite", b), ("interview_1", c)],
        [("applied", a), ("interview_invite", b), ("interview_1", e)],
        [("applied", a), ("interview_invite", b), ("interview_2", c)], [("applied", a), ("interview_final", e)],
        [("applied", a), ("interview_invite", b), ("interview_1", c), ("rejected", e)],
        [("applied", a), ("interview_invite", b), ("rejected", c)],
        [("applied", a), ("interview_invite", b), ("interview_cancelled", c)],
        [("applied", a), ("interview_invite", b), ("screening", c)],
        [("applied", a), ("interview_final", b), ("offer", c)],
        [("applied", a), ("rejected", b), ("reapplied", c)],
        [("applied", a), ("rejected", b), ("reapplied", c), ("interview_invite", e)],
        [("applied", a), ("offer", b), ("rejected", c)],
    ]
    out = []
    for i, steps in enumerate(shapes):
        for status in ("applied", "closed_no_reply", "interview", "offer", "rejected"):
            job = {**base, "status": status, "source": ["linkedin", "indeed", "ats"][i % 3],
                   "application_timeline": [{"step": s, "at": t} for s, t in steps]}
            out.append(job)
    return out


def timeline_scenarios():
    a, b, c, e = d("2026-10-01T10:00:00"), d("2026-10-05T09:00:00"), d("2026-10-09T15:00:00"), d("2026-10-12T11:00:00")
    base = {"applied_at": a, "updated_at": b, "matched_at": a}
    jobs = {
        "fresh": {**base, "status": "pending", "applied_at": None, "application_timeline": []},
        "applied": {**base, "status": "applied", "application_timeline": [{"step": "applied", "at": a}]},
        "invited": {**base, "status": "interview", "application_timeline": [{"step": "applied", "at": a}, {"step": "interview_invite", "at": b}]},
        "round_booked": {**base, "status": "interview", "application_timeline": [
            {"step": "applied", "at": a}, {"step": "interview_invite", "at": b}, {"step": "interview_1", "at": e}]},
        "cancelled_before": {**base, "status": "interview_cancelled", "application_timeline": [
            {"step": "applied", "at": a}, {"step": "interview_invite", "at": b}, {"step": "interview_cancelled", "at": c}]},
        "side_applied": {**base, "status": "unsuitable", "application_timeline": [{"step": "applied", "at": a}]},
        "side_flat": {**base, "status": "closed", "application_timeline": []},
        "flat_applied": {**base, "status": "applied", "application_timeline": []},
    }
    payloads = {
        "empty": [],
        "applied_only": [{"step": "applied", "at": "2026-10-01 10:00"}],
        "applied_edited": [{"step": "applied", "at": "2026-10-02 08:30"}],
        "add_invite": [{"step": "applied", "at": "2026-10-01 10:00"}, {"step": "interview_invite", "at": "2026-10-05 09:00"}],
        "backfill_screening": [{"step": "applied", "at": "2026-10-01 10:00"}, {"step": "interview_invite", "at": "2026-10-05 09:00"},
                               {"step": "screening", "at": "2026-10-03 12:00"}],
        "cancel_with_later_round": [{"step": "applied", "at": "2026-10-01 10:00"}, {"step": "interview_invite", "at": "2026-10-05 09:00"},
                                    {"step": "interview_1", "at": "2026-10-12 11:00"}, {"step": "interview_cancelled", "at": "2026-10-09 15:00"}],
        "reschedule_after_cancel": [{"step": "applied", "at": "2026-10-01 10:00"}, {"step": "interview_invite", "at": "2026-10-05 09:00"},
                                    {"step": "interview_cancelled", "at": "2026-10-09 15:00"}, {"step": "interview_1", "at": "2026-10-20 10:00"}],
        "rejected": [{"step": "applied", "at": "2026-10-01 10:00"}, {"step": "rejected", "at": "2026-10-09 15:00"}],
        "no_applied_step": [{"step": "interview_invite", "at": "2026-10-05 09:00"}],
        "undated": [{"step": "applied"}, {"step": "screening", "at": "not a date"}],
        "junk_items": ["x", {"at": "2026-10-01"}, {"step": "applied", "at": "2026-10-01T10:00:00"}],
    }
    now = d("2026-11-13T12:00:00")
    out = []
    for jname, job in jobs.items():
        for pname, payload in payloads.items():
            timeline = _normalize_timeline(payload)
            fields = _timeline_update_fields(dict(job), timeline, now)
            out.append({"kind": "timeline", "job": jname, "payload": pname, "input_job": to_jsonable(job),
                        "input_payload": payload, "output": to_jsonable(fields)})
        for status in ["pending", "applied", "screening", "interview", "rejected", "offer", "unsuitable", "closed"]:
            fields = _status_update_fields(dict(job), status, now)
            out.append({"kind": "status", "job": jname, "payload": status, "input_job": to_jsonable(job),
                        "input_payload": status, "output": to_jsonable(fields)})
    return out


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

    locations = [{"raw": raw, "name": normalize_applied_location(raw),
                  "germany_or_remote": is_germany_or_remote(raw)} for raw in APPLIED_LOCATIONS]

    flow_now = d("2026-11-13T12:00:00")
    flow_jobs = flow_scenarios()
    flow = {
        "now": wall(flow_now),
        "jobs": [{"input": to_jsonable(j), "sink": classify_flow_sink(j, now=flow_now),
                  "applied_at": wall(resolve_applied_at(j)), "reapplied": reapplied_count(j)} for j in flow_jobs],
        "sankey": build_sankey(flow_jobs, now=flow_now),
        "weekly": build_weekly_by_platform(flow_jobs, today=flow_now.date()),
    }

    stack_jobs = [{**{k: v for k, v in j.items() if k in ("title", "description", "status", "application_timeline",
                                                       "applied_at", "updated_at", "matched_at")}}
                  for j in [*tracker, *[{"title": "Platform", "description": t, "status": "applied",
                                         "applied_at": d("2026-09-01T10:00:00")} for t in (
                      "We run Node.js and Spring Boot on AWS (EKS) with Datadog and PostgreSQL.",
                      "React Native app, Firebase, Sentry; deploy to Vercel. C# services on Azure.",
                      "ASP.NET Core, SQL Server, T-SQL, Grafana + Prometheus, K8s on GCP.",
                      "Express, Fastify and Hono. Redis, Mongo. Fly.io and Render.com. OTel.",
                      "Reactive streams, nextjs-like, not React. spring onboarding. Express interest.",
                  )]]]
    stacks = {"jobs": to_jsonable(stack_jobs), "now": wall(flow_now),
              "output": build_stack_stats(stack_jobs, now=flow_now)}

    urls = []
    for raw in URLS:
        norm = normalize_pasted_job_url(raw)
        fields, error = replacement_link_fields(raw)
        urls.append({
            "input": raw, "normalized": norm, "is_http": is_http_url(raw), "source": detect_source(raw),
            "canonical": canonicalize_url(raw) if norm else "", "posting_key": posting_key(raw),
            "job_id": resolve_job_id(raw), "link": canonical_job_link(norm) if norm else "",
            "jk": extract_indeed_jk_from_url(raw), "replacement": fields, "replacement_error": error,
        })

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
        "urls": urls,
        "applied_locations": locations,
        "flow": flow,
        "stacks": stacks,
        "timeline_updates": timeline_scenarios(),
    }
    (HERE / "rule_cases.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(rule_jobs)} job cases, {len(countries)} countries, {len(serialized)} serialized jobs")


if __name__ == "__main__":
    main()
