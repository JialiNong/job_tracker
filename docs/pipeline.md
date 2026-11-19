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

## Settings shared with Python

Title filters, search keywords, source settings and the scraper page sizes
live in `src/core/config.py`. `packages/pipeline/src/config.generated.json` is
exported from it:

```bash
PYTHONPATH=src python3 scripts/tools/export_pipeline_config.py
```

`tests/test_pipeline_config_export.py` fails when the export is out of date.

## Differences from the Python pipeline

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
2. GitHub: add the `DATABASE_URL` secret, move the schedule from
   `api-sources.yml` to `api-sources-pg.yml`.
3. The Telegram bot (`src/tg/bot.py`) still reads Mongo: port or retire it
   before switching Mongo off.

Tests: `packages/pipeline` (parity with `tests/contract/pipeline_cases.json`,
plus ingest and matcher runs on `tracker_test`), `tests/test_pg_store.py`.
