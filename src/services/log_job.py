"""
Log Job: scrape, AI-match and save pasted job URLs to the Tracker.

Every non-blank URL ends up in exactly one of the returned lists — ok /
skipped / failed — so callers count results without parsing printed output. When
Playwright is missing (Render) or the run crashes, the remaining URLs fall
back to a link-only save.
"""
from __future__ import annotations

from datetime import datetime

from core.browser import pause
from core.job_url import (
    detect_source,
    job_stub_from_url,
    normalize_pasted_job_url,
    resolve_job_id,
)
from core.manual_log import (
    apply_identity_to_job,
    apply_scraped_details,
    get_tracker_job,
    handle_existing_tracker,
    keep_manual_identity,
    mark_tracker_job_applied,
    normalize_manual_identity,
    normalize_recommended_by,
    reuse_saved_posting,
    save_job_record,
    save_link_only_urls,
    stub_ai_pending_analysis,
    tracker_needs_scrape,
)
from scrapers.job_page import scrape_job_page
from services.browser_session import first_cdp_page, load_playwright
from services.job_analysis import (
    apply_analysis_to_existing,
    enrich_job_and_evaluate,
    fill_identity_from_description,
)


def empty_results() -> dict:
    return {"ok": [], "failed": [], "skipped": []}


def merge_results(into: dict, extra: dict | None) -> dict:
    for key in ("ok", "failed", "skipped"):
        into[key].extend((extra or {}).get(key) or [])
    return into


def print_results(results: dict) -> None:
    print(f"\n{'='*60}")
    print(f"✅ Success : {len(results['ok'])}")
    print(f"⏭️  Skipped : {len(results['skipped'])} (already on Tracker)")
    print(f"❌ Failed  : {len(results['failed'])}")
    for u in results["skipped"] + results["failed"]:
        print(f"   • {u}")


def _refresh_existing_card(
    job, existing, *, page, job_id, source, status, applied_date, rec, identity,
    user_profile, rules,
) -> bool:
    """Refresh a link-only / AI-pending Tracker card in place (never force_save:
    that would wipe notes / timeline). Returns True when saved."""
    if not job or not str(job.get("description") or "").strip():
        warn = (job or {}).get("scrape_warning") or (
            "Scraping failed" if page is not None else "Chrome was not available"
        )
        print(f"  ❌ {warn} — existing Tracker card left unchanged")
        return False
    if rec:
        job["recommended_by"] = rec
    keep_manual_identity(job, existing)
    apply_identity_to_job(job, identity)
    if status == "applied":
        mark_tracker_job_applied(job_id, source, applied_date, recommended_by=rec)
    analysis = enrich_job_and_evaluate(job, user_profile, rules) if user_profile else None
    if analysis:
        if not apply_analysis_to_existing(job, analysis):
            return False
        print("  ✅ AI analysis saved to existing Tracker card")
        return True
    fill_identity_from_description(job)
    if not apply_scraped_details(job).get("ok"):
        return False
    print("  ✅ Job details saved on existing Tracker card (AI pending)")
    return True


def _save_new_card(
    job, *, url, page, job_id, source, status, applied_date, rec, identity,
    user_profile, rules,
) -> bool:
    """Save a new Tracker card: scraped + AI when possible, else an AI-pending stub."""
    if not job:
        warn = "Scraping failed" if page is not None else "Chrome was not available"
        job = job_stub_from_url(url, scrape_warning=warn)
        if job:
            job["job_id"], job["source"] = job_id, source
    if not job:
        print("  ❌ Cannot build a job record from this URL")
        return False

    warning = (job.get("scrape_warning") or "").strip()
    analysis = None
    ai_pending = False
    if job.get("description") and user_profile:
        analysis = enrich_job_and_evaluate(job, user_profile, rules)
    if not analysis:
        analysis = stub_ai_pending_analysis()
        ai_pending = True
        if warning:
            print(f"  ⚠️  {warning} — saving with URL and parsed fields (AI pending)")
        elif not job.get("description"):
            print("  ⚠️  No description — saving link only (AI pending)")
        else:
            print("  ⚠️  No user profile — saving without AI (AI pending)")

    if rec:
        job["recommended_by"] = rec
    apply_identity_to_job(job, identity)
    return save_job_record(
        job, analysis, status, applied_date,
        ai_pending=ai_pending, extra="AI pending" if ai_pending else "",
    )


