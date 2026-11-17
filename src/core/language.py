"""
English-only gate for job descriptions (Lingua n-gram models, Apache-2.0).

Lingua is optional at import time: the Render web image does not install it
and never calls these functions.
"""
import re

try:
    from lingua import Language, LanguageDetectorBuilder
    _LINGUA_AVAILABLE = True
except ImportError:
    _LINGUA_AVAILABLE = False
    Language = None
    LanguageDetectorBuilder = None

from core.text import strip_html

# Too little text to classify reliably (failed/empty detail panels).
_MIN_LANG_CHARS = 40

# Ignore tiny fragments ("Berlin", "3.8") when estimating language share.
_MIN_CHUNK_CHARS = 12

# Indeed DE chrome ("Weiter zur Bewerbung") is a few German lines on an
# English JD. Only treat the posting as German above this share.
GERMAN_SHARE_THRESHOLD = 0.20

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")

# Restrict the model set to languages commonly seen on DE job boards.
# Lingua is more accurate with a small candidate set than with all 75 languages.
_LANGUAGE_DETECTOR = None


def _get_language_detector():
    """Build a Lingua detector once; language models load lazily on first use."""
    global _LANGUAGE_DETECTOR
    if not _LINGUA_AVAILABLE:
        raise RuntimeError("lingua-language-detector is not installed. Required for language detection in scrapers.")
    if _LANGUAGE_DETECTOR is None:
        _LANGUAGE_DETECTOR = LanguageDetectorBuilder.from_languages(
            Language.ENGLISH,
            Language.GERMAN,
            Language.FRENCH,
            Language.DUTCH,
        ).build()
    return _LANGUAGE_DETECTOR


def german_content_share(text: str) -> float:
    """
    Fraction of classified text that Lingua labels as German (0.0–1.0).

    Splits on sentences/lines and weights each chunk by character length.
    HTML is stripped first. Returns 0.0 when there is too little text.
    """
    plain = strip_html(text)
    if len(plain) < _MIN_LANG_CHARS:
        return 0.0

    chunks = [
        chunk.strip()
        for chunk in _SENTENCE_SPLIT.split(plain)
        if len(chunk.strip()) >= _MIN_CHUNK_CHARS
    ]
    if not chunks:
        return 0.0

    detector = _get_language_detector()
    german_chars = 0
    total_chars = 0
    for chunk in chunks:
        language = detector.detect_language_of(chunk)
        total_chars += len(chunk)
        if language == Language.GERMAN:
            german_chars += len(chunk)
    if total_chars == 0:
        return 0.0
    return german_chars / total_chars


def detect_job_detail_language(text: str):
    """
    Detect job-detail language.

    Classified as German when more than GERMAN_SHARE_THRESHOLD of the text is
    German, so a few DE UI strings on an English Indeed page do not force "de".

    Callers that gate on language should use is_non_english_job_detail —
    only English JDs continue; other languages (DE, FR, …) are skipped and
    counted as german_filtered in the UI.

    Returns:
        Tuple of (iso_code or None, german_share from 0.0 to 1.0).
        iso_code is a lowercase ISO 639-1 code such as 'de' or 'en'.
    """
    plain = strip_html(text)
    if len(plain) < _MIN_LANG_CHARS:
        return None, 0.0

    german_share = german_content_share(plain)
    if german_share > GERMAN_SHARE_THRESHOLD:
        return "de", german_share

    language = _get_language_detector().detect_language_of(plain)
    if language is None:
        return None, german_share
    return language.iso_code_639_1.name.lower(), german_share


def is_non_english_job_detail(text: str):
    """
    English-only gate for job detail pages.

    Returns (should_skip, lang, german_share). Skip when the JD is confidently
    not English (German, French, Dutch, …). Too-short / undetectable text does
    not skip (fail open). Callers still increment german_filtered — on DE job
    boards almost all non-English posts are German; FR etc. are rare but must
    not reach matching either.

    Always run this before save, including when assess_job_description marked
    the text incomplete. Completeness and language are separate gates.
    """
    lang, german_share = detect_job_detail_language(text)
    if lang is None or lang == "en":
        return False, lang, german_share
    return True, lang, german_share
