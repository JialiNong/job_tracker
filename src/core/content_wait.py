"""
Wait for a job posting to become readable after Playwright opens the page.

Fetch details / Log Job / Run AI open LinkedIn, Indeed, Glassdoor, and other
career pages in the debug Chrome window. The posting is often not in the DOM
yet: SPA hydrate, cookie banner, login wall, captcha, or a "Show more" button
the user has to click.

Flow:
  1. Settle 2–3s so the first paint can finish
  2. If the posting is already readable, return immediately (no Telegram)
  3. Otherwise print + Telegram: click whatever is blocking Chrome
  4. Poll until the posting is readable, then remind that the click worked
  5. Caller scrapes after this returns
"""
from __future__ import annotations

import random
import time
from typing import Callable, Optional

from tg.client import send_telegram_message

SETTLE_SEC = (2.0, 3.0)
# After settle, wait this long before pinging Telegram so a slow hydrate
# does not look like a missing click.
NOTIFY_AFTER_SEC = 5.0
WAIT_TIMEOUT_SEC = 120.0
POLL_INTERVAL_SEC = 0.75

ReadyFn = Callable[[], bool]


def _page_alive(page) -> bool:
    if page is None:
        return False
    try:
        closed = getattr(page, "is_closed", None)
        if callable(closed):
            return not closed()
        return True
    except Exception:
        return False


def locator_has_text(page, selectors, min_chars: int = 1) -> bool:
    """True when any selector has visible stripped text of at least min_chars."""
    if not _page_alive(page):
        return False
    for sel in selectors:
        try:
            loc = page.locator(sel)
            if loc.count() == 0:
                continue
            first = loc.first
            try:
                if not first.is_visible():
                    continue
            except Exception:
                pass
            text = (first.inner_text(timeout=1500) or "").strip()
            if len(text) >= min_chars:
                return True
        except Exception:
            continue
    return False


def _site_label(site: str) -> str:
    return (site or "this page").strip() or "this page"


def notify_waiting_for_click(site: str) -> bool:
    label = _site_label(site)
    print(
        f"  ⏳ {label} opened but the job text is not readable yet — "
        "click login / cookie / captcha / Show more in debug Chrome if you need to"
    )
    return send_telegram_message(
        f"⏳ Fetch details is waiting on {label}\n\n"
        "The page opened, but the job text is not readable yet "
        "(login, cookie, captcha, or a button).\n\n"
        "Click whatever you need in the debug Chrome window. "
        "I will scrape as soon as the posting appears."
    )


def notify_click_succeeded(site: str) -> bool:
    label = _site_label(site)
    print(f"  ✅ Your click on {label} worked — scraping the job now")
    return send_telegram_message(
        f"✅ Your click on {label} worked — scraping the job now."
    )


def wait_for_job_content(
    page,
    is_ready: ReadyFn,
    *,
    site: str,
    settle_sec: tuple[float, float] | float = SETTLE_SEC,
    timeout_sec: float = WAIT_TIMEOUT_SEC,
    notify_after_sec: float = NOTIFY_AFTER_SEC,
    poll_sec: float = POLL_INTERVAL_SEC,
    sleep_fn: Callable[[float], None] = time.sleep,
    notify_wait: Optional[Callable[[str], bool]] = None,
    notify_ready: Optional[Callable[[str], bool]] = None,
) -> str:
    """
    Settle, then wait until is_ready() or timeout.

    Returns:
      "ready"   — posting was readable after the settle pause
      "clicked" — posting appeared after we asked for a click
      "timeout" — still not readable; caller should try extract anyway
    """
    if isinstance(settle_sec, (int, float)):
        delay = float(settle_sec)
    else:
        lo, hi = settle_sec
        delay = random.uniform(float(lo), float(hi))
    if delay > 0:
        print(f"  ⏳ Waiting {delay:.1f}s for the page to settle")
        sleep_fn(delay)

    def _ready() -> bool:
        if not _page_alive(page):
            return False
        try:
            return bool(is_ready())
        except Exception:
            return False

    if _ready():
        return "ready"

    print(
        f"  ⏳ {_site_label(site)} posting not visible yet — "
        "waiting for the page (click in Chrome if something is blocking it)"
    )
    wait_fn = notify_wait or notify_waiting_for_click
    ready_fn = notify_ready or notify_click_succeeded
    asked = False
    deadline = time.monotonic() + max(0.0, float(timeout_sec))
    notify_at = time.monotonic() + max(0.0, float(notify_after_sec))

    while time.monotonic() < deadline:
        sleep_fn(max(0.0, float(poll_sec)))
        if _ready():
            if asked:
                ready_fn(site)
                return "clicked"
            return "ready"
        if not asked and time.monotonic() >= notify_at:
            wait_fn(site)
            asked = True

    if asked:
        print(
            f"  ⚠️  Timed out waiting for the {_site_label(site)} posting "
            f"after {timeout_sec:.0f}s — trying to extract anyway"
        )
    else:
        print(
            f"  ⚠️  {_site_label(site)} posting still not readable — "
            "trying to extract anyway"
        )
    return "timeout"
