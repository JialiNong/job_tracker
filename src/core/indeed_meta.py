"""
Indeed job-detail header parsing: company + location, never the rating chip
or a bullet separator. scrub_bullet_location also guards stored rows.
"""
import re

from core.browser import safe_text

_INDEED_LOCATION_SKIP = {
    "vollzeit",
    "teilzeit",
    "full-time",
    "part-time",
    "full time",
    "part time",
    "hybrides arbeiten",
    "hybrid",
    "remote",
    "homeoffice",
    "home office",
    "befristet",
    "unbefristet",
}

# Indeed metadata often uses middle-dot / bullet separators between company,
# location, and work-mode. Those characters alone must never become location.
_INDEED_META_SEP_RE = re.compile(r"[•·∙⋅|]+")
_INDEED_SEP_ONLY_RE = re.compile(r"^[\s•·∙⋅|\-–—]+$")

# Company rating chip next to the company name (e.g. "3.8", "4,2", "3.8 ★",
# "3.8 (152)"). That token sits on the company row; the real address is the
# next line — never treat the score as location.
_INDEED_RATING_RE = re.compile(
    r"^[0-5](?:[.,]\d)?\s*(?:★|⭐)?\s*(?:\([\d.,\s]+\))?$",
    re.IGNORECASE,
)


def _indeed_meta_parts(text: str) -> list:
    """Split a metadata line on Indeed bullet separators; drop empties."""
    if not text:
        return []
    parts = []
    for chunk in _INDEED_META_SEP_RE.split(text):
        chunk = chunk.strip()
        if chunk and not _INDEED_SEP_ONLY_RE.match(chunk):
            parts.append(chunk)
    return parts


def _is_indeed_company_rating(text: str) -> bool:
    """True for Indeed company-rating chips like '3.8' / '4,2 ★'."""
    if not text:
        return False
    return bool(_INDEED_RATING_RE.match(text.strip()))


def _is_plausible_indeed_location(text: str, company: str) -> bool:
    """Reject separators, ratings, company name echoes, and work-mode chips."""
    if not text or _INDEED_SEP_ONLY_RE.match(text):
        return False
    if _is_indeed_company_rating(text):
        return False
    if company and text == company:
        return False
    # "Acme Corp 3.8" when company link text is "Acme Corp"
    if company and text.startswith(company):
        rest = text[len(company):].strip(" \t•·∙⋅|-–—")
        if not rest or _is_indeed_company_rating(rest):
            return False
    if text.lower() in _INDEED_LOCATION_SKIP:
        return False
    return True


def extract_indeed_detail_meta(scope) -> tuple:
    """
    Pull company + location from an Indeed job-detail panel.

    Indeed puts these in the sticky/compact header
    ([data-testid="company-info-metadata"]), not in the JD body —
    so scrapers that only store description leave them empty.

    Typical layout:
      1. job title
      2. company name (+ optional rating chip like 3.8)
      3. location / address

    The rating must never be stored as location.

    Args:
        scope: Playwright Page or Locator that contains the detail panel

    Returns:
        (company, location) — either may be ""
    """
    company = (
        safe_text(scope.locator('[data-testid="company-info-metadata"] a[href*="/cmp/"]'))
        or safe_text(scope.locator('[data-testid="desktop-job-header"] a[href*="/cmp/"]'))
        or safe_text(scope.locator('[data-testid="desktop-embedded-compact-header"] a[href*="/cmp/"]'))
        or safe_text(scope.locator('a[href*="/cmp/"]'))
    )

    location = ""

    # Dedicated location nodes when Indeed exposes them
    for sel in (
        '[data-testid="job-location"]',
        '[data-testid="inlineHeader-companyLocation"]',
        '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
        '[data-testid="company-info-metadata"] [data-testid="job-location"]',
    ):
        try:
            raw = safe_text(scope.locator(sel))
        except Exception:
            raw = ""
        for part in _indeed_meta_parts(raw) or ([raw.strip()] if raw and raw.strip() else []):
            if _is_plausible_indeed_location(part, company):
                location = part
                break
        if location:
            break

    # Compact header often has a single line: "Berlin · Hybrides Arbeiten"
    if not location:
        compact = scope.locator('[data-testid="desktop-embedded-compact-header"]')
        if compact.count() > 0:
            compact_text = safe_text(compact)
            for line in compact_text.splitlines():
                parts = _indeed_meta_parts(line)
                # Prefer the left-most non-company, non-rating, non-work-mode token
                for part in parts:
                    if _is_plausible_indeed_location(part, company):
                        location = part
                        break
                if location:
                    break

    if not location:
        meta = scope.locator('[data-testid="company-info-metadata"]')
        if meta.count() > 0:
            lines = [
                ln.strip()
                for ln in safe_text(meta).splitlines()
                if ln.strip() and not _INDEED_SEP_ONLY_RE.match(ln.strip())
            ]
            # Drop the company row (and a rating chip that rode on the same /
            # following line) so the next remaining line is the address.
            cleaned = []
            for ln in lines:
                if company and (ln == company or ln.startswith(company)):
                    rest = ln[len(company):].strip(" \t•·∙⋅|-–—") if ln.startswith(company) else ""
                    if rest and not _is_indeed_company_rating(rest) and _is_plausible_indeed_location(rest, company):
                        cleaned.append(rest)
                    continue
                if _is_indeed_company_rating(ln):
                    continue
                cleaned.append(ln)
            for ln in cleaned:
                parts = _indeed_meta_parts(ln) or [ln]
                for part in parts:
                    if _is_plausible_indeed_location(part, company):
                        location = part
                        break
                if location:
                    break

    # Final guard: never persist a bullet/separator/rating as location
    if location and not _is_plausible_indeed_location(location, company):
        location = ""

    return company, location


def scrub_bullet_location(location: str) -> str:
    """
    Clear location values that are only Indeed/UI separators or rating chips
    (e.g. '·' / '•' / '3.8').

    Safe for any source — a separator-only or rating-only string is never a
    real place.
    """
    text = (location or "").strip()
    if not text or _INDEED_SEP_ONLY_RE.match(text) or _is_indeed_company_rating(text):
        return ""
    return text
