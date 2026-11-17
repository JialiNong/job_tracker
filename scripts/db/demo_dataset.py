"""
Synthetic Tracker dataset for README / GIF screenshots.

Fictional companies and postings only — never copy production. Browser-scraper
origin (`pipeline`) is omitted on purpose; rows come from API sources, Log Job,
and agent pushes. Daily `scraper_stats` are generated so Overview's heatmap and
pipeline rail have volume (API ingest uses the same counters).
"""
from __future__ import annotations

import random
from collections import defaultdict
from datetime import datetime, timedelta

from core.job_origin import ORIGIN_AGENT, ORIGIN_API, ORIGIN_MANUAL
from core.job_url import posting_key_fields

DEMO_TAG = "demo_seed"

# Weighted Germany + Remote labels for applied jobs (each city needs 2+
# applications or Overview hides the bubble).
APPLIED_LOCATION_WEIGHTS = (
    ("Berlin, Germany", 24),
    ("Munich, Germany", 16),
    ("Remote, Germany", 14),
    ("Hamburg, Germany", 12),
    ("Leipzig, Germany", 10),
    ("Cologne, Germany", 8),
    ("Frankfurt, Germany", 7),
    ("Stuttgart, Germany", 6),
    ("Dresden, Germany", 5),
    ("Düsseldorf, Germany", 4),
    ("Potsdam, Germany", 3),
    ("Heidelberg, Germany", 3),
    ("Bonn, Germany", 3),
    ("Karlsruhe, Germany", 2),
    ("Mannheim, Germany", 2),
    ("Remote", 6),
    ("Amsterdam, Netherlands", 4),
)

COMPANIES = (
    "Northbeam", "Lumen Labs", "Paperkite", "Rivermark", "Softgrove",
    "Brightline", "Oak Pixel", "Fieldnote", "Copperline", "Hearthware",
    "Nimbus Guild", "Tidepool", "Glasswing", "Maplestack", "Ironleaf",
    "Quiet Harbor", "Voltshift", "Cloudloom", "Redcedar", "Pinecast",
    "Harborlight", "Driftwood", "Silverthread", "Bluekiln", "Fernpath",
    "Stoneferry", "Amberyard", "Lowland", "Arcpress", "Mothlight",
    "Yardline", "Cinderwell", "Paleoak", "Windrow", "Larkspire",
    "Hollowmere", "Eastwharf", "Sablekit", "Kite Mill", "Bramble Bit",
)

# Repeat so company-history pills show on Tracker cards.
REPEAT_COMPANIES = ("Northbeam", "Lumen Labs", "Paperkite", "Rivermark")

TITLES = (
    "Frontend Engineer",
    "Full-Stack Engineer",
    "Product Engineer",
    "Software Engineer",
    "Frontend Developer",
    "Fullstack Engineer",
    "Product Engineer, Growth",
    "Software Engineer, Web",
    "Frontend Engineer (TypeScript)",
    "Full-Stack Engineer, Platform",
)

PENDING_LOCATIONS = (
    "Berlin, Germany", "Munich, Germany", "Hamburg, Germany",
    "Leipzig, Germany", "Remote, Germany", "Cologne, Germany",
    "Frankfurt, Germany", "Stuttgart, Germany",
)

API_SOURCES = ("ats", "arbeitnow", "arbeitsagentur", "adzuna")
ATS_PROVIDERS = ("greenhouse", "lever", "ashby", "personio", "recruitee", "workable")
AGENTS = ("cursor", "claude", "gemini")

JD = (
    "We are a product team in Germany looking for an engineer who writes "
    "TypeScript, cares about UI, and ships with designers. You will work on "
    "our web app, shape APIs in Node.js, and improve how customers move "
    "through the product. We interview in English. "
) * 6

MATCH_REASONS = (
    "Business: B2B SaaS used by in-house product teams",
    "Customers/markets: Germany and the EU",
    "Stack: TypeScript, React, Node.js",
    "Score: frontend + product-engineer titles",
)


