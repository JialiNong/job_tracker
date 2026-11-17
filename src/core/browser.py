"""
Debug-Chrome (CDP) connection and small Playwright page helpers.

Never imports Playwright itself: callers pass in the Playwright instance,
page or locator, so importing this module is safe on Render.
"""
import json
import random
import socket
import subprocess
import time
import urllib.request

from core.config import (
    CDP_HOST,
    CDP_PORT,
    CDP_URL,
    CHROME_BIN,
    CHROME_USER_DATA_DIR,
)


def pause(min_seconds, max_seconds, message=None):
    """Sleep for a random interval to simulate human behavior."""
    delay = random.uniform(min_seconds, max_seconds)
    if message:
        print(f"{message} ({delay:.1f}s)")
    time.sleep(delay)


def safe_text(locator, timeout=3000):
    """Stripped inner text of the first match, or "" if missing / on any error."""
    try:
        if locator.count() == 0:
            return ""
        return (locator.first.inner_text(timeout=timeout) or "").strip()
    except Exception:
        return ""


def safe_attr(locator, name, timeout=3000):
    """Attribute of the first match, or "" if missing / on any error."""
    try:
        if locator.count() == 0:
            return ""
        return locator.first.get_attribute(name, timeout=timeout) or ""
    except Exception:
        return ""


def is_cdp_open():
    """True if the Chrome DevTools Protocol port accepts connections."""
    try:
        with socket.create_connection((CDP_HOST, CDP_PORT), timeout=1):
            return True
    except OSError:
        return False


def start_debug_chrome(site_name="the website"):
    """
    Launch Chrome with remote debugging enabled, using a separate user data
    directory so it does not clash with a normal Chrome.

    Raises:
        RuntimeError: If Chrome fails to start or CDP never opens
    """
    print(
        f"Nothing is listening on {CDP_URL}. "
        "Starting Chrome with remote debugging..."
    )
    subprocess.Popen(
        [
            CHROME_BIN,
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={CHROME_USER_DATA_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(20):
        if is_cdp_open():
            print("Chrome remote debugging is ready.")
            return
        time.sleep(0.5)
    raise RuntimeError(
        f"Could not connect to {CDP_URL}. Start Chrome yourself with:\n"
        f'  "{CHROME_BIN}" --remote-debugging-port={CDP_PORT} '
        f'--user-data-dir="{CHROME_USER_DATA_DIR}"\n'
        f"Open {site_name} in that window if needed, then run the scraper again."
    )


def open_scraper_page(context, bring_to_front=False):
    """
    Open a dedicated tab for one scraper.

    Parallel scrapers must not share context.pages[0]. A second page.goto on
    the same tab aborts the first navigation (net::ERR_ABORTED), so LinkedIn
    never finishes loading when Indeed starts at the same time.
    """
    page = context.new_page()
    if bring_to_front:
        try:
            page.bring_to_front()
        except Exception:
            pass
    return page


def is_target_closed_error(exc: BaseException) -> bool:
    """True when Playwright lost the tab/browser (TargetClosedError)."""
    name = type(exc).__name__
    if name == "TargetClosedError":
        return True
    msg = str(exc)
    return "Target page, context or browser has been closed" in msg


def goto_page(page, url, wait_until="domcontentloaded", attempts=3, timeout=60000):
    """
    Navigate, retrying when Chrome aborts the load.

    LinkedIn often replaces the original request with a redirect. Playwright
    reports that as net::ERR_ABORTED even if the destination later commits.
    """
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            page.goto(url, wait_until=wait_until, timeout=timeout)
            return
        except Exception as e:
            last_error = e
            aborted = "ERR_ABORTED" in str(e)
            if aborted:
                try:
                    current = page.url or ""
                except Exception:
                    current = ""
                if current and current != "about:blank" and "linkedin.com" in current:
                    print(f"Navigation aborted, continuing at {current}")
                    return
            if not aborted or attempt == attempts:
                raise
            print(f"Navigation aborted (attempt {attempt}/{attempts}), retrying...")
            time.sleep(2)
    raise last_error


def ensure_cdp_page():
    """
    Open a blank tab if the debug Chrome has no pages.

    On macOS, closing every window leaves Chrome running with no tabs, and
    Playwright's connect_over_cdp then fails with "Browser context management
    is not supported".
    """
    try:
        with urllib.request.urlopen(f"{CDP_URL}/json/list", timeout=2) as resp:
            targets = json.load(resp)
        if any(t.get("type") == "page" for t in targets):
            return
        req = urllib.request.Request(f"{CDP_URL}/json/new?about:blank", method="PUT")
        urllib.request.urlopen(req, timeout=5).close()
    except Exception as e:
        print(f"Could not ensure a Chrome tab is open: {e}")


def connect_browser(playwright, site_name="the website"):
    """
    Connect to Chrome over CDP, starting the debug Chrome if needed.

    Raises:
        RuntimeError: If connection fails or no browser context found
    """
    if not is_cdp_open():
        start_debug_chrome(site_name)
    ensure_cdp_page()
    try:
        browser = playwright.chromium.connect_over_cdp(CDP_URL)
    except Exception as e:
        raise RuntimeError(
            f"Playwright could not attach to Chrome at {CDP_URL}: {e}\n"
            "If a normal Chrome is already open, this debug instance must use "
            f"--user-data-dir={CHROME_USER_DATA_DIR}."
        ) from e
    if not browser.contexts:
        raise RuntimeError("Chrome opened, but no browser context was found.")
    return browser
