# Pipeline on Postgres (phase 4)

The job pipeline runs from `packages/pipeline` (TypeScript) against the same
Postgres database as the Next.js app. The LinkedIn / Indeed browser scrapers
stay in Python and are not changed: only the five storage functions they
call switch to Postgres.

## Commands

| Command | Replaces | What it does |
|---|---|---|
| `pnpm pipeline scrape [--days 1\|3\|7\|14] [--hours N] [--pages N]` | `scripts/run_jobs.sh` | Debug Chrome, Indeed + LinkedIn lanes in parallel (Python scrapers with `TRACKER_STORE=postgres`), AI matching per source, Telegram digest |
| `pnpm pipeline sources [--sources a,b] [--days N] [--dry-run] [--no-match] [--no-telegram]` | `src/sources/run_sources.py` | Arbeitnow, Bundesagentur, company ATS boards (Adzuna opt-in): filters, save, AI matching, Telegram digest |
| `pnpm pipeline match [--source s] [--limit N] [--threshold 7.0]` | `src/matching/ai_matcher.py` | AI matching for postings never analysed |

Environment: `DATABASE_URL`, `OPENAI_API_KEY`, `TELEGRAM_*`, optional
`MATCH_THRESHOLD`, `MATCH_JOB_MODEL`, `MATCH_COMPANY_MODEL`, `AI_MODEL`,
`ADZUNA_APP_ID` / `ADZUNA_APP_KEY`. The commands read the repo-root `.env`
and `apps/web/.env.local`; variables already set win. `PYTHON` picks the
interpreter for the scrapers (default `python3`).

## How the scrapers write to Postgres

`src/core/db_mongo.py` exports the storage functions the scrapers import
(`init_db`, `save_job`, `is_job_id_exists`, `increment_scraper_stat`,
`save_timeout_job`). With `TRACKER_STORE=postgres` it takes them from
`src/core/pg_store.py` instead. `pnpm pipeline scrape` sets the variable for
the scraper processes only. Unset, everything stays on Mongo, so
`scripts/run_jobs.sh` keeps working unchanged during the parallel week. Both
runners take the same lock (`logs/pipeline.pid`).

## Fetch job details (Tracker)

The Tracker's Fetch job details (one card or the selection) runs only where
the app runs on your computer (`pnpm --filter @tracker/web dev`, localhost:3000).
`POST /api/jobs/<id>/fetch-details` starts `scripts/tools/scrape_job_page.py`
with `PYTHON` (set it in `apps/web/.env.local` to the interpreter that has
Playwright). The script opens the link in the debug Chrome with the unchanged
page scraper and prints one JSON line; the route saves title / company /
location / description to Postgres (status, timeline, notes and AI fields are
untouched, user-typed fields win). On Vercel it answers 503. The e2e suite
swaps in `tests/e2e/fake_scrape_job_page.py` through `FETCH_DETAILS_SCRAPER`.

## Settings shared with Python

Title filters, search keywords, source settings and the scraper page sizes
live in `src/core/config.py`. `packages/pipeline/src/config.generated.json` is
exported from it:

```bash
PYTHONPATH=src python3 scripts/tools/export_pipeline_config.py
```

`tests/test_pipeline_config_export.py` fails when the export is out of date.

## Differences from the Python pipeline

- LinkedIn jobs whose card said "Viewed" are scored. Python only scored
  `status: "new"` rows, and the scraper's own earlier click (a timeout, a
  language skip) is enough to mark a card "Viewed", so good jobs were
  silently never scored. A posting scraped more than 7 days before it is
  scored (`STALE_DAYS`, e.g. the 58 old "Viewed" rows at the cutover) goes to
  Unmatched, not the Tracker, even with a high score.
- LinkedIn cards whose footer says "Applied" are not saved (`pg_store.save_job`):
  jobs applied to on LinkedIn are logged by hand with Log job. Python saved
  them but never scored them; Postgres has no card status column, so the
  matcher could not tell them apart.

- Telegram "this run's matches": Python tagged Tracker rows with a run id;
  the matcher now returns the cards it created and the digest lists those.
- Posting dates with a zone offset are stored as the real instant (Python
  dropped the offset, so a New York 10:00 became 10:00 Berlin).
- Adzuna (opt-in, paid): Python followed each ad to the employer page and
  extracted the full text with trafilatura; the port keeps Adzuna's
  ~500-character teaser, so those jobs are saved as incomplete and the
  matcher skips them without an AI call.
- Salary fields from Bundesagentur / Adzuna are not stored (no column; the
  migration does not carry them either).

## Cutover

1. Set the scrapers' machine to `pnpm pipeline scrape` instead of
   `scripts/run_jobs.sh` (cron / launchd).
2. GitHub: add the `DATABASE_URL` secret; merge `chore/cutover-workflows`,
   which moves the schedule from `api-sources.yml` to `api-sources-pg.yml`
   (docs/deploy.md §6).
3. Telegram bot (`src/tg/bot.py`, stays Python): set `TRACKER_PIPELINE=postgres`
   so `/jobs` starts `pnpm pipeline scrape` instead of `scripts/run_jobs.sh`
   (same arguments). The bot itself does not read Mongo; the Indeed
   "Continue" button works through a local flag file either way.

Tests: `packages/pipeline` (parity with `tests/contract/pipeline_cases.json`,
plus ingest and matcher runs on `tracker_test`), `tests/test_pg_store.py`.