def _dt(day: datetime, hour: int = 10, minute: int = 0) -> datetime:
    return day.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _on_weekday(dt: datetime) -> datetime:
    """Shift Saturday/Sunday back to Friday so activity looks like weekdays."""
    while dt.weekday() >= 5:
        dt -= timedelta(days=1)
    return dt


def _next_weekday(dt: datetime) -> datetime:
    while dt.weekday() >= 5:
        dt += timedelta(days=1)
    return dt


def _add_days(start: datetime, days: int, hour: int | None = None) -> datetime:
    later = start + timedelta(days=days)
    if hour is None:
        return later
    return _dt(later, hour=hour)


def _not_after(value: datetime, limit: datetime) -> datetime:
    return value if value <= limit else limit


def _steps(*pairs) -> list[dict]:
    return [{"step": step, "at": at} for step, at in pairs]


def _expand_locations() -> list[str]:
    out = []
    for name, count in APPLIED_LOCATION_WEIGHTS:
        out.extend([name] * count)
    return out


def _source_bundle(index: int, origin: str) -> dict:
    """Pick source + URL fields. LinkedIn/Indeed only on manual/agent rows."""
    if origin == ORIGIN_API:
        source = API_SOURCES[index % len(API_SOURCES)]
        if source == "ats":
            provider = ATS_PROVIDERS[index % len(ATS_PROVIDERS)]
            slug = f"demo-{COMPANIES[index % len(COMPANIES)].lower().replace(' ', '')}"
            job_id = f"ats-{index:04d}"
            link = f"https://boards.greenhouse.io/{slug}/jobs/{10000 + index}"
            extra = {"ats_provider": provider, "ats_slug": slug}
        elif source == "arbeitnow":
            job_id = f"arbeitnow-{index:04d}"
            link = f"https://www.arbeitnow.com/jobs/demo-{index:04d}"
            extra = {}
        elif source == "arbeitsagentur":
            job_id = f"ba-{index:04d}"
            link = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{index:08d}"
            extra = {}
        else:
            job_id = f"adzuna-{index:04d}"
            link = f"https://www.adzuna.de/details/{2000000 + index}"
            extra = {}
        return {"source": source, "job_id": job_id, "link": link, **extra}

    if index % 5 == 0:
        job_id = f"{index:016x}"[-16:]
        link = f"https://de.indeed.com/viewjob?jk={job_id}"
        return {"source": "indeed", "job_id": job_id, "link": link}

    job_id = str(8800000000 + index)
    link = f"https://www.linkedin.com/jobs/view/{job_id}/"
    return {"source": "linkedin", "job_id": job_id, "link": link}


def _origin_for(index: int, applied: bool) -> str:
    """API-heavy mix; LinkedIn/Indeed weekly bars come from manual + agent."""
    bucket = index % 10
    if bucket < 5:
        return ORIGIN_API
    if bucket < 8:
        return ORIGIN_MANUAL
    return ORIGIN_AGENT if applied or bucket == 9 else ORIGIN_MANUAL


def _base_job(index: int, today: datetime, *, origin: str, location: str,
              company: str, title: str, matched_at: datetime) -> dict:
    bundle = _source_bundle(index, origin)
    rec = AGENTS[index % len(AGENTS)] if origin == ORIGIN_AGENT else ""
    score = round(7.2 + (index % 23) * 0.1, 1)
    if score > 9.4:
        score = 9.4
    doc = {
        "title": title,
        "company": company,
        "location": location,
        "match_score": score,
        "match_gate": "scored",
        "summary": f"{title} at {company}: TypeScript web product role in Germany.",
        "match_reasons": list(MATCH_REASONS),
        "red_flags": [],
        "disqualification_reason": "",
        "description": JD,
        "status": "pending",
        "matched_at": matched_at,
        "applied_at": None,
        "application_timeline": [],
        "notes": "",
        "application_qa": [],
        "highlights": ["Leipzig"] if "Leipzig" in location else [],
        "origin": origin,
        "recommended_by": rec,
        "recommend_reason": "Strong TypeScript product-engineer fit." if rec else "",
        "applicants": f"{18 + (index % 90)} applicants" if bundle["source"] == "linkedin" else "",
        "updated_at": matched_at,
        "demo": DEMO_TAG,
        **bundle,
        **posting_key_fields(bundle["link"]),
    }
    if origin in (ORIGIN_MANUAL, ORIGIN_AGENT):
        doc["created_at"] = matched_at
    if "Chinese" in title or index % 17 == 0:
        highlights = list(doc["highlights"])
        if "Chinese+" not in highlights:
            highlights.append("Chinese+")
        doc["highlights"] = highlights
    return doc


