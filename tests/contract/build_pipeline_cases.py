#!/usr/bin/env python3
"""Write tests/contract/pipeline_cases.json: inputs and the Python answers for
the API-source pipeline's pure parts (title gates, cross-source dedup keys,
the strict location rule, mapping each source's payload to a job, the
Telegram digest cards and the run summary). packages/pipeline replays them.

All inputs are synthetic. Run with TZ=Europe/Berlin (the cloud runner's zone):

    TZ=Europe/Berlin PYTHONPATH=src python3 tests/contract/build_pipeline_cases.py
"""
from __future__ import annotations

import json
import os
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ["TZ"] = "Europe/Berlin"
time.tzset()

from sources import adzuna, arbeitnow, arbeitsagentur, ats  # noqa: E402
from sources.base import is_api_title_excluded, is_germany_or_remote_strict, is_on_topic_title  # noqa: E402
from sources.run_sources import _summary_line  # noqa: E402
from core.dedup import dedup_key, normalize_company, normalize_title  # noqa: E402
from core.title_gate import is_title_excluded, title_matches_auto_pass  # noqa: E402
from tg.digest import build_match_messages, format_job_block, normalize_job_link  # noqa: E402

HERE = Path(__file__).resolve().parent
BERLIN = ZoneInfo("Europe/Berlin")

TITLES = [
    "Frontend Engineer", "Senior Frontend Engineer (m/w/d)", "Full-Stack Engineer", "Fullstack Developer",
    "Full Stack Engineer – Payments", "Product Engineer", "Forward Deployed Engineer", "Software Engineer",
    "Java Developer", "JavaScript Developer", "Senior Java Engineer", "Lead Frontend Engineer", "Staff Engineer",
    "DevOps Engineer", "Cloud Engineer", "Frontend Engineer – Cloud SaaS", "VP Engineering", "Vice President of Product",
    "Director of Engineering", "New Graduate Software Engineer", "Graduate Developer", "Software Engineering Internship",
    "Engineering Manager", "Werkstudent Frontend", "Praktikum Webentwicklung", "Ausbildung Fachinformatiker",
    "Apprentice Developer", "Softwareentwickler (m/w/d)", "Web Developer", "React Developer", "TypeScript Engineer",
    "Node.js Backend Developer", "NodeJS Developer", "Programmer", "Sales Manager", "Account Executive",
    "Data Scientist", "Qt/QML Simulation HMI Software Engineer", "UI Designer", "Front-End Developer",
    "Frontend-Entwickler", "Embedded Software Engineer", "PHP Developer", ".NET Developer", "Python Engineer",
    "Go Developer", "Mobile Engineer (iOS)", "QA Engineer", "Site Reliability Engineer", "Solutions Architect",
    "", "Ingénieur Frontend", "Product Manager", "AI Engineer", "Platform Engineer", "Security Engineer",
]

COMPANIES_TITLES = [
    ("Acme GmbH", "Frontend Engineer (m/w/d)"), ("ACME", "Front-End Engineer"),
    ("Müller & Co. KG", "Full Stack Developer (all genders)"), ("Foo Technologies Inc.", "Software Engineer (f/m/x)"),
    ("Bar (Germany) GmbH", "React Developer w/m/d"), ("N26 Group", "Senior Frontend Engineer (gn*)"),
    ("Zalando SE", "Software Engineer | Payments"), ("SAP SE & Co. KGaA", "Developer (Mensch*)"),
    ("", "Frontend Engineer"), ("Acme", ""), ("Delivery Hero", "Full-stack Engineer [m/w/d]"),
    ("Bäckerei Schmidt haftungsbeschränkt", "Webentwickler (m|w|d)"), ("C++ Shop Ltd", "C++ / C# Engineer"),
]

LOCATIONS = [
    "", "Berlin", "Berlin, Germany", "Munich", "München", "Remote", "Remote (EU)", "Remote - Europe", "Remote, US",
    "Remote — Americas", "Austin, Texas", "London, UK", "Amsterdam", "Zurich, Switzerland", "Hybrid - Hamburg",
    "Deutschland", "Home office", "Work from home (DACH)", "Fully remote / Worldwide", "Walldorf", "Unterföhring",
    "Garching bei München", "Halle (Saale)", "Toronto, Canada · Remote", "Remote first", "Anywhere", "Vienna, Austria",
    "Leipzig · Remote", "EMEA", "New York",
]


