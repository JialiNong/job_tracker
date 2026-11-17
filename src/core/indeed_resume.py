"""
Resume flag for the Indeed human-verification handshake.

The scraper (scrapers.challenge_wait) clears it and waits; the Telegram bot
writes it when the user taps Continue or sends /indeed_ok.

Manual fallback (bot offline):
  touch logs/indeed_human_resume.flag
"""
from __future__ import annotations

import time
from pathlib import Path

from core.paths import PROJECT_ROOT

LOGS_DIR = PROJECT_ROOT / "logs"
RESUME_FLAG_PATH = LOGS_DIR / "indeed_human_resume.flag"


def clear_resume_flag() -> None:
    """Remove a stale resume signal so we do not auto-continue from a prior run."""
    try:
        RESUME_FLAG_PATH.unlink(missing_ok=True)
    except OSError as exc:
        print(f"⚠ Could not clear resume flag: {exc}")


def signal_indeed_resume() -> Path:
    """Write the resume flag. Returns the flag path."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    RESUME_FLAG_PATH.write_text(f"resume_at={time.time()}\n", encoding="utf-8")
    return RESUME_FLAG_PATH


def resume_flag_exists() -> bool:
    return RESUME_FLAG_PATH.is_file()
