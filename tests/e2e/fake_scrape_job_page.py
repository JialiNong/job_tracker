#!/usr/bin/env python3
"""
A stand-in for scripts/tools/scrape_job_page.py in the Fetch details e2e test.

The Next.js app runs it instead of the real scraper (FETCH_DETAILS_SCRAPER in
scripts/run_e2e_next.sh), so the test exercises the real route, child process,
JSON contract and Postgres write without opening Chrome or any website.
Same output contract: one JSON line on stdout, noise on stderr.

A URL containing "scrape-fails" answers like a failed scrape.
"""
import json
import sys

TITLE = "E2E Fetched Backend Engineer"
COMPANY = "E2E Fetched GmbH"
LOCATION = "Hamburg, Germany"
DESCRIPTION = (
    "E2E fetched description. We are hiring a backend engineer to build Node.js and TypeScript "
    "services for our logistics platform. You will design APIs, own PostgreSQL schemas and ship "
    "features with a small product team in Hamburg. "
) * 4

url = sys.argv[1] if len(sys.argv) > 1 else ""
print(f"  fake scraper opening {url}", file=sys.stderr)
if "scrape-fails" in url:
    print(json.dumps({"ok": False, "error": "E2E fake scrape failure"}))
    sys.exit(1)
print(json.dumps({"ok": True, "job": {
    "title": TITLE, "company": COMPANY, "location": LOCATION,
    "description": DESCRIPTION, "applicants": "12 applicants", "link": url,
}}))