def process_urls(
    urls: list[str],
    applied_date: datetime = None,
    status: str = "pending",
    recommended_by=None,
    identity=None,
    title=None,
    company=None,
    location=None,
) -> dict:
    """
    Scrape, AI-match, and save each URL to the tracker.

    Args:
        urls: LinkedIn / Indeed / any company career-page job URLs
        applied_date: Date the user applied (only used when status=applied)
        status: "pending" (Not Applied, default) or "applied"
        recommended_by: Optional Log Job agent tag (claude/cursor/gemini/gpt)
        identity / title / company / location: optional user-typed card fields

    Returns {"ok": [...], "skipped": [...], "failed": [...]} URL lists.
    """
    if status not in ("pending", "applied"):
        status = "pending"
    rec = normalize_recommended_by(recommended_by)
    identity = identity or normalize_manual_identity(title, company, location)
    link_only_kwargs = dict(
        applied_date=applied_date, status=status, recommended_by=rec, identity=identity,
    )

    if not urls:
        print("No URLs provided.")
        return empty_results()

    status_label = "applied" if status == "applied" else "pending (Not Applied)"
    print(f"\n🔗 Processing {len(urls)} URL(s) as {status_label}…")

    try:
        sync_playwright = load_playwright()
        from matching.ai_matcher import load_matching_rules, load_user_profile
    except ImportError as e:
        print(f"⚠️  Scrape is unavailable ({e}). Saving link(s) only.")
        return save_link_only_urls(urls, **link_only_kwargs)

    user_profile = load_user_profile()
    if not user_profile:
        print(
            "⚠️  No user profile found (docs/user_profile.md). "
            "Will save links without AI scoring."
        )
    rules = load_matching_rules()

    results = empty_results()

    try:
        with sync_playwright() as playwright:
            try:
                page = first_cdp_page(playwright)
            except Exception as e:
                print(f"❌ Cannot open Chrome ({e}). Saving URL(s) without scrape.")
                page = None

            for i, raw in enumerate(urls, 1):
                url = normalize_pasted_job_url(raw)
                if not url:
                    continue
                print(f"\n{'='*60}")
                print(f"[{i}/{len(urls)}] {url}")

                source = detect_source(url)
                job_id = resolve_job_id(url, source)
                if not job_id:
                    print("  ❌ Cannot resolve job_id from URL")
                    results["failed"].append(url)
                    continue
                source, job_id = reuse_saved_posting(url, source, job_id)
                existing = get_tracker_job(job_id, source)
                if existing and not tracker_needs_scrape(existing):
                    outcome = handle_existing_tracker(
                        url, job_id, source, status, applied_date,
                        recommended_by=rec, identity=identity,
                    )
                    if outcome == "applied":
                        results["ok"].append(url)
                    elif outcome in ("already", "skip"):
                        results["skipped"].append(url)
                    if outcome != "missing":
                        continue
                    existing = None

                job = scrape_job_page(page, url) if page is not None else None
                if job:
                    # Same ad saved under another id/source: update that row
                    job["job_id"], job["source"] = job_id, source

                context = dict(
                    page=page, job_id=job_id, source=source, status=status,
                    applied_date=applied_date, rec=rec, identity=identity,
                    user_profile=user_profile, rules=rules,
                )
                if existing:
                    saved = _refresh_existing_card(job, existing, **context)
                else:
                    saved = _save_new_card(job, url=url, **context)
                results["ok" if saved else "failed"].append(url)

                if saved and page is not None:
                    pause(2, 4, "  ⏳ Brief pause before next URL")
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        # The URL that crashed is retried too: it was never saved.
        done = set(results["ok"]) | set(results["skipped"]) | set(results["failed"])
        remaining = [u for u in urls if normalize_pasted_job_url(u) not in done]
        if remaining:
            print("  → Falling back to link-only save for remaining URLs")
            merge_results(results, save_link_only_urls(remaining, **link_only_kwargs))
        return results

    print_results(results)
    return results
