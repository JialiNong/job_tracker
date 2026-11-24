"""User-typed Tracker fields that a later scrape must not overwrite."""
from __future__ import annotations

USER_DESCRIPTION_MAX_CHARS = 80_000
MANUAL_DESCRIPTION = "description"
KNOWN_MANUAL_FIELDS = frozenset({"title", "company", "location", MANUAL_DESCRIPTION})


def known_manual_fields(raw) -> list[str]:
    """Keep only title / company / location / description, in first-seen order."""
    out: list[str] = []
    seen: set[str] = set()
    for item in raw or []:
        field = str(item)
        if field not in KNOWN_MANUAL_FIELDS or field in seen:
            continue
        seen.add(field)
        out.append(field)
    return out


def with_manual_description(raw, *, has_text: bool) -> list[str]:
    """Add or drop `description` in manual_fields after a user paste / clear."""
    fields = [f for f in known_manual_fields(raw) if f != MANUAL_DESCRIPTION]
    if has_text:
        fields.append(MANUAL_DESCRIPTION)
    return fields


def normalize_user_description(raw) -> tuple[str | None, str | None]:
    """Return (text, error). Missing or non-string input is an error."""
    if not isinstance(raw, str):
        return None, "description must be a string"
    text = raw.replace("\x00", "")
    if len(text) > USER_DESCRIPTION_MAX_CHARS:
        text = text[:USER_DESCRIPTION_MAX_CHARS]
    return text, None


def keep_manual_description(scraped: dict, existing: dict | None) -> dict:
    """
    Prefer a user-pasted original JD over a later scrape.

    A non-empty description listed in existing.manual_fields is copied onto
    the scrape dict so Fetch details / Run AI write it back instead of the
    (often empty) page extract.
    """
    existing = existing or {}
    if MANUAL_DESCRIPTION not in (existing.get("manual_fields") or []):
        return scraped
    current = str(existing.get("description") or "").strip()
    if current:
        scraped["description"] = existing.get("description")
    return scraped
