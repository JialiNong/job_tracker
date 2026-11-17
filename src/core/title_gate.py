"""
Pre-click title gate: decide from the job title alone whether a card is
worth opening (keyword exclude list → auto-pass keywords → AI check).
"""
import json
import os
import re

from core.config import TITLE_AUTO_PASS_KEYWORDS, TITLE_EXCLUDE_KEYWORDS

# Pre-compile all exclusion patterns once for efficiency (case-insensitive)
_EXCLUDE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in TITLE_EXCLUDE_KEYWORDS]

# Normalize hyphens/underscores so "full-stack" matches "Full Stack"
_KEYWORD_SPLIT = re.compile(r"[-_\s]+")


def is_title_excluded(title: str) -> bool:
    """
    Return True if the job title matches any exclusion pattern defined in
    TITLE_EXCLUDE_KEYWORDS, meaning the job card should be skipped without
    clicking into the detail page.
    """
    if not title:
        return False
    for pattern in _EXCLUDE_PATTERNS:
        if pattern.search(title):
            return True
    return False


def _normalize_title_text(text: str) -> str:
    """Lowercase and collapse hyphens/underscores/spaces for keyword matching."""
    return _KEYWORD_SPLIT.sub(" ", (text or "").lower()).strip()


def title_matches_auto_pass(title: str, keywords=None) -> bool:
    """
    Return True if the title contains any TITLE_AUTO_PASS_KEYWORDS term
    (hyphen/space insensitive, e.g. full-stack ≈ fullstack ≈ full stack).
    """
    if not title:
        return False
    normalized_title = _normalize_title_text(title)
    # Also check a no-space form so "fullstack" matches "full stack"
    compact_title = normalized_title.replace(" ", "")
    for kw in keywords if keywords is not None else TITLE_AUTO_PASS_KEYWORDS:
        normalized_kw = _normalize_title_text(kw)
        if not normalized_kw:
            continue
        if normalized_kw in normalized_title:
            return True
        if normalized_kw.replace(" ", "") in compact_title:
            return True
    return False


_TITLE_CHECK_PROMPT = """You screen job titles before opening the posting, for one candidate:
a frontend / full-stack web engineer (JavaScript/TypeScript, React / Vue / Angular,
some Node.js backend). A later step reads the full posting, so only reject titles
that are clearly NOT web/product software development.

Relevant (open it):
- Software Engineer / Developer, also with a team or product suffix
  ("Software Engineer – Payments", "Software Engineer (m/f/d)")
- Frontend / Front-End / Full Stack / Web / UI Developer or Engineer
- Product Engineer, Forward Deployed Engineer
- JavaScript / TypeScript / React / Vue / Angular / Node.js Developer
- Titles at AI companies where the work is building the product

Not relevant (skip), e.g.:
- Embedded, firmware, hardware, electronics, robotics, automotive ECU
- HMI / Qt / QML / C++ desktop or simulation software
  ("Qt/QML Simulation HMI Software Engineer")
- Data visualisation / data / BI / analytics engineering ("Data Visualisation Engineer")
- Systems / network / integration engineering ("Digital Integration Engineer")
- Growth / marketing engineering ("Growth Engineer // AI Music Video Platform")
- DevOps, SRE, cloud, security, QA, test, support, sales, solutions roles
- Roles in another language stack named in the title (Java, .NET, PHP, Python, Go, …)

If unsure, answer relevant.

Job title: {title}

Respond ONLY with valid JSON:
{{"relevant": true/false, "reason": "<one short sentence>"}}
"""


def is_title_relevant_by_ai(title: str) -> bool:
    """
    Ask AI whether a title is plausibly web/product software development.

    Used when the title passed TITLE_EXCLUDE_KEYWORDS but has no
    TITLE_AUTO_PASS_KEYWORDS term. Returns True if worth clicking.

    On missing API key or API failure, returns True (fail open) so potentially
    good jobs are not dropped due to transient errors.
    """
    if not title:
        return False

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("⚠ OPENAI_API_KEY missing; allowing click for title without keyword match")
        return True

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        model = os.getenv("AI_MODEL", "gpt-4.1-mini")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You classify job titles for a JavaScript/TypeScript web "
                        "engineer. Reject only titles that are clearly not web or "
                        "product software development. Respond only with JSON."
                    ),
                },
                {"role": "user", "content": _TITLE_CHECK_PROMPT.format(title=title)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content or "{}")
        relevant = bool(result.get("relevant", False))
        reason = (result.get("reason") or "").strip()
        verdict = "relevant" if relevant else "unrelated"
        print(f"  AI title check: {verdict}" + (f" — {reason}" if reason else ""))
        return relevant
    except Exception as e:
        print(f"⚠ AI title relevance check failed ({e}); allowing click")
        return True


def should_skip_title_before_click(title: str) -> tuple:
    """
    Pre-click title gate.

    1. TITLE_EXCLUDE_KEYWORDS match → skip
    2. Contains a TITLE_AUTO_PASS_KEYWORDS term → click
    3. Otherwise ask AI; skip only when AI says clearly not web/product dev

    Returns:
        (should_skip: bool, reason: str)
    """
    if is_title_excluded(title):
        return True, "title excluded by filter"
    if title_matches_auto_pass(title):
        return False, "matches TITLE_AUTO_PASS_KEYWORDS"
    if is_title_relevant_by_ai(title):
        return False, "AI judged relevant to target roles"
    return True, "AI judged unrelated to target roles"