def posted(value):
    """A posting time as a UTC ISO instant; naive Python datetimes here are Berlin wall time."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=BERLIN)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def job_out(job):
    """SourceJob as the TS port shapes it."""
    value = job.posted_at
    extra = {
        {"tags": "tags", "job_types": "jobTypes", "external_url": "externalUrl",
         "ats_provider": "atsProvider", "ats_slug": "atsSlug"}[k]: v
        for k, v in job.extra.items()
        # salary / contract type: no column in Postgres (not migrated either)
        if k not in ("salary_from", "salary_to", "contract_type")
    }
    return {
        "source": job.source, "jobId": job.job_id, "title": job.title, "company": job.company,
        "location": job.location, "link": job.link, "description": job.description or "",
        "postedAt": posted(value), "remote": bool(job.remote), "extra": extra,
        "locationPolicy": job.location_policy,
    }


ARBEITNOW_ITEMS = [
    {"slug": "frontend-engineer-acme-123", "title": " Frontend Engineer ", "company_name": "Acme", "location": "Berlin",
     "url": "https://www.arbeitnow.com/jobs/companies/acme/frontend-engineer-acme-123", "description": "<p>Build</p>",
     "created_at": 1763460000, "remote": False, "tags": ["React"], "job_types": ["full time"]},
    {"slug": "remote-dev", "title": "Developer", "company_name": " Foo ", "location": "", "url": "https://x/remote-dev",
     "description": "", "created_at": None, "remote": True},
]

ARBEITSAGENTUR_ITEMS = [
    {"referenznummer": "10001-1000000001-S", "stellenangebotsTitel": "Softwareentwickler (m/w/d)", "firma": "Acme GmbH",
     "stellenlokationen": [{"adresse": {"ort": "Leipzig", "land": "Deutschland"}}],
     "datumErsteVeroeffentlichung": "2026-11-18", "homeofficemoeglich": False, "externeURL": "https://acme.de/jobs/1",
     "gehaltsspanneVon": 50000},
    {"referenznummer": "10001-1000000002-S", "stellenangebotsTitel": "Frontend Engineer", "firma": "Bar",
     "stellenlokationen": [], "datumErsteVeroeffentlichung": "2026-11-17T09:30:00", "homeofficemoeglich": True},
    {"referenznummer": "10001-1000000003-S", "stellenangebotsTitel": "Web Developer", "firma": "Baz",
     "stellenlokationen": [{"adresse": {"ort": "Halle", "land": "DEUTSCHLAND"}}], "homeofficemoeglich": True},
]

ADZUNA_ITEMS = [
    {"id": 4123, "title": "Frontend Engineer", "company": {"display_name": "Acme"}, "location": {"display_name": "Berlin"},
     "redirect_url": "https://www.adzuna.de/land/ad/4123", "description": "Teaser text", "created": "2026-11-18T08:00:00Z",
     "salary_min": 60000},
]

ATS_PAYLOADS = {
    "greenhouse": {"jobs": [{"id": 111, "title": "Frontend Engineer", "location": {"name": "Berlin, Germany"},
                             "absolute_url": "https://boards.greenhouse.io/acme/jobs/111",
                             "content": "&lt;p&gt;We build &amp;amp; ship&lt;/p&gt;", "first_published": "2026-11-01T10:00:00-04:00"},
                            {"id": 112, "title": "Designer", "location": {}, "absolute_url": "https://g/112",
                             "updated_at": "2026-10-01T12:00:00Z"}]},
    "lever": [{"id": "abc", "text": "Full Stack Engineer", "categories": {"allLocations": ["Berlin", "berlin", "Munich"]},
               "workplaceType": "remote", "lists": [{"text": "You", "content": "<li>React</li>"}],
               "descriptionPlain": "Intro", "additionalPlain": "Extra", "hostedUrl": "https://jobs.lever.co/acme/abc",
               "createdAt": 1762000000000, "country": "DE"},
              {"id": "def", "text": "Engineer", "categories": {"location": "London"}, "description": "<p>x</p>",
               "hostedUrl": "https://jobs.lever.co/acme/def"}],
    "ashby": {"jobs": [{"id": "u1", "title": "Product Engineer", "location": "Berlin", "isListed": True,
                        "secondaryLocations": [{"location": "Hamburg"}], "address": {"postalAddress": {"addressCountry": "Germany"}},
                        "isRemote": False, "workplaceType": "Hybrid", "jobUrl": "https://jobs.ashbyhq.com/acme/u1",
                        "descriptionHtml": "<p>Hi</p>", "publishedAt": "2026-11-10T08:00:00.000+00:00"},
                       {"id": "u2", "title": "Hidden", "isListed": False, "jobUrl": "https://x"}]},
    "personio": """<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs><position><id>9001</id><office>Berlin</office><additionalOffices><office>Munich</office><office>berlin</office></additionalOffices>
