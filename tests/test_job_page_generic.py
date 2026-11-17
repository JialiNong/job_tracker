"""Generic / Glassdoor / Indeed Fetch-details scrape (no live Chrome)."""
from __future__ import annotations

import unittest
from contextlib import ExitStack, contextmanager
from unittest.mock import patch

from scrapers.job_page import (  # noqa: E402
    glassdoor_detail_ready,
    is_glassdoor_url,
    scrape_generic_job,
    scrape_indeed_job,
    scrape_job_page,
)

GD_URL = (
    "https://www.glassdoor.de/job-listing/frontend-engineer-acme-"
    "JV_IC2622109_KO0,18_KE19,23.htm?jl=1001234567890"
)
GD_JD = (
    "Acme is hiring a Frontend Engineer to build design systems in React. "
    "You will own TypeScript UI, accessibility, and the public website. "
    "Experience with CSS and component libraries is required for this role."
)


class FakeLocator:
    def __init__(self, count: int = 0, text: str = "", html: str = "", visible: bool = True):
        self._count = count
        self._text = text
        self._html = html
        self._visible = visible

    @property
    def first(self):
        return self

    def count(self):
        return self._count

    def is_visible(self):
        return self._visible

    def inner_text(self, timeout=0):
        return self._text

    def inner_html(self, timeout=0):
        return self._html or f"<p>{self._text}</p>"

    def click(self, timeout=0):
        return None


class FakeMouse:
    def wheel(self, *_args, **_kwargs):
        return None


class FakePage:
    def __init__(self, tree=None, html="", title="Frontend Engineer | Acme | Glassdoor"):
        self.tree = tree or {}
        self.html = html
        self.gotos = []
        self.mouse = FakeMouse()
        self._title = title
        self.goto_error = None

    def goto(self, url, **kwargs):
        self.gotos.append(url)
        if self.goto_error:
            raise self.goto_error

    def wait_for_selector(self, sel, timeout=0):
        return True

    def wait_for_load_state(self, *args, **kwargs):
        return True

    def locator(self, sel):
        return self.tree.get(sel, FakeLocator())

    def content(self):
        return self.html

    def title(self):
        return self._title

    def is_closed(self):
        return False


@contextmanager
def _page_helpers():
    """Stub the browser / text helpers job_page imports (no sleeps, fixed JD)."""
    with ExitStack() as stack:
        stack.enter_context(patch("scrapers.job_page.pause", lambda *a, **k: None))
        stack.enter_context(patch(
            "scrapers.job_page.safe_text",
            lambda loc, timeout=5000: getattr(loc, "_text", "") or "",
        ))
        stack.enter_context(patch("scrapers.job_page.strip_html", lambda html: GD_JD))
        stack.enter_context(patch(
            "scrapers.job_page.extract_indeed_detail_meta", lambda page: ("Acme", "Berlin"),
        ))
        yield


class GlassdoorUrlTests(unittest.TestCase):
    def test_hosts(self):
        self.assertTrue(is_glassdoor_url(GD_URL))
        self.assertTrue(is_glassdoor_url("https://glassdoor.com/Job/listing.htm"))
        self.assertTrue(is_glassdoor_url("https://www.glassdoor.co.uk/job-listing/x.htm"))
        self.assertFalse(is_glassdoor_url("https://www.linkedin.com/jobs/view/1/"))
        self.assertFalse(is_glassdoor_url("https://careers.example.com/glassdoor-intern"))


class GlassdoorScrapeTests(unittest.TestCase):
    def _page(self):
        return FakePage({
            '[data-test="job-title"]': FakeLocator(1, "Frontend Engineer"),
            '[data-test="employer-name"]': FakeLocator(1, "Acme"),
            '[data-test="location"]': FakeLocator(1, "Berlin, Germany"),
            '[data-test="jobDescriptionText"]': FakeLocator(1, GD_JD, html=f"<div>{GD_JD}</div>"),
        })

    def test_extracts_glassdoor_selectors(self):
        page = self._page()
        with _page_helpers(), patch(
            "scrapers.job_page.wait_for_job_content", return_value="ready"
        ) as wait:
            job = scrape_generic_job(page, GD_URL)
        wait.assert_called_once()
        self.assertEqual(wait.call_args.kwargs["site"], "Glassdoor")
        self.assertEqual(job["title"], "Frontend Engineer")
        self.assertEqual(job["company"], "Acme")
        self.assertEqual(job["location"], "Berlin, Germany")
        self.assertIn("Frontend Engineer", job["description"])
        self.assertEqual(job["source"], "manual")
        self.assertEqual(job["scrape_warning"], "")

    def test_goto_timeout_still_extracts(self):
        page = self._page()
        page.goto_error = TimeoutError("Timeout 40000ms exceeded")
        with _page_helpers(), patch(
            "scrapers.job_page.wait_for_job_content", return_value="ready"
        ):
            job = scrape_generic_job(page, GD_URL)
        self.assertIsNotNone(job)
        self.assertIn("Frontend Engineer", job["description"])
        self.assertEqual(job["scrape_warning"], "")

    def test_short_page_returns_warning_not_none(self):
        page = FakePage({"body": FakeLocator(1, "Sign in")})
        with _page_helpers(), patch(
            "scrapers.job_page.wait_for_job_content", return_value="timeout"
        ), patch("scrapers.job_page._extract_main_text_from_html", return_value=""), patch(
            "scrapers.job_page._fallback_page_text", return_value="Sign in"
        ), patch("scrapers.job_page._extract_glassdoor_fields", return_value=("", "", "", "")):
            job = scrape_generic_job(page, GD_URL)
        self.assertIsNotNone(job)
        self.assertEqual(job["description"], "")
        self.assertIn("Glassdoor", job["scrape_warning"])
        self.assertIn("too short", job["scrape_warning"])

    def test_scrape_job_page_routes_glassdoor_to_generic(self):
        page = self._page()
        with patch("scrapers.job_page.scrape_generic_job", return_value={"ok": True}) as generic:
            out = scrape_job_page(page, GD_URL)
        generic.assert_called_once()
        self.assertEqual(out, {"ok": True})

    def test_login_wall_is_not_ready(self):
        page = FakePage({
            "h1": FakeLocator(1, "Sign In to Glassdoor"),
            "body": FakeLocator(
                1,
                "Sign in to see job details Continue with Google Create an account to see",
            ),
        })
        self.assertFalse(glassdoor_detail_ready(page))


class IndeedWaitTests(unittest.TestCase):
    def test_does_not_bail_on_challenge_before_wait(self):
        page = FakePage({
            '[data-testid="vj-job-title"]': FakeLocator(1, "Frontend Engineer"),
            "#jobDescriptionText": FakeLocator(1, GD_JD, html=f"<p>{GD_JD}</p>"),
        })
        with _page_helpers(), patch(
            "scrapers.job_page.wait_for_job_content", return_value="clicked"
        ) as wait, patch(
            "scrapers.job_page.is_indeed_challenge_page", return_value=True
        ):
            job = scrape_indeed_job(page, "https://de.indeed.com/viewjob?jk=abcdef123456")
        wait.assert_called_once()
        self.assertEqual(wait.call_args.kwargs["site"], "Indeed")
        self.assertEqual(job["source"], "indeed")
        self.assertIn("Frontend Engineer", job["description"] or job["title"])


if __name__ == "__main__":
    unittest.main()
