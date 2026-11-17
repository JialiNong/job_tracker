"""
Open one job URL in debug Chrome and extract title / company / location / JD.

Used by Log Job, Fetch details, and Run AI (when the Tracker card has no
stored JD). LinkedIn and Indeed have site selectors; Glassdoor has its own
because trafilatura usually misses the React listing; other career pages
use trafilatura + visible text.

Does not close the user's Chrome session.
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

from core.config import INDEED_CONFIG
from core.content_wait import locator_has_text, wait_for_job_content
from core.job_url import (
    canonicalize_url,
    detect_source,
    extract_indeed_job_id,
    extract_linkedin_job_id,
    job_id_from_url,
    normalize_pasted_job_url,
)

# Minimum chars of extracted body text before we treat a generic page as a JD
_GENERIC_MIN_DESC_CHARS = 200

_LINKEDIN_TITLE_SELECTORS = (
    ".job-details-jobs-unified-top-card__job-title",
    "h1.job-details-jobs-unified-top-card__job-title",
    ".top-card-layout__title",
    ".topcard__title",
    "h1.top-card-layout__title",
    "h1",
)

_LINKEDIN_COMPANY_SELECTORS = (
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    "a.topcard__org-name-link",
    ".topcard__org-name-link",
    ".topcard__flavor:not(.topcard__flavor--bullet)",
)

_LINKEDIN_LOCATION_SELECTORS = (
    ".job-details-jobs-unified-top-card__bullet",
    ".topcard__flavor--bullet",
    ".top-card-layout__card .topcard__flavor--bullet",
)

_LINKEDIN_READY_SELECTORS = (
    ".job-details-jobs-unified-top-card__job-title",
    ".top-card-layout__title",
    ".topcard__title",
    ".show-more-less-html__markup",
    ".description__text",
    ".jobs-description-content__text",
    "[id*='JobDetails_AboutTheJob']",
    "h1",
)

_INDEED_DETAIL_SELECTOR = INDEED_CONFIG["selectors"]["detail"]
_INDEED_READY_SELECTORS = (
    _INDEED_DETAIL_SELECTOR,
    "#jobDescriptionText",
    '[data-testid="viewjob-main-content"]',
    '[data-testid="vj-job-title"]',
    "h1",
)

_GLASSDOOR_TITLE_SELECTORS = (
    '[data-test="job-title"]',
    '[data-test="jobTitle"]',
    '[data-test="job-listing-title"]',
    'h1[class*="JobDetails_jobTitle"]',
    "h1",
)

_GLASSDOOR_COMPANY_SELECTORS = (
    '[data-test="employer-name"]',
    '[data-test="employerName"]',
    '[data-test="employer-short-name"]',
    '[class*="JobDetails_employerName"]',
)

_GLASSDOOR_LOCATION_SELECTORS = (
    '[data-test="location"]',
    '[data-test="job-location"]',
    '[class*="JobDetails_location"]',
)

_GLASSDOOR_DESC_SELECTORS = (
    '[data-test="jobDescriptionText"]',
    '[data-test="description"]',
    "#JobDescriptionContainer",
    ".jobDescriptionContent",
    '[class*="JobDetails_jobDescription"]',
    "article.job-details",
)

_GLASSDOOR_BLOCK_HINTS = (
    "sign in to see",
    "sign in to glassdoor",
    "sign in or create an account",
    "create an account to see",
    "continue with google",
    "continue with apple",
    "continue with facebook",
    "join to see",
    "please verify you are a human",
    "melde dich an, um",
    "melden sie sich an, um",
    "anmelden, um stellen",
    "konto erstellen",
)

_COOKIE_BUTTONS = (
    "button#onetrust-accept-btn-handler",
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Accept All")',
    'button:has-text("Accept cookies")',
    'button:has-text("Ich stimme zu")',
)

_SHOW_MORE_BUTTONS = (
    '[data-test="show-more-cta"]',
    'button:has-text("Show more")',
    'button:has-text("Show More")',
    'button:has-text("Mehr anzeigen")',
)


def _su():
    """Lazy scraper_utils — not imported for Save Link Only."""
    import core.scraper_utils as su
    return su


def linkedin_view_url(job_id: str) -> str:
    """Canonical LinkedIn job page — used for Log Job / Run AI / Fetch."""
    return f"https://www.linkedin.com/jobs/view/{job_id}/"


def is_glassdoor_url(url: str) -> bool:
    host = (urlparse(normalize_pasted_job_url(url)).hostname or "").lower()
    return "glassdoor." in f"{host}."


def _first_locator_text(page, selectors) -> str:
    su = _su()
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.count() == 0:
                continue
            text = (su.safe_text(loc) or "").strip()
            if text:
                return text
        except Exception:
            continue
    return ""


def _extract_linkedin_view_identity(page) -> tuple[str, str, str, str]:
    """Title / company / location / applicants from a /jobs/view page."""
    title = _first_locator_text(page, _LINKEDIN_TITLE_SELECTORS)
    company = _first_locator_text(page, _LINKEDIN_COMPANY_SELECTORS)
    location = _first_locator_text(page, _LINKEDIN_LOCATION_SELECTORS)
    from scrapers.linkedin_scraper import extract_linkedin_applicants
    applicants = extract_linkedin_applicants(page)
    if title.lower() in {"linkedin", "sign in", "join now"}:
        title = ""
    return title, company, location, applicants


def _dismiss_cookie_overlays(page) -> None:
    """Best-effort dismiss cookie / consent dialogs (Indeed + Glassdoor)."""
    for selector in _COOKIE_BUTTONS:
        try:
            btn = page.locator(selector)
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click(timeout=2000)
                _su().pause(0.5, 1.0)
                return
        except Exception:
            continue


def _click_show_more(page) -> None:
    for selector in _SHOW_MORE_BUTTONS:
        try:
            btn = page.locator(selector)
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click(timeout=2000)
                _su().pause(0.4, 0.8)
                return
        except Exception:
            continue


def _page_text_sample(page, limit: int = 2500) -> str:
    try:
        body = page.locator("body")
        if body.count() == 0:
            return ""
        return (body.first.inner_text(timeout=2000) or "")[:limit].lower()
    except Exception:
        return ""


def _looks_like_block_wall(page, hints) -> bool:
    sample = _page_text_sample(page)
    if not sample:
        return False
    return any(hint in sample for hint in hints)


def linkedin_detail_ready(page) -> bool:
    title = _first_locator_text(page, _LINKEDIN_TITLE_SELECTORS)
    if title.lower() in {"linkedin", "sign in", "join now"}:
        title = ""
    if title:
        return True
    return locator_has_text(page, _LINKEDIN_READY_SELECTORS, min_chars=20)


def indeed_detail_ready(page) -> bool:
    from core.challenge_wait import is_indeed_challenge_page
    try:
        if is_indeed_challenge_page(page):
            return False
    except Exception:
        pass
    return locator_has_text(page, _INDEED_READY_SELECTORS, min_chars=8)


def glassdoor_detail_ready(page) -> bool:
    if locator_has_text(page, _GLASSDOOR_DESC_SELECTORS, min_chars=80):
        return True
    title = _first_locator_text(page, _GLASSDOOR_TITLE_SELECTORS)
    if title and not _looks_like_block_wall(page, _GLASSDOOR_BLOCK_HINTS):
        return True
    return False


def generic_detail_ready(page, url: str) -> bool:
    if is_glassdoor_url(url):
        return glassdoor_detail_ready(page)
    for selector in ("main", "article", "[role='main']"):
        try:
            loc = page.locator(selector).first
            if loc.count() == 0:
                continue
            text = (loc.inner_text(timeout=1500) or "").strip()
            if len(text) >= _GENERIC_MIN_DESC_CHARS:
                return True
        except Exception:
            continue
    return locator_has_text(page, ("h1",), min_chars=8)


def _empty_job(url: str, job_id: str, source: str) -> dict:
    return {
        "title": "",
        "company": "",
        "location": "",
        "applicants": "",
        "description": "",
        "link": url,
        "job_id": job_id,
        "source": source,
        "scrape_warning": "",
    }


def _after_content_wait(outcome: str) -> None:
    if outcome == "clicked":
        _su().pause(0.4, 0.8)


def scrape_linkedin_job(page, url: str) -> Optional[dict]:
    """
    Open the LinkedIn /jobs/view/{id}/ page and extract title, company,
    location, and description.

    Manual Log / Run AI / Fetch always use the view URL — the search-results
    page (keywords=frontend + last 24h) often does not include this job, so
    the detail panel never loads and we used to fall back to a link-only stub.
    """
    from scrapers.linkedin_scraper import (
        extract_linkedin_description,
        _trim_linkedin_sidebar,
    )

    job_id = extract_linkedin_job_id(url)
    if not job_id:
        print(f"  ⚠️  Cannot extract LinkedIn job_id from: {url}")
        return None

    canonical_url = linkedin_view_url(job_id)
    job = _empty_job(canonical_url, job_id, "linkedin")

    print(f"  → Navigating to {canonical_url}")
    try:
        page.goto(canonical_url, wait_until="domcontentloaded", timeout=20000)
    except Exception as e:
        job["scrape_warning"] = f"Navigation error: {e}"
        print(f"  ⚠️  {job['scrape_warning']} — page may still be usable")

    outcome = wait_for_job_content(
        page, lambda: linkedin_detail_ready(page), site="LinkedIn",
    )
    _after_content_wait(outcome)

    title, company, location, applicants = _extract_linkedin_view_identity(page)
    description = extract_linkedin_description(page, job_id)
    if description:
        print("  🔍 Description found via LinkedIn About-the-job extract")
    else:
        html = ""
        try:
            html = page.content() or ""
        except Exception as e:
            print(f"  ⚠️  Could not read LinkedIn HTML: {e}")
        description = _extract_main_text_from_html(html, canonical_url)
        if description:
            print(f"  📄 trafilatura extracted {len(description)} chars from LinkedIn view")
        else:
            description = _fallback_page_text(page)
            if description:
                print(f"  📄 fallback text: {len(description)} chars")
        description = _trim_linkedin_sidebar(description)

    job["title"] = title
    job["company"] = company
    job["location"] = location
    job["applicants"] = applicants
    job["description"] = description
    if not description and not title:
        job["scrape_warning"] = job["scrape_warning"] or (
            "LinkedIn page loaded but title/description were empty "
            "(login wall or expired posting?)"
        )
        print(f"  ⚠️  {job['scrape_warning']}")
    elif description:
        job["scrape_warning"] = ""
    return job


def scrape_indeed_job(page, url: str) -> Optional[dict]:
    """
    Navigate to an Indeed viewjob URL and extract job data.

    Always returns a job dict when jk= can be parsed — even if Chrome is
    blocked, the detail timed out, or Indeed showed a challenge. Callers
    must still save that stub instead of dropping the URL.
    """
    su = _su()
    url = normalize_pasted_job_url(url)
    job_id = extract_indeed_job_id(url)
    if not job_id:
        print(f"  ⚠️  Cannot extract Indeed job_id from: {url}")
        return None

    canonical_url = f"https://de.indeed.com/viewjob?jk={job_id}"
    job = _empty_job(canonical_url, job_id, "indeed")

    print(f"  → Navigating to {canonical_url}")
    try:
        page.goto(canonical_url, wait_until="domcontentloaded", timeout=20000)
    except Exception as e:
        job["scrape_warning"] = f"Navigation error: {e}"
        print(f"  ⚠️  {job['scrape_warning']} — page may still be usable")

    _dismiss_cookie_overlays(page)

    outcome = wait_for_job_content(
        page, lambda: indeed_detail_ready(page), site="Indeed",
    )
    _after_content_wait(outcome)

    try:
        company, location = su.extract_indeed_detail_meta(page)
    except Exception:
        company, location = "", ""
    title = ""
    try:
        title = su.safe_text(page.locator('[data-testid="vj-job-title"]')) or ""
    except Exception:
        pass

    description = ""
    for sel in [
        "#jobDescriptionText",
        ".jobsearch-JobComponent-description",
        ".simple-job-description-html",
        _INDEED_DETAIL_SELECTOR,
    ]:
        try:
            loc = page.locator(sel).first
            if loc.count() > 0:
                desc_html = loc.inner_html(timeout=8000) or ""
                if desc_html:
                    description = su.strip_html(desc_html)
                    if description:
                        print(f"  🔍 Description found via: {sel}")
                        break
        except Exception:
            pass

    job["title"] = title
    job["company"] = company
    job["location"] = location
    job["description"] = description
    if not description and not title:
        job["scrape_warning"] = job["scrape_warning"] or (
            "Indeed page loaded but title/description were empty"
            if outcome != "timeout"
            else "Timed out waiting for Indeed job detail (login or block?)"
        )
        print(f"  ⚠️  {job['scrape_warning']}")
    elif description:
        job["scrape_warning"] = ""
    elif outcome == "timeout" and not job["scrape_warning"]:
        job["scrape_warning"] = (
            "Timed out waiting for Indeed job detail (login or block?)"
        )
        print(f"  ⚠️  {job['scrape_warning']}")
    return job


def _extract_main_text_from_html(html: str, url: str) -> str:
    """
    Pull the main article/job body from raw HTML via trafilatura.
    Returns empty string if extraction fails.
    """
    if not html:
        return ""
    import trafilatura
    text = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=True,
        favor_precision=True,
        output_format="txt",
    )
    return (text or "").strip()


def _fallback_page_text(page) -> str:
    """Last-resort plain text from semantic containers or body."""
    for selector in ("main", "article", "[role='main']", "body"):
        try:
            loc = page.locator(selector).first
            if loc.count() == 0:
                continue
            text = (loc.inner_text(timeout=3000) or "").strip()
            if len(text) >= _GENERIC_MIN_DESC_CHARS:
                return text
        except Exception:
            continue
    return ""


def _extract_glassdoor_fields(page) -> tuple[str, str, str, str]:
    title = _first_locator_text(page, _GLASSDOOR_TITLE_SELECTORS)
    if title.lower() in {"glassdoor", "sign in", "join"}:
        title = ""
    company = _first_locator_text(page, _GLASSDOOR_COMPANY_SELECTORS)
    location = _first_locator_text(page, _GLASSDOOR_LOCATION_SELECTORS)
    description = ""
    su = _su()
    for sel in _GLASSDOOR_DESC_SELECTORS:
        try:
            loc = page.locator(sel).first
            if loc.count() == 0:
                continue
            html = loc.inner_html(timeout=8000) or ""
            if html:
                description = su.strip_html(html)
            if not description:
                description = (su.safe_text(loc) or "").strip()
            if description:
                print(f"  🔍 Glassdoor description via: {sel}")
                break
        except Exception:
            continue
    return title, company, location, description


def scrape_generic_job(page, url: str) -> Optional[dict]:
    """
    Open any career-page URL, extract main content with trafilatura
    (Glassdoor: site selectors first), and return a job dict.

    Always returns a job dict when the URL can be hashed, so Fetch details
    can surface a specific warning instead of a blank "Scraping failed".
    Title / company / location may be filled later by AI if missing.
    """
    canonical_url = canonicalize_url(url)
    job_id = job_id_from_url(canonical_url)
    glassdoor = is_glassdoor_url(url)
    site = "Glassdoor" if glassdoor else "this career page"
    job = _empty_job(canonical_url, job_id, "manual")

    print(f"  → Navigating to {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=40000 if glassdoor else 25000)
    except Exception as e:
        job["scrape_warning"] = f"Navigation error: {e}"
        print(f"  ⚠️  {job['scrape_warning']} — page may still be usable")

    _dismiss_cookie_overlays(page)
    if glassdoor:
        try:
            page.mouse.wheel(0, 900)
        except Exception:
            pass

    outcome = wait_for_job_content(
        page, lambda: generic_detail_ready(page, url), site=site,
    )
    _after_content_wait(outcome)
    _click_show_more(page)

    title = company = location = ""
    description = ""
    if glassdoor:
        title, company, location, description = _extract_glassdoor_fields(page)

    if not description:
        html = ""
        try:
            html = page.content() or ""
        except Exception as e:
            print(f"  ⚠️  Could not read page HTML: {e}")
        description = _extract_main_text_from_html(html, canonical_url)
        if description:
            print(f"  📄 trafilatura extracted {len(description)} chars")
        else:
            print("  ⚠️  trafilatura returned empty — falling back to page text")
            description = _fallback_page_text(page)
            if description:
                print(f"  📄 fallback text: {len(description)} chars")

    if not title:
        try:
            hint = (page.title() or "").strip()
            if hint:
                print(f"  💡 Page <title> hint: {hint[:80]}")
        except Exception:
            pass

    job["title"] = title
    job["company"] = company
    job["location"] = location
    job["description"] = description
    if len(description) < _GENERIC_MIN_DESC_CHARS:
        why = (
            f"{site} opened but the job text was too short "
            f"({len(description)} chars). Login wall or blocked listing?"
        )
        job["scrape_warning"] = job["scrape_warning"] or why
        job["description"] = ""
        print(f"  ⚠️  {job['scrape_warning']}")
    else:
        job["scrape_warning"] = ""
        job["description"] = description
    return job


def scrape_job_page(page, url: str) -> Optional[dict]:
    """Scrape one URL with the already-open CDP page. Returns job dict or None."""
    source = detect_source(url)
    try:
        if source == "linkedin":
            return scrape_linkedin_job(page, url)
        if source == "indeed":
            return scrape_indeed_job(page, url)
        label = "Glassdoor" if is_glassdoor_url(url) else "Generic career page"
        print(f"  🌐 {label} — using {'Glassdoor selectors' if is_glassdoor_url(url) else 'trafilatura extract'}")
        return scrape_generic_job(page, url)
    except Exception as e:
        print(f"  ❌ Unexpected error while scraping: {type(e).__name__}: {e}")
        return None
