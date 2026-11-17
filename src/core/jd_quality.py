"""
Is a scraped job description (JD) complete enough to save and to match on?

Pure text checks — no browser, no AI, no language model.
"""
import re

from core.text import strip_html

# Minimum usable JD length for "there is some body text". Shorter text is
# treated as empty (failed scrape / UI chrome only) — scrapers retry, then
# still save with description_empty=True; matcher skips AI and marks failed.
MIN_JOB_DESCRIPTION_CHARS = 40
# A real posting is longer than a truncated "About the job" teaser or a
# similar-jobs sidebar. Below this, mark incomplete and do not send to AI.
MIN_COMPLETE_JOB_DESCRIPTION_CHARS = 280
DESCRIPTION_FETCH_RETRIES = 3

_CHROME_LINE = re.compile(
    r"^(?:"
    r"about the job|see more|show more|see less|show less|"
    r"mehr anzeigen|weniger anzeigen|"
    r"similar jobs|people also viewed|easy apply|apply(?: now)?|"
    r"promoted|be an early applicant|"
    r"ähnliche jobs|jetzt bewerben|bewerben"
    r")\.?$",
    re.I,
)
_SIDEBAR_HEADING = re.compile(
    r"\b(?:similar jobs|people also viewed|mehr ähnliche jobs|ähnliche jobs)\b",
    re.I,
)
_IDENTITY_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "und",
        "der",
        "die",
        "das",
        "von",
        "für",
        "gmbh",
        "ag",
        "inc",
        "ltd",
        "llc",
        "se",
        "ug",
        "co",
        "group",
        "holding",
        "senior",
        "junior",
        "staff",
        "principal",
        "engineer",
        "software",
        "developer",
        "manager",
        "lead",
        "remote",
        "hybrid",
        "onsite",
        "full",
        "stack",
        "frontend",
        "backend",
        "fullstack",
        "job",
        "jobs",
    }
)


def _plain_job_description(text: str) -> str:
    return strip_html(text or "").strip()


def _distinctive_identity_tokens(value: str) -> list:
    tokens = re.findall(r"[A-Za-zÄÖÜäöüß]{3,}", value or "")
    return [
        tok.lower()
        for tok in tokens
        if tok.lower() not in _IDENTITY_STOPWORDS and len(tok) >= 4
    ]


def _chrome_stripped(plain: str) -> str:
    kept = []
    for line in plain.splitlines():
        compact = " ".join(line.strip().split())
        if not compact or _CHROME_LINE.match(compact):
            continue
        kept.append(compact)
    return "\n".join(kept).strip()


def assess_job_description(
    text: str,
    title: str = "",
    company: str = "",
    source: str = "",
) -> dict:
    """
    Classify scraped JD text before matching.

    Returns {ok, kind, reason} where kind is ok / empty / incomplete.
    Incomplete means there is some text but it is too short, UI chrome, a
    similar-jobs sidebar, or does not match title/company — do not feed AI.
    """
    plain = _plain_job_description(text)
    if len(plain) < MIN_JOB_DESCRIPTION_CHARS:
        return {
            "ok": False,
            "kind": "empty",
            "reason": "Missing or too-short job description",
        }

    body = _chrome_stripped(plain)
    if len(body) < MIN_JOB_DESCRIPTION_CHARS:
        return {
            "ok": False,
            "kind": "incomplete",
            "reason": "Description looks like page chrome, not a job posting",
        }

    sidebar = _SIDEBAR_HEADING.search(plain)
    if sidebar and sidebar.start() < MIN_COMPLETE_JOB_DESCRIPTION_CHARS:
        return {
            "ok": False,
            "kind": "incomplete",
            "reason": "Description looks like a similar-jobs sidebar, not the posting",
        }

    if len(plain) < MIN_COMPLETE_JOB_DESCRIPTION_CHARS:
        return {
            "ok": False,
            "kind": "incomplete",
            "reason": f"Description too short ({len(plain)} chars) to match on",
        }

    lowered = body.lower()
    company_tokens = _distinctive_identity_tokens(company)
    title_tokens = _distinctive_identity_tokens(title)
    company_hit = any(tok in lowered for tok in company_tokens)
    title_hit = any(tok in lowered for tok in title_tokens)
    # Only flag identity mismatch when neither title nor company appears, and
    # the text is still short or looks like other job cards (LinkedIn sidebar).
    # Long LinkedIn JDs often name a product (SCAYLE) instead of the parent
    # company (ABOUT YOU); that is not a truncated teaser.
    if (
        (company_tokens or title_tokens)
        and not company_hit
        and not title_hit
        and (len(plain) < 600 or sidebar)
    ):
        return {
            "ok": False,
            "kind": "incomplete",
            "reason": "Description does not match the job title/company",
        }

    return {"ok": True, "kind": "ok", "reason": ""}


def is_usable_job_description(text: str) -> bool:
    """
    True if the scraped job description has enough real content to retry/save.

    Empty / whitespace / tiny fragments fail. Scrapers still save those jobs
    with description_empty=True; the AI matcher must not score them.
    """
    return assess_job_description(text)["kind"] != "empty"


def is_complete_job_description(
    text: str,
    title: str = "",
    company: str = "",
    source: str = "",
) -> bool:
    """True if the JD is complete enough to send to AI matching."""
    return assess_job_description(text, title, company, source)["ok"]


def description_save_flags(
    text: str,
    title: str = "",
    company: str = "",
    source: str = "",
) -> dict:
    """Flags stored on scraped job documents (no live DB migration)."""
    assessment = assess_job_description(text, title, company, source)
    return {
        "description_empty": assessment["kind"] == "empty",
        "description_incomplete": assessment["kind"] != "ok",
        "description_quality": assessment["kind"],
        "description_quality_reason": assessment["reason"],
    }