def _apply(job: dict, applied: datetime, status: str, steps: list[dict],
           extra: dict | None = None) -> dict:
    job["applied_at"] = applied
    job["status"] = status
    job["application_timeline"] = steps
    job["updated_at"] = steps[-1]["at"] if steps else applied
    if job.get("source") == "linkedin":
        digits = "".join(ch for ch in str(job.get("job_id") or "0") if ch.isdigit())
        job["applicant_position"] = 8 + (int(digits or "0") % 40)
    if extra:
        job.update(extra)
    return job


def _weekday_slots(today: datetime, days: int, rng: random.Random) -> list[datetime]:
    """Dense weekday apply times so the heatmap and weekly bars fill."""
    slots = []
    start = today.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    cursor = start
    end = today.replace(hour=23, minute=59, second=59, microsecond=0)
    while cursor <= end:
        weekday = cursor.weekday()
        if weekday >= 5:
            n = 0
        elif weekday == 0:
            n = rng.randint(2, 4)
        else:
            n = rng.randint(1, 4)
        hours = [9, 10, 11, 14, 16, 18]
        rng.shuffle(hours)
        for i in range(n):
            slots.append(_dt(cursor, hour=hours[i % len(hours)], minute=rng.choice((0, 15, 30))))
        cursor += timedelta(days=1)
    rng.shuffle(slots)
    return slots


def _next_slot(slots: list[datetime], fallback: datetime) -> datetime:
    return slots.pop() if slots else fallback


def _scenarios(today: datetime, rng: random.Random) -> list[tuple]:
    """
    Named counts that cover every Tracker chip and Sankey sink.

    Each item is (count, kind) where kind is a string the builder understands.
    """
    # Slight jitter so screenshots do not look like round dozens.
    def n(base, spread=1):
        return max(1, base + rng.randint(-spread, spread))

    return [
        (n(24, 2), "pending"),
        (n(58, 2), "waiting"),
        (n(8, 1), "closed_no_reply"),
        (n(4, 1), "unsuitable_applied"),
        (n(6, 1), "screening"),
        (n(6, 1), "screening_done"),
        (n(24, 2), "rejected"),
        # ~10 journey tracks (invite / round / offer / cancelled-with-invite)
        (2, "awaiting"),
        (1, "round_1_upcoming"),
        (1, "round_1"),
        (1, "round_2"),
        (1, "cancelled"),
        (2, "offer"),
        (1, "rejected_invite"),
        (1, "rejected_1"),
        (n(3, 0), "reapplied_waiting"),
        (n(4, 1), "closed"),
        (n(3, 0), "prev_rejected"),
        (n(3, 0), "too_many_questions"),
        (n(3, 0), "repost"),
        (n(3, 0), "duplicate"),
    ]


