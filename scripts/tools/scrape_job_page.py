#!/usr/bin/env python3
"""
Scrape one job page in the debug Chrome and print the result as JSON.

    python scripts/tools/scrape_job_page.py "https://www.linkedin.com/jobs/view/123/"

Used by the Next.js app's Fetch job details (apps/web/src/server/fetch-details.ts),
which saves the result to Postgres itself. This script never touches a database.

stdout carries exactly one JSON line:
    {"ok": true,  "job": {"title", "company", "location", "description", "applicants", "link"}}
    {"ok": false, "error": "..."}
The scraper's own progress lines go to stderr. Exit code 0 on success, 1 otherwise.
Imports come from src/ (pip install -e ., or PYTHONPATH=src as the web app sets it).
"""
from __future__ import annotations

import contextlib
import json
import sys

FIELDS = ("title", "company", "location", "description", "applicants", "link")


def scrape(url: str) -> dict:
    try:
        from services.browser_session import first_cdp_page, load_playwright
        from scrapers.job_page import scrape_job_page
        sync_playwright = load_playwright()
    except ImportError as e:
        return {"ok": False, "error": f"Playwright is not installed for this Python ({e})"}

    with sync_playwright() as playwright:
        try:
            page = first_cdp_page(playwright)
        except Exception as e:
            return {"ok": False, "error": f"Cannot open Chrome: {e}"}
        job = scrape_job_page(page, url)

    if not job or not str(job.get("description") or "").strip():
        return {"ok": False, "error": (job or {}).get("scrape_warning") or "Scraping failed"}
    return {"ok": True, "job": {f: str(job.get(f) or "") for f in FIELDS}}


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("http"):
        print(json.dumps({"ok": False, "error": "Usage: scrape_job_page.py <http(s) URL>"}))
        return 1
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = scrape(sys.argv[1])
    except Exception as e:  # never leave the caller without a JSON answer
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
