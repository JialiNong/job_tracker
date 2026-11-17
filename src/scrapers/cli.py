"""Command-line options shared by the LinkedIn and Indeed scrapers."""
import argparse

from core.config import DEFAULT_KEYWORDS, INDEED_CONFIG


def parse_args():
    """Parse --keywords / --max-pages / --max-jobs / --hours / --days."""
    parser = argparse.ArgumentParser(description="Scrape job listings into MongoDB.")
    parser.add_argument(
        "--keywords",
        "-k",
        nargs="+",
        default=DEFAULT_KEYWORDS,
        help='Search keywords. Example: -k frontend "full stack" "ai engineer"',
    )
    parser.add_argument(
        "--max-pages",
        "-p",
        type=int,
        default=None,
        help=(
            "How many result pages to scrape per keyword. "
            "Default: platform full budget; LinkedIn short windows "
            "(--hours < 24) use fewer pages."
        ),
    )
    parser.add_argument(
        "--max-jobs",
        "-j",
        type=int,
        default=None,
        help="Max job cards to process per page. Platform default if omitted.",
    )
    parser.add_argument(
        "--hours",
        type=float,
        default=None,
        help=(
            "LinkedIn only: posted-within window in hours "
            "(maps to f_TPR=r<seconds>). Default: config 24h."
        ),
    )
    parser.add_argument(
        "--days",
        type=int,
        choices=INDEED_CONFIG["fromage_choices"],
        default=None,
        help="Indeed only: posted-within window in days (fromage). Default: config 1.",
    )
    return parser.parse_args()