def _build_timeline(kind: str, applied: datetime, today: datetime) -> tuple[str, list[dict], dict]:
    """Return (status, timeline, extra overlay fields)."""
    def past(days, hour=11):
        return _on_weekday(_not_after(_add_days(applied, days, hour=hour), today))

    extra = {}
    if kind == "waiting":
        return "applied", _steps(("applied", applied)), extra
    if kind == "closed_no_reply":
        extra = {"status": "closed_no_reply"}
        return "closed_no_reply", _steps(("applied", applied)), extra
    if kind == "unsuitable_applied":
        extra = {"status": "unsuitable", "notes": "Role shifted to a Java backend after I applied."}
        return "unsuitable", _steps(("applied", applied)), extra
    if kind == "screening":
        return "screening", _steps(("applied", applied), ("screening", past(5))), extra
    if kind == "screening_done":
        return "screening", _steps(
            ("applied", applied),
            ("screening", past(4)),
            ("screening_done", past(7, hour=16)),
        ), extra
    if kind == "rejected":
        return "rejected", _steps(("applied", applied), ("rejected", past(12, hour=9))), extra
    if kind == "awaiting":
        return "interview", _steps(("applied", applied), ("interview_invite", past(8))), extra
    if kind == "round_1_upcoming":
        future = _next_weekday(_add_days(today, 5, hour=10))
        return "interview", _steps(
            ("applied", applied),
            ("interview_invite", past(6)),
            ("interview_1", future),
        ), extra
    if kind == "round_1":
        return "interview", _steps(
            ("applied", applied),
            ("interview_invite", past(7)),
            ("interview_1", past(14, hour=15)),
        ), extra
    if kind == "round_2_upcoming":
        future = _next_weekday(_add_days(today, 4, hour=14))
        return "interview", _steps(
            ("applied", applied),
            ("interview_invite", past(6)),
            ("interview_1", past(12)),
            ("interview_2", future),
        ), extra
    if kind == "round_2":
        return "interview", _steps(
            ("applied", applied),
            ("interview_invite", past(5)),
            ("interview_1", past(11)),
            ("interview_2", past(18, hour=10)),
        ), extra
    if kind == "later_upcoming":
        future = _next_weekday(_add_days(today, 8, hour=11))
        return "interview", _steps(
            ("applied", applied),
            ("interview_invite", past(4)),
            ("interview_1", past(10)),
            ("interview_2", past(16)),
            ("interview_3", future),
        ), extra
    if kind == "later":
        return "interview", _steps(
            ("applied", applied),
            ("interview_invite", past(4)),
            ("interview_1", past(9)),
            ("interview_2", past(15)),
            ("interview_final", past(22, hour=13)),
        ), extra
    if kind == "rejected_invite":
        return "rejected", _steps(
            ("applied", applied),
            ("interview_invite", past(7)),
            ("rejected", past(16, hour=9)),
        ), extra
    if kind == "rejected_1":
        return "rejected", _steps(
            ("applied", applied),
            ("interview_invite", past(6)),
            ("interview_1", past(13)),
            ("rejected", past(20, hour=8)),
        ), extra
    if kind == "rejected_2":
        return "rejected", _steps(
            ("applied", applied),
            ("interview_invite", past(5)),
            ("interview_1", past(11)),
            ("interview_2", past(18)),
            ("rejected", past(25, hour=9)),
        ), extra
    if kind == "cancelled":
        return "interview_cancelled", _steps(
            ("applied", applied),
            ("interview_invite", past(6)),
            ("interview_cancelled", past(9, hour=17)),
        ), extra
    if kind == "offer":
        return "offer", _steps(
            ("applied", applied),
            ("interview_invite", past(5)),
            ("interview_1", past(12)),
            ("interview_2", past(19)),
            ("offer", past(26, hour=16)),
        ), extra
    if kind == "reapplied_waiting":
        re_at = past(21, hour=10)
        return "applied", _steps(("applied", applied), ("reapplied", re_at)), extra
    if kind == "reapplied_interview":
        re_at = past(18, hour=11)
        invite = _not_after(re_at + timedelta(days=6), today)
        return "interview", _steps(
            ("applied", applied),
            ("reapplied", re_at),
            ("interview_invite", invite),
        ), extra
    if kind == "closed":
        return "closed", [], extra
    if kind == "prev_rejected":
        return "prev_rejected", [], extra
    if kind == "too_many_questions":
        extra = {"notes": "Skipped: the form asked for a take-home plus 20 written answers."}
        return "too_many_questions", [], extra
    if kind == "repost":
        return "repost", [], extra
    if kind == "duplicate":
        extra = {"notes": "Same role already tracked from another board."}
        return "duplicate", [], extra
    return "pending", [], extra


