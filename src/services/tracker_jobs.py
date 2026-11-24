"""
Run AI and Fetch details for a card already on the Tracker (matched_jobs).

Both keep the user's status, notes, timeline and recommended_by. They return
a result dict instead of raising, so the web layer can map it to HTTP codes.
"""
from __future__ import annotations

from core.jd_quality import assess_job_description
from core.manual_fields import keep_manual_description
from core.manual_log import (
    LINK_ONLY_TITLE_PREFIX,
    PLAYWRIGHT_UNAVAILABLE_MSG,
    apply_scraped_details,
    can_fetch_details,
    keep_manual_identity,
    link_needs_refetch,
)
from scrapers.job_page import scrape_job_page
from services.browser_session import first_cdp_page, load_playwright
from services.job_analysis import (
    apply_analysis_to_existing,
    enrich_job_and_evaluate,
    fill_identity_from_description,
)


def tracker_job_url(matched_doc: dict) -> str:
    """Canonical page URL for a Tracker row (link, or Indeed/LinkedIn from job_id)."""
    url = (matched_doc.get("link") or "").strip()
    job_id = matched_doc.get("job_id") or ""
    source = matched_doc.get("source") or ""
    if url.startswith("http"):
        return url
    # LinkedIn cards store relative hrefs ("/jobs/view/123/?eBP=…"); Chrome
    # cannot open those, so use the canonical URL.
    if source == "linkedin" and job_id:
        return f"https://www.linkedin.com/jobs/view/{job_id}/"
    if url.startswith("/"):
        host = "https://de.indeed.com" if source == "indeed" else "https://www.linkedin.com"
        return host + url
    if url:
        return url
    if source == "indeed" and job_id:
        return f"https://de.indeed.com/viewjob?jk={job_id}"
    return ""


def stored_jd_usable(matched_doc: dict | None) -> bool:
    """
    True when the Tracker card already holds a complete JD, so Run AI can
    skip Chrome and match the stored text. Same completeness check the
    matcher uses (length + title/company sanity); link-only stubs never count.
    """
    doc = matched_doc or {}
    title = str(doc.get("title") or "").strip()
    if not title or title.startswith(LINK_ONLY_TITLE_PREFIX):
        return False
    description = str(doc.get("description") or "")
    if not description.strip():
        return False
    if link_needs_refetch(doc):
        return False
    assessment = assess_job_description(
        description,
        title=title,
        company=str(doc.get("company") or ""),
        source=str(doc.get("source") or ""),
    )
    return bool(assessment.get("ok"))


def _scrape_with_chrome(url: str) -> tuple[dict | None, str | None]:
    """(job, None) with a non-empty JD, or (None, error message)."""
    try:
        sync_playwright = load_playwright()
    except ImportError:
        print(f"  ❌ {PLAYWRIGHT_UNAVAILABLE_MSG}")
        return None, PLAYWRIGHT_UNAVAILABLE_MSG

    with sync_playwright() as playwright:
        try:
            page = first_cdp_page(playwright)
        except Exception as e:
            print(f"  ❌ Cannot open Chrome ({e})")
            return None, f"Cannot open Chrome: {e}"

        job = scrape_job_page(page, url)
    if not job or not str(job.get("description") or "").strip():
        warn = (job or {}).get("scrape_warning") or "Scraping failed"
        print(f"  ❌ {warn}")
        return None, warn
    return job, None


def fetch_job_details_for_matched_job(matched_doc: dict) -> dict:
    """
    Scrape title/company/location/description for a Tracker job.

    Allowed for link-only / missing-details stubs (including jobs logged
    before recommended_by existed) and for agent-tagged cards. Does not run
    AI matching. Does not overwrite status, applied_at, timeline, notes, or
    recommended_by.
    """
    if not can_fetch_details(matched_doc):
        return {"ok": False, "error": "This card already has job details"}

    url = tracker_job_url(matched_doc)
    if not url:
        print("  ❌ No link on this Tracker card")
        return {"ok": False, "error": "No job link"}

    print(f"\n📥 Fetch details: {matched_doc.get('title') or matched_doc.get('job_id')}")
    print(f"  → {url}")

    job, error = _scrape_with_chrome(url)
    if error:
        return {"ok": False, "error": error}

    keep_manual_identity(job, matched_doc)
    keep_manual_description(job, matched_doc)
    fill_identity_from_description(job)
    if not job.get("title"):
        job["title"] = matched_doc.get("title") or ""
    # Stay on this Tracker row even if the (replaced) page hashes to a new id.
    job["job_id"] = matched_doc.get("job_id") or job.get("job_id")
    job["source"] = matched_doc.get("source") or job.get("source")
    if not str(job.get("link") or "").startswith("http"):
        job["link"] = url

    saved = apply_scraped_details(job)
    if not saved.get("ok"):
        return {"ok": False, "error": saved.get("error") or "DB update failed"}

    print("  ✅ Job details saved (no AI)")
    return {
        "ok": True,
        "error": None,
        "title": job.get("title", ""),
        "company": job.get("company", ""),
        "location": job.get("location", ""),
    }


