"""Reach the user's debug Chrome (CDP) from a service. Playwright is imported lazily."""
from __future__ import annotations

from core.browser import connect_browser


def load_playwright():
    """Return sync_playwright. Raises ImportError on hosts without Playwright (Render)."""
    from playwright.sync_api import sync_playwright
    return sync_playwright


def playwright_available() -> bool:
    try:
        load_playwright()
    except ImportError:
        return False
    return True


def first_cdp_page(playwright, site_name: str = "job sites"):
    """First tab of the debug Chrome, opening one if none exists. Raises RuntimeError."""
    browser = connect_browser(playwright, site_name)
    context = browser.contexts[0]
    return context.pages[0] if context.pages else context.new_page()