def _company_title(index: int) -> tuple[str, str]:
    if index < len(REPEAT_COMPANIES) * 3:
        company = REPEAT_COMPANIES[index % len(REPEAT_COMPANIES)]
        title = TITLES[index % len(TITLES)]
        return company, title
    company = COMPANIES[index % len(COMPANIES)]
    title = TITLES[index % len(TITLES)]
    return company, title


def build_matched_jobs(today: datetime, rng: random.Random) -> list[dict]:
    slots = _weekday_slots(today, days=95, rng=rng)
    loc_cycle = _expand_locations()
    loc_i = 0
    jobs = []
    index = 0
    fallback_applied = today - timedelta(days=40)

    for count, kind in _scenarios(today, rng):
        for _ in range(count):
            origin = _origin_for(index, applied=kind not in (
                "pending", "closed", "prev_rejected", "too_many_questions",
                "repost", "duplicate",
            ))
            company, title = _company_title(index)
            if kind in ("pending", "closed", "prev_rejected", "too_many_questions",
                        "repost", "duplicate"):
                location = PENDING_LOCATIONS[index % len(PENDING_LOCATIONS)]
                matched_at = _on_weekday(
                    today - timedelta(days=rng.randint(0, 28), hours=rng.randint(0, 10))
                )
                job = _base_job(
                    index, today, origin=origin, location=location,
                    company=company, title=title, matched_at=matched_at,
                )
                status, steps, extra = _build_timeline(kind, matched_at, today)
                job["status"] = status
                if extra:
                    job.update(extra)
                jobs.append(job)
            else:
                applied = _on_weekday(
                    _next_slot(slots, fallback_applied - timedelta(days=index % 30))
                )
                # Leave room for a 26-day offer track before today.
                if kind == "offer" and applied > today - timedelta(days=28):
                    applied = _on_weekday(today - timedelta(days=30 + (index % 10)))
                elif kind.startswith("rejected_") or kind in ("later", "round_2"):
                    if applied > today - timedelta(days=26):
                        applied = _on_weekday(today - timedelta(days=28 + (index % 8)))
                location = loc_cycle[loc_i % len(loc_cycle)]
                loc_i += 1
                matched_at = _on_weekday(
                    applied - timedelta(days=rng.randint(1, 5), hours=rng.randint(1, 8))
                )
                job = _base_job(
                    index, today, origin=origin, location=location,
                    company=company, title=title, matched_at=matched_at,
                )
                status, steps, extra = _build_timeline(kind, applied, today)
                _apply(job, applied, status, steps, extra)
                if "Leipzig" in location and "Leipzig" not in job["highlights"]:
                    job["highlights"] = [*job["highlights"], "Leipzig"]
                jobs.append(job)
            index += 1
    return jobs


def build_unmatched_jobs(today: datetime, rng: random.Random) -> list[dict]:
    """Scored-below-threshold rows for /unmatched and heatmap agent reminders."""
    gates = (
        ("german", 3.0, "German required: “Business fluent German is a must.”"),
        ("stack", 5.2, "Required Java/Spring — not a JS web role."),
        ("leadership", 4.1, "Lead/staff scope: “lead a squad of 8 engineers.”"),
        ("not_web_dev", 4.8, "Mostly pre-sales demos and configuration."),
        ("backend_heavy", 6.1, "Backend-only Python/Go, no frontend."),
        ("scored", 6.6, "Close but below the 7.0 Tracker cut-off."),
        ("contract_or_location", 5.5, "On-site only, outside Germany."),
        ("too_many_years", 5.0, "Asks for 10+ years in the same stack."),
    )
    rows = []
    for i in range(48):
        gate, score, reason = gates[i % len(gates)]
        score = round(min(score + (i % 5) * 0.1, 6.8), 1)
        origin = ORIGIN_API if i % 3 else ORIGIN_MANUAL
        bundle = _source_bundle(8000 + i, ORIGIN_API if origin == ORIGIN_API else ORIGIN_MANUAL)
        matched_at = _on_weekday(
            today - timedelta(days=rng.randint(0, 90), hours=rng.randint(0, 12))
        )
        agent = ""
        agent_at = None
        if i % 6 == 0:
            agent = AGENTS[i % len(AGENTS)]
            agent_at = _on_weekday(
                today - timedelta(days=rng.randint(0, 40), hours=rng.randint(8, 18))
            )
        rows.append({
            "title": TITLES[i % len(TITLES)],
            "company": COMPANIES[-(i % 12) - 1],
            "location": PENDING_LOCATIONS[i % len(PENDING_LOCATIONS)],
            "description": JD,
            "match_score": score,
            "match_gate": gate,
            "matched_at": matched_at,
            "disqualification_reason": reason,
            "summary": reason,
            "match_reasons": [reason],
            "red_flags": [],
            "status": "new",
            "user_status": "watchlist" if i % 12 == 0 else "",
            "origin": origin,
            "agent_recommended_by": agent,
            "agent_recommend_reason": "Agent still liked the product team." if agent else "",
            "agent_recommended_at": agent_at,
            "applicants": "",
            "demo": DEMO_TAG,
            "created_at": matched_at,
            **bundle,
            **posting_key_fields(bundle["link"]),
        })
    return rows


