#!/usr/bin/env python3
"""Write tests/contract/fixture.json: the portable dataset behind the API
contract snapshots.

Synthetic on purpose (the repo is public): no real companies, notes or
answers. The shapes copy what the pipeline and the Tracker really store,
so every endpoint has something to show: every status and timeline step,
several sources and origins, highlights, Q&A, company history, AI labels,
unmatched jobs, timeouts, and daily scraper counters.

Format: Mongo Extended JSON ({"$oid": ...}, {"$date": ...}). Dates are
naive wall-clock times, like the ones the Python code stores today. The
clock is pinned to FIXTURE_NOW, so nothing here is relative to the day the
tests run. A Postgres loader for the new stack reads this same file.

    python3 tests/contract/build_fixture.py      # rewrite fixture.json
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from core.manual_log import stub_ai_pending_analysis
from matching.evaluator import company_key

HERE = Path(__file__).resolve().parent
FIXTURE_NOW = datetime(2026, 11, 13, 12, 0)  # a Friday

_counter = 0


def oid() -> dict:
    global _counter
    _counter += 1
    return {"$oid": f"64a0000000000000000{_counter:05x}"[-24:]}


def at(days_ago: float, hour: int = 10, minute: int = 0) -> dict:
    when = (FIXTURE_NOW - timedelta(days=days_ago)).replace(hour=hour, minute=minute, second=0)
    return {"$date": when.strftime("%Y-%m-%dT%H:%M:%SZ")}


def profile_for(company: str) -> dict:
    """The company research the pipeline caches; jobs carry the same text (as on Atlas)."""
    return {
        "business": f"{company} sells a B2B SaaS tool for small logistics companies.",
        "product_type": "b2b_saas", "vertical": "Logistics software",
        "markets": "europe", "markets_detail": "Customers in Germany and Austria.",
    }


def ai_fields(score: float, frameworks: str, company: str, role: str = "fullstack_balanced") -> dict:
    return {
        "match_score": score,
        "recommendation": "Yes" if score >= 7 else ("Maybe" if score >= 5 else "No"),
        "disqualification_reason": "" if score >= 7 else "Backend language other than JavaScript required",
        "match_reasons": [f"Hands-on {frameworks} experience matches the role"],
        "missing_requirements": [] if score >= 8 else ["Production experience with Kubernetes"],
        "red_flags": [],
        "nice_to_have_matches": ["Docker (listed as nice to have)"],
        "summary": f"{role.replace('_', ' ').capitalize()} role on a {frameworks} stack.",
        "what_youll_do": {"matched": ["Build product features end to end"], "unmatched": []},
        "what_theyre_looking_for": {
            "matched": [f"3+ years with {frameworks}"],
            "unmatched": [] if score >= 8 else ["Kubernetes in production"],
        },
        "special_match": False,
        "special_match_reasons": [],
        "match_gate": "scored",
        "job_labels": {
            "description_usable": True, "hard_fail": False, "hard_fail_kind": "none",
            "hard_fail_evidence": "", "german_required": False, "german_evidence": "",
            "role_type": role, "stack_fit": "strong" if score >= 7 else "weak",
            "seniority": "mid", "backend_language_ask": "js_only" if score >= 7 else "other_required",
            "ai_product_work": False, "english_team": "true", "stack": frameworks,
            "summary": f"Product team working with {frameworks}.",
        },
        "company_profile": profile_for(company),
    }


def description(frameworks: str) -> str:
    return (
        "About the role. You will join a small product team and ship features end to end. "
        f"Our stack: {frameworks}. We value ownership, clear writing and pragmatic testing. "
        "English is our working language. Hybrid work from our office, two days a week. "
    ) * 3


def matched(n: int, title: str, company: str, frameworks: str, *, score: float = 8.0,
            status: str = "pending", source: str = "linkedin", origin: str = "pipeline",
            location: str = "Berlin, Germany", matched_days: float = 20,
            applied_days: float | None = None, steps=(), **extra) -> dict:
    job_id = str(4100000000 + n) if source in ("linkedin", "indeed") else f"{source}-{n:04d}"
    link = {
        "linkedin": f"https://www.linkedin.com/jobs/view/{job_id}/",
        "indeed": f"https://de.indeed.com/viewjob?jk={n:016x}",
    }.get(source, f"https://jobs.example.com/{source}/{n}")
    doc = {
        "_id": oid(), "title": title, "company": company, "location": location,
        "link": link, "job_id": job_id, "source": source, "origin": origin,
        "description": description(frameworks), "applicants": f"{20 + n * 7} applicants",
        "status": status, "matched_at": at(matched_days, 9, n % 60),
        "updated_at": at(min(matched_days, applied_days or matched_days), 11),
        "notes": "", "application_qa": [], "highlights": [],
        "applied_at": at(applied_days) if applied_days is not None else None,
        "application_timeline": [
            {"step": step, "at": at(days, hour)} for step, days, hour in steps
        ],
    }
    doc.update(ai_fields(score, frameworks, company))
    doc.update(extra)
    return doc


def build() -> dict:
    mj = []
    add = mj.append
    # Not applied yet
    add(matched(1, "Frontend Engineer", "Northwind Labs", "React, TypeScript, Next.js", score=8.5, matched_days=0.2))
    add(matched(2, "Full Stack Developer", "Bluefin GmbH", "Vue, Nuxt, Node.js, PostgreSQL", score=7.5,
                source="indeed", location="Hamburg, Germany", matched_days=1, highlights=["Hamburg"]))
    add(matched(3, "Senior Software Engineer", "Kestrel AG", "Angular, Spring Boot, Java", score=7.0,
                source="arbeitsagentur", origin="api", location="München", matched_days=2))
    add(matched(4, "Product Engineer", "Larkspur", "React, NestJS, GraphQL", score=9.0, source="ats",
                origin="agent", location="Remote (Germany)", matched_days=3, recommended_by="cursor",
                recommend_reason="Fullstack TypeScript with product focus"))
    # Applied, waiting
    add(matched(5, "Frontend Developer", "Ostara Health", "React, Redux, Node.js", status="applied",
                applied_days=4, steps=[("applied", 4, 10)], applicant_position=12, posted_at=at(6)))
    add(matched(6, "Software Engineer (Frontend)", "Quill & Co", "Vue, Laravel, PHP", status="applied",
                source="indeed", location="Köln, Germany", applied_days=9, steps=[("applied", 9, 15)],
                notes="Referral from a former colleague."))
    add(matched(7, "Full Stack Engineer", "Northwind Labs", "React, Node.js, Express, MongoDB", status="applied",
                applied_days=40, matched_days=41, steps=[("applied", 40, 9)],
                application_qa=[{"question": "Why this role?", "answer": "The product and the TypeScript stack."}]))
    add(matched(8, "React Developer", "Pinecrest", "React, React Native, Expo", status="applied",
                source="arbeitnow", origin="api", location="Remote (Europe)", applied_days=55, matched_days=56,
                steps=[("applied", 55, 14)]))
    # Screening / interview / offer / cancelled
    add(matched(9, "Frontend Engineer", "Halcyon Pay", "React, TypeScript, Django", status="screening",
                applied_days=30, matched_days=31,
                steps=[("applied", 30, 10), ("screening", 25, 16), ("screening_done", 22, 11)]))
    add(matched(10, "Full Stack Engineer", "Tidewater", "Next.js, tRPC, Prisma, PostgreSQL", status="interview",
                applied_days=35, matched_days=36,
                steps=[("applied", 35, 10), ("interview_invite", 28, 9), ("interview_1", 24, 14), ("interview_2", 18, 15)]))
    add(matched(11, "Software Engineer", "Marlow Systems", "Angular, .NET, C#", status="interview_cancelled",
                applied_days=45, matched_days=46,
                steps=[("applied", 45, 10), ("interview_invite", 38, 9), ("interview_cancelled", 36, 12)]))
    add(matched(12, "Frontend Lead", "Saffron Studio", "React, Next.js, Node.js", score=9.5, status="offer",
                applied_days=60, matched_days=61,
                steps=[("applied", 60, 10), ("interview_invite", 52, 9), ("interview_1", 48, 11),
                       ("interview_final", 40, 15), ("offer", 33, 17)], highlights=["Dream team"]))
    # Rejected at different points
    add(matched(13, "Full Stack Developer", "Granite Cloud", "React, Spring Boot, Kotlin", status="rejected",
                applied_days=50, matched_days=51, steps=[("applied", 50, 10), ("rejected", 44, 18)],
                notes="Wanted Java seniority."))
    add(matched(14, "Frontend Engineer", "Ember Analytics", "Vue, Django, Python", status="rejected",
                source="indeed", applied_days=65, matched_days=66,
                steps=[("applied", 65, 10), ("interview_invite", 58, 9), ("interview_1", 55, 15), ("rejected", 50, 18)]))
    add(matched(15, "Web Developer", "Kestrel AG", "Angular, Node.js", status="rejected", applied_days=80,
                matched_days=81, location="München", steps=[("applied", 80, 10), ("rejected", 70, 9)]))
    add(matched(16, "Software Engineer", "Juniper Mobility", "React or Vue, Node.js or Spring Boot", status="rejected",
                applied_days=70, matched_days=71, steps=[("applied", 70, 10), ("rejected", 62, 9)]))
    # Reapplied after a rejection
    add(matched(17, "Frontend Engineer", "Ostara Health", "React, TypeScript", status="applied",
                applied_days=90, matched_days=91,
                steps=[("applied", 90, 10), ("rejected", 80, 9), ("reapplied", 10, 11)]))
    # Side statuses
    add(matched(18, "Backend Engineer", "Granite Cloud", "Java, Spring Boot", score=7.0, status="unsuitable", matched_days=25))
    add(matched(19, "Frontend Developer", "Copperleaf", "React, Tailwind", status="closed", matched_days=27))
    add(matched(20, "Full Stack Engineer", "Bluefin GmbH", "Vue, Node.js", status="closed_no_reply",
                applied_days=75, matched_days=76, steps=[("applied", 75, 10)], location="Hamburg, Germany"))
    add(matched(21, "Frontend Engineer", "Granite Cloud", "React, Spring Boot", status="prev_rejected", matched_days=8))
    add(matched(22, "React Engineer", "Wrenfield", "React, FastAPI, Python", status="too_many_questions", matched_days=6))
    add(matched(23, "Frontend Engineer", "Northwind Labs", "React, TypeScript, Next.js", status="repost", matched_days=5))
    add(matched(24, "Frontend Engineer", "Larkspur", "React, NestJS", status="duplicate", matched_days=4, source="indeed"))
    # Manually logged, link only (AI still pending)
    link_only = matched(25, "Software Engineer", "Halden Robotics", "", status="applied", source="manual",
                        origin="manual", applied_days=2, matched_days=2, steps=[("applied", 2, 20)],
                        manually_logged=True, ai_pending=True, description="")
    link_only.update(stub_ai_pending_analysis())  # what Save Link Only stores
    add(link_only)

    jobs = []
    for m in mj:
        jobs.append({
            "_id": oid(), "job_id": m["job_id"], "source": m["source"], "title": m["title"],
            "company": m["company"], "location": m["location"], "link": m["link"],
            "description": m["description"], "created_at": m["matched_at"], "status": "matched",
        })
    # Scored below the threshold: the Unmatched page
    for n, (title, company, score, gate, user_status) in enumerate([
        ("Java Developer", "Umbra Insurance", 3.0, "scored", None),
        ("Backend Engineer (Go)", "Fennel Logistics", 5.5, "scored", "watchlist"),
        ("Frontend Developer (German C1)", "Stadtwerke Nord", 2.0, "hard_fail", None),
        ("Full Stack Engineer (PHP)", "Corvid Media", 6.5, "scored", None),
    ], start=101):
        doc = {
            "_id": oid(), "job_id": str(4100000000 + n), "source": "linkedin", "title": title,
            "company": company, "location": "Berlin, Germany",
            "link": f"https://www.linkedin.com/jobs/view/{4100000000 + n}/",
            "description": description("Java, Spring, PostgreSQL"), "created_at": at(n - 95, 8),
            "matched_at": at(n - 95, 8, 30), "status": "unmatched", "applicants": "80 applicants",
        }
        doc.update(ai_fields(score, "Java, Spring, PostgreSQL", company, role="backend_heavy"))
        doc["match_gate"] = gate
        if user_status:
            doc["user_status"] = user_status
        jobs.append(doc)
    # Scraped but never scored (dedup only)
    jobs.append({"_id": oid(), "job_id": "4100000200", "source": "linkedin", "title": "Werkstudent IT",
                 "company": "Lindgrün", "created_at": at(1, 7)})

    timeouts = [
        {"_id": oid(), "job_id": "4300000001", "source": "linkedin", "title": "Frontend Engineer",
         "company": "Hooli Berlin", "location": "Berlin, Germany", "keyword": "frontend",
         "link": "https://www.linkedin.com/jobs/view/4300000001/", "reason": "detail_timeout",
         "review_status": "open", "timeout_count": 2, "created_at": at(3, 6), "updated_at": at(1, 6)},
        {"_id": oid(), "job_id": "4300000002", "source": "linkedin", "title": "React Developer",
         "company": "Starling Apps", "location": "Remote", "keyword": "react",
         "link": "https://www.linkedin.com/jobs/view/4300000002/", "reason": "detail_timeout",
         "review_status": "dismissed", "timeout_count": 1, "created_at": at(12, 6), "updated_at": at(11, 6)},
    ]

    stats = [{"_id": "global", "title_passed_clicked": 640, "german_filtered": 410,
              "ai_title_filtered": 380, "detail_timeout": 12, "updated_at": at(0, 8)}]
    for days, clicked, german in ((0, 22, 14), (1, 35, 20), (2, 18, 9), (5, 40, 25), (9, 28, 17)):
        d = (FIXTURE_NOW - timedelta(days=days)).strftime("%Y-%m-%d")
        stats.append({"_id": f"daily_{d}", "date": d, "title_passed_clicked": clicked,
                      "german_filtered": german, "ai_title_filtered": clicked // 2, "updated_at": at(days, 20)})

    # One cached profile per analysed company, keyed like matching.evaluator.company_key
    profiles, seen = [], set()
    for doc in [*mj, *jobs]:
        key = company_key(doc.get("company"))
        if not key or key in seen or not doc.get("company_profile"):
            continue
        seen.add(key)
        profiles.append({"_id": key, **profile_for(doc["company"]), "is_recruiter_for_other_company": False,
                         "sources": [], "cached_at": doc["matched_at"]})

    return {
        "now": FIXTURE_NOW.strftime("%Y-%m-%dT%H:%M:%S"),
        "collections": {
            "matched_jobs": mj, "jobs": jobs, "timeout_jobs": timeouts,
            "scraper_stats": stats, "company_profiles": profiles,
        },
    }


def main():
    path = HERE / "fixture.json"
    path.write_text(json.dumps(build(), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(HERE.parents[1])}")


if __name__ == "__main__":
    main()