<name>Frontend Engineer</name><jobDescriptions><jobDescription><name>Your tasks &amp; role</name><value><![CDATA[<p>Build <b>things</b></p>]]></value></jobDescription>
<jobDescription><name></name><value><![CDATA[<p>More</p>]]></value></jobDescription></jobDescriptions><createdAt>2026-11-05T09:00:00+00:00</createdAt></position>
<position><id>9002</id><office>Leipzig</office><name>Backend Engineer</name><createdAt>2026-11-06</createdAt></position></workzag-jobs>""",
    "recruitee": {"offers": [{"id": 77, "title": "Web Developer", "status": "published", "remote": True, "location": "Berlin, Germany",
                              "city": "Berlin", "country": "Germany", "careers_url": "https://acme.recruitee.com/o/web",
                              "description": "<p>D</p>", "requirements": "<p>R</p>", "published_at": "2026-10-28 13:28:31 UTC"},
                             {"id": 78, "title": "Draft", "status": "draft", "careers_url": "https://x"}]},
    "workable": {"jobs": [{"shortcode": "W1", "title": "Software Engineer", "telecommuting": False,
                           "locations": [{"city": "Berlin", "country": "Germany"}, {"city": "Hamburg", "country": "Germany"}],
                           "url": "https://apply.workable.com/acme/j/W1", "description": "<p>W</p>", "published_on": "2026-11-02"},
                          {"shortcode": "W2", "title": "Engineer", "telecommuting": True, "city": "Paris", "country": "France",
                           "shortlink": "https://apply.workable.com/j/W2", "created_at": "2026-11-03"}]},
}
# Raw date field per provider. Python drops the zone of an offset time without
# converting it (10:00-04:00 is stored as 10:00), so for dates the expected
# value is the true instant of the raw string; the TS port keeps that instant.
ATS_RAW_DATE = {
    "greenhouse": ("id", lambda j: j.get("first_published") or j.get("updated_at")),
    "lever": ("id", lambda j: j.get("createdAt")),
    "ashby": ("id", lambda j: j.get("publishedAt")),
    "recruitee": ("id", lambda j: j.get("published_at") or j.get("created_at")),
    "workable": ("shortcode", lambda j: j.get("published_on") or j.get("created_at")),
}


def true_instant(raw):
    """The instant a raw API date means: epoch ms, ISO with Z / offset, "... UTC", or Berlin wall time."""
    if raw in (None, ""):
        return None
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(raw / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    text = str(raw).strip()
    if text.endswith(" UTC"):
        text = text[:-4] + "+00:00"
    return posted(datetime.fromisoformat(text.replace("Z", "+00:00")))


def ats_cases():
    out = []
    original_json, original_text = ats.get_json, ats.get_text
    for provider, payload in ATS_PAYLOADS.items():
        entry = {"company": "Acme", "provider": provider, "slug": "acme"}
        ats.get_json = lambda url, **kw: payload
        ats.get_text = lambda url, **kw: payload
        try:
            jobs = ats.PROVIDERS[provider](entry)
        finally:
            ats.get_json, ats.get_text = original_json, original_text
        mapped = [job_out(j) for j in jobs]
        if provider == "personio":
            raw = {"9001": "2026-11-05T09:00:00+00:00", "9002": "2026-11-06"}
        else:
            key, pick = ATS_RAW_DATE[provider]
            items = payload if isinstance(payload, list) else next(iter(payload.values()))
            raw = {str(item.get(key)): pick(item) for item in items}
        for job in mapped:
            job["postedAt"] = true_instant(raw[job["jobId"].rsplit(":", 1)[1]])
        out.append({"provider": provider, "entry": entry, "payload": payload, "jobs": mapped})
    return out


DIGEST_JOBS = [
    {"title": "Frontend Engineer", "location": "Berlin", "match_score": 8.5, "source": "linkedin", "link": "/jobs/view/1/",
     "job_id": "4100000001", "company": "Acme", "status": "pending", "special_match": False},
    {"title": "Web <Dev> & Co", "location": "", "match_score": 7, "source": "ats", "link": "https://boards.greenhouse.io/a/jobs/1",
     "job_id": "greenhouse:a:1", "company": "A & B \"Quotes\"", "status": "applied", "special_match": True},
    {"title": "", "location": "Leipzig", "match_score": 9.25, "source": "indeed", "link": "/viewjob?jk=abc",
     "job_id": "", "company": "", "status": "unknown_status", "special_match": False},
    {"title": "Product Engineer", "location": "Remote", "match_score": 7.0, "source": "arbeitsagentur",
     "link": "https://www.arbeitsagentur.de/jobsuche/jobdetail/1", "job_id": "1", "company": "Bund", "status": "pending",
     "special_match": False},
    {"title": "Thing", "location": "X", "match_score": 7.5, "source": "custom_source", "link": "", "job_id": "x",
     "company": "C", "status": "pending", "special_match": False},
]


def main():
    long_jobs = [{**DIGEST_JOBS[i % len(DIGEST_JOBS)], "title": f"Job {i} " + "x" * 60} for i in range(70)]
    cases = {
        "titles": [{
            "title": t, "excluded": is_title_excluded(t), "api_excluded": is_api_title_excluded(t),
            "on_topic": is_on_topic_title(t), "auto_pass": title_matches_auto_pass(t),
        } for t in TITLES],
        "dedup": [{
            "company": c, "title": t, "company_norm": normalize_company(c), "title_norm": normalize_title(t),
            "key": dedup_key(t, c),
        } for c, t in COMPANIES_TITLES],
        "strict_location": [{"location": loc, "ok": is_germany_or_remote_strict(loc)} for loc in LOCATIONS],
        "arbeitnow": [{"item": i, "job": job_out(arbeitnow.to_source_job(i))} for i in ARBEITNOW_ITEMS],
        "arbeitsagentur": [{"item": i, "job": job_out(arbeitsagentur.to_source_job(i))} for i in ARBEITSAGENTUR_ITEMS],
        "published_since": [{"days": d, "param": arbeitsagentur.published_since_param(d)} for d in (1, 2, 3, 7, 8, 14, 20, 28, 40)],
        "adzuna": [{"item": i, "job": {**job_out(adzuna.to_source_job(i)), "postedAt": true_instant(i.get("created"))}}
                   for i in ADZUNA_ITEMS],
        "ats": ats_cases(),
        "ats_join": [{"parts": p, "out": ats._join(*p)} for p in (
            ["Berlin", "berlin", " Munich ", None, ""], [], ["Remote"], ["A", "B", "a", "Remote", "remote"],
        )],
        "digest_links": [{"job": j, "link": normalize_job_link(j)} for j in DIGEST_JOBS],
        "digest_blocks": [{"index": i + 1, "job": j, "block": format_job_block(i + 1, j)} for i, j in enumerate(DIGEST_JOBS)],
        "digest_messages": [
            {"jobs": DIGEST_JOBS, "label": "This run's matches", "messages": build_match_messages(DIGEST_JOBS, "This run's matches")},
            {"jobs": long_jobs, "label": "Today's matches", "messages": build_match_messages(long_jobs)},
        ],
        "summary_lines": [{"name": n, "stats": dict(s), "error": e, "line": _summary_line(n, s, e)} for n, s, e in (
            ("arbeitnow", Counter(listed=300, saved=4, known=20, german_filtered=3, too_old=2), None),
            ("ats", Counter(listed=50, would_save=2, cross_source_duplicate=1, not_germany=10), None),
            ("adzuna", Counter(), "skipped — no API key (ADZUNA_APP_ID / ADZUNA_APP_KEY)"),
            ("arbeitsagentur", Counter(), "HttpError: " + "x" * 200),
        )],
    }
    path = HERE / "pipeline_cases.json"
    path.write_text(json.dumps(cases, indent=1, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    print(f"wrote {path} ({sum(len(v) for v in cases.values())} cases)")


if __name__ == "__main__":
    main()