def _job_from_tracker_doc(matched_doc: dict, url: str) -> dict:
    """Job dict for evaluate + apply_analysis_to_existing from a stored row."""
    return {
        "job_id": matched_doc.get("job_id"),
        "source": matched_doc.get("source"),
        "link": url,
        "title": matched_doc.get("title") or "",
        "company": matched_doc.get("company") or "",
        "location": matched_doc.get("location") or "",
        "description": matched_doc.get("description") or "",
        "applicants": matched_doc.get("applicants") or "",
    }


def _evaluate_and_save(
    job: dict,
    matched_doc: dict,
    user_profile: str,
    rules: str,
    *,
    used_stored_jd: bool,
) -> dict:
    keep_manual_identity(job, matched_doc)
    keep_manual_description(job, matched_doc)
    analysis = enrich_job_and_evaluate(job, user_profile, rules)
    keep_manual_identity(job, matched_doc)
    keep_manual_description(job, matched_doc)
    if not analysis:
        print("  ❌ No description — cannot run AI")
        return {"ok": False, "error": "Empty description after scrape", "match_score": None}

    if not apply_analysis_to_existing(job, analysis):
        return {"ok": False, "error": "DB update failed", "match_score": None}

    gate = analysis.get("match_gate") or ""
    if gate and gate != "scored":
        print(f"  ⛔ Stopped at {gate} gate — AI scoring was not run")
    else:
        print("  ✅ AI analysis saved to Tracker")
    return {
        "ok": True,
        "error": None,
        "match_score": analysis.get("match_score"),
        "match_gate": gate,
        "gate_reason": analysis.get("disqualification_reason") or "",
        "used_stored_jd": used_stored_jd,
        "title": job.get("title", ""),
        "company": job.get("company", ""),
    }


def run_ai_on_matched_job(matched_doc: dict) -> dict:
    """
    Run AI matching for an existing Tracker row and patch it (matched_jobs
    + jobs) without wiping notes/timeline.

    A complete stored JD is matched directly (no Chrome). Otherwise the job
    link is opened in debug Chrome and the JD is scraped first.

    Returns {"ok": bool, "error": str|None, "match_score": ..., "used_stored_jd": bool}.
    """
    url = tracker_job_url(matched_doc)
    if not url:
        print("  ❌ No link on this Tracker card")
        return {"ok": False, "error": "No job link", "match_score": None}

    print(f"\n🤖 Run AI for Tracker job: {matched_doc.get('title') or matched_doc.get('job_id')}")
    print(f"  → {url}")

    try:
        from matching.ai_matcher import load_matching_rules, load_user_profile
    except ImportError as e:
        print(f"  ❌ AI matching is unavailable ({e})")
        return {"ok": False, "error": f"AI matching unavailable: {e}", "match_score": None}

    user_profile = load_user_profile()
    if not user_profile:
        print("❌ No user profile found. Create docs/user_profile.md first.")
        return {"ok": False, "error": "Missing user profile", "match_score": None}

    rules = load_matching_rules()

    if stored_jd_usable(matched_doc):
        chars = len(str(matched_doc.get("description") or ""))
        print(f"  📄 Using stored JD ({chars} chars) — skip Chrome")
        job = _job_from_tracker_doc(matched_doc, url)
        return _evaluate_and_save(job, matched_doc, user_profile, rules, used_stored_jd=True)

    job, error = _scrape_with_chrome(url)
    if error:
        return {"ok": False, "error": error, "match_score": None}
    return _evaluate_and_save(job, matched_doc, user_profile, rules, used_stored_jd=False)