def build_scraper_stats(today: datetime, rng: random.Random, days: int = 100) -> list[dict]:
    """Daily opened / not-in-English counters for the heatmap and pipeline rail."""
    docs = []
    clicked_total = 0
    german_total = 0
    title_filtered = 0
    start = today.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    cursor = start
    end = today.replace(hour=0, minute=0, second=0, microsecond=0)
    while cursor <= end:
        date = cursor.strftime("%Y-%m-%d")
        if cursor.weekday() >= 5:
            clicked = 0
            german = 0
            filtered = 0
        else:
            clicked = rng.randint(14, 46)
            german = int(round(clicked * rng.uniform(0.14, 0.30)))
            filtered = rng.randint(2, 12)
        clicked_total += clicked
        german_total += german
        title_filtered += filtered
        docs.append({
            "_id": f"daily_{date}",
            "date": date,
            "title_passed_clicked": clicked,
            "german_filtered": german,
            "ai_title_filtered": filtered,
            "updated_at": _dt(cursor, hour=21),
            "demo": DEMO_TAG,
        })
        cursor += timedelta(days=1)
    docs.append({
        "_id": "global",
        "title_passed_clicked": clicked_total,
        "german_filtered": german_total,
        "ai_title_filtered": title_filtered,
        "updated_at": today,
        "demo": DEMO_TAG,
    })
    return docs


def build_demo_dataset(today: datetime | None = None, seed: int = 17) -> dict:
    """
    Return collection name → documents.

    Collections: matched_jobs, jobs (unmatched only), scraper_stats.
    No timeout_jobs and no pipeline-origin rows.
    """
    today = today or datetime.now().replace(second=0, microsecond=0)
    rng = random.Random(seed)
    return {
        "matched_jobs": build_matched_jobs(today, rng),
        "jobs": build_unmatched_jobs(today, rng),
        "scraper_stats": build_scraper_stats(today, rng),
    }


def dataset_summary(data: dict) -> dict:
    """Counts used by the CLI printout and unit tests."""
    matched = data["matched_jobs"]
    by_status = defaultdict(int)
    by_origin = defaultdict(int)
    applied_n = 0
    for job in matched:
        by_status[job.get("status") or "pending"] += 1
        by_origin[job.get("origin") or ""] += 1
        if job.get("applied_at") or job.get("application_timeline"):
            applied_n += 1
            applied_n += sum(
                1 for item in job.get("application_timeline") or []
                if item.get("step") == "reapplied"
            )
    daily = [d for d in data["scraper_stats"] if str(d.get("_id", "")).startswith("daily_")]
    return {
        "matched_jobs": len(matched),
        "unmatched_jobs": len(data["jobs"]),
        "scraper_stats_days": len(daily),
        "applications": applied_n,
        "by_status": dict(by_status),
        "by_origin": dict(by_origin),
        "pipeline_origin": by_origin.get("pipeline", 0),
    }
