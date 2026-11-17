#!/usr/bin/env python3
"""
Log job URLs into the Tracker from the command line (CLI twin of Log Job).

    python scripts/tools/log_jobs.py "URL1" "URL2"          # Not Applied (pending)
    python scripts/tools/log_jobs.py --status applied "URL1"
    python scripts/tools/log_jobs.py --link-only "URL1"     # no Chrome, no AI
    python scripts/tools/log_jobs.py --file my_urls.txt     # one URL per line

Each URL is opened in the debug Chrome, scraped, AI-matched and saved to
matched_jobs. When Chrome / Indeed / AI fails, the URL is still saved as an
AI-pending stub — use Tracker "Run AI" later. See services.log_job.
"""
import argparse
import sys

from dotenv import load_dotenv

load_dotenv()

from core.db_mongo import init_db  # noqa: E402
from core.manual_log import (  # noqa: E402
    RECOMMENDED_BY_AGENTS,
    normalize_manual_identity,
    save_link_only_urls,
)
from services.log_job import process_urls  # noqa: E402


def read_url_file(path: str) -> list[str]:
    with open(path, "r", encoding="utf-8") as fh:
        return [line.strip() for line in fh if line.strip() and not line.startswith("#")]


def main():
    parser = argparse.ArgumentParser(
        description="Scrape job URLs, AI-match, and save to the tracker "
                    "(default status: pending / Not Applied)."
    )
    parser.add_argument(
        "urls", nargs="*", metavar="URL",
        help="One or more job URLs (LinkedIn, Indeed, or any company careers page)",
    )
    parser.add_argument("--file", "-f", metavar="FILE", help="Text file with one URL per line")
    parser.add_argument(
        "--status", choices=("pending", "applied"), default="pending",
        help="Tracker status after save (default: pending / Not Applied)",
    )
    parser.add_argument(
        "--link-only", action="store_true",
        help="Save URLs to Tracker without scraping or AI (Run AI later from UI)",
    )
    parser.add_argument(
        "--recommended-by", choices=RECOMMENDED_BY_AGENTS, default=None,
        help="Tag the job as recommended by an AI agent",
    )
    parser.add_argument("--title", default=None, help="Optional job title")
    parser.add_argument("--company", default=None, help="Optional company name")
    parser.add_argument("--location", default=None, help="Optional location / address")
    args = parser.parse_args()

    urls: list[str] = list(args.urls)
    if args.file:
        try:
            file_urls = read_url_file(args.file)
        except FileNotFoundError:
            print(f"❌ File not found: {args.file}")
            sys.exit(1)
        urls.extend(file_urls)
        print(f"📂 Loaded {len(file_urls)} URL(s) from {args.file}")

    if not urls:
        parser.print_help()
        sys.exit(0)

    init_db()
    save = save_link_only_urls if args.link_only else process_urls
    results = save(
        urls,
        status=args.status,
        recommended_by=args.recommended_by,
        identity=normalize_manual_identity(args.title, args.company, args.location),
    )
    sys.exit(1 if results["failed"] else 0)


if __name__ == "__main__":
    main()
