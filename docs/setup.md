# Setup

Local install, environment, tests, and pipeline commands. How the pipeline works: [architecture.md](./architecture.md) and [pipeline.md](./pipeline.md). Deploying to Vercel + Neon: [deploy.md](./deploy.md). Job sources: [job_sources.md](./job_sources.md).

## 1. Install

Needs Node 22, pnpm 10 and Docker. Python 3.12 is only needed for the LinkedIn / Indeed browser scrapers and the contract / E2E test runners.

```bash
pnpm install                          # also runs prisma generate
pnpm db:up                            # local Postgres 16 on 127.0.0.1:54329
```

`pnpm db:up` creates two databases: `tracker_dev` (your data) and `tracker_test` (contract and E2E fixtures). `pnpm db:down` stops the container; the data stays in the `pgdata` volume.

For the browser scrapers and the test runners:

```bash
pip3 install -r requirements-dev.txt   # includes requirements.txt
pip3 install --no-deps -e .   # makes src/ importable for the scrapers
playwright install chromium   # used by the E2E tests
```

## 2. Environment

Three files, one per consumer. Each has an `.env.example` next to it. Never commit the real files.

| File | Read by | Main variables |
|---|---|---|
| `.env` | `pnpm pipeline …`, Python scrapers | `DATABASE_URL`, `OPENAI_API_KEY`, `MATCH_*`, `TELEGRAM_*` |
| `apps/web/.env.local` | Next.js tracker | `DATABASE_URL`, `DIRECT_DATABASE_URL`, `SESSION_SECRET`, `TRACKER_USERNAME`, `TRACKER_PASSWORD_HASH`, `AGENT_API_TOKEN` |
| `packages/db/.env` | Prisma CLI | `DATABASE_URL`, `DIRECT_DATABASE_URL` |

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp packages/db/.env.example packages/db/.env
```

The pipeline also reads `apps/web/.env.local`; a variable already set in the shell wins over both files.

| Variable | Role |
|---|---|
| `DATABASE_URL` | Postgres. On Vercel: Neon's **pooled** string with `&pgbouncer=true` |
| `DIRECT_DATABASE_URL` | Postgres without the pooler: migrations, pipeline |
| `OPENAI_API_KEY` | Matching and the scrape-time title check |
| `AI_MODEL` | Scrape-time title check only (default `gpt-4.1-mini`) |
| `MATCH_JOB_MODEL` | Matcher layer 1: label the job (default `gpt-5.4-mini`) |
| `MATCH_COMPANY_MODEL` | Matcher layer 2: company lookup (default `gpt-5.4-mini`) |
| `MATCH_REASONING` | Reasoning effort for the matcher (default `low`) |
| `MATCH_THRESHOLD` | Score needed to enter the Tracker (default `7.0`) |
| `SESSION_SECRET` | Session cookie encryption, 32+ characters (`openssl rand -base64 48`) |
| `TRACKER_USERNAME` / `TRACKER_PASSWORD_HASH` | Web UI login (required) |
| `AGENT_API_TOKEN` | Bearer token for `POST /api/agent/jobs`; unset → 503 |
| `TELEGRAM_*` | Daily match digest |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Optional, paid source |
| `TRACKER_READ_ONLY` | `1` blocks every write in the web app |

Generate the password hash (bcrypt, cost 12):

```bash
cd apps/web
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'your-password'
```

In `apps/web/.env.local`, write every `$` of the hash as `\$`: Next.js expands `$` in `.env` files and would cut the hash short. On Vercel, paste the hash as is.

## 3. Database

```bash
pnpm db migrate:dev        # apply migrations to tracker_dev
```

Schema: [pg-schema.md](./pg-schema.md) and `packages/db/prisma/schema.prisma`. For Neon, use `migrate:deploy` with the direct string ([deploy.md](./deploy.md)).

## 4. Profile and rules

- `docs/user_profile.md` — CV the model reads (gitignored; on GitHub Actions it comes from the `USER_PROFILE_MD` secret)
- `docs/matching_rules.md` — hard fails and label schema
- `MATCH_WEIGHTS` in `packages/matching/src/weights.ts` — how labels become a score
- Keywords and title gates: `packages/pipeline/src/config.generated.json`, exported from `src/core/config.py` by `scripts/tools/export_pipeline_config.py`

## 5. Run it

```bash
pnpm pipeline sources --dry-run --no-match   # preview, no writes, no AI
pnpm pipeline sources                        # fetch + match + Telegram
pnpm pipeline sources --sources arbeitnow,ats --days 3 --no-telegram
pnpm pipeline match --limit 3                # score 3 unanalysed postings
pnpm pipeline scrape --days 1                # LinkedIn + Indeed via debug Chrome (Mac)
pnpm --filter @tracker/web dev               # Tracker at http://localhost:3000
```

All commands and flags: [pipeline.md](./pipeline.md). Raise `MATCH_THRESHOLD` for fewer, stricter Tracker cards.

## 6. Tests

The Next.js app is covered by **Vitest unit tests** (`apps/web/test`, `packages/*/test`) and **Playwright e2e** (`tests/e2e`, against Next.js + the local test Postgres). Run the suite for the area you changed, not the whole tree.

Python unit tests under `tests/test_*.py` belong to the old Flask app, except the **page scrapers** (`./scripts/run_tests.sh scrape`).

```bash
./scripts/run_tests.sh              # list suites
./scripts/run_tests.sh fetch        # Fetch details / Run AI / batch
./scripts/run_tests.sh tracker      # Jobs list, cards, timeline, filters, Overview
./scripts/run_tests.sh log-job
./scripts/run_tests.sh unmatched
./scripts/run_tests.sh timeouts
./scripts/run_tests.sh matching     # AI matcher + Run AI
./scripts/run_tests.sh scrape       # pipeline sources + Python page scrapers
./scripts/run_tests.sh ui
./scripts/run_tests.sh unit         # every Vitest package + apps/web
```

| Layer | Command | What it covers |
|---|---|---|
| One area (unit + e2e) | `./scripts/run_tests.sh <suite>` | See `./scripts/run_tests.sh` with no args |
| Vitest (Next.js + packages) | `./scripts/run_tests.sh unit` | `apps/web/test`, `packages/*/test` |
| One web unit file | `pnpm --filter @tracker/web test -- test/fetch-targets.test.ts` | |
| Type check | `pnpm -r --if-present typecheck` | |
| API contract snapshots | `./scripts/run_contract_next.sh` | JSON vs Flask snapshots |
| Browser E2E (Playwright) | `./scripts/run_e2e_next.sh` | Click the UI, assert Postgres |
| One e2e page | `./scripts/run_tests.sh unmatched` | The page's e2e file |
| One e2e file | `./scripts/run_e2e_next.sh test_timeouts_e2e.py` | |
| Extra `-k` | `./scripts/run_tests.sh tracker -k chip` | AND-narrows inside that suite's files |

E2E files are split by page under `tests/e2e/`:

| File | Page / actions |
|---|---|
| `test_login_e2e.py` | Login, wrong password, logout |
| `test_tracker_list_e2e.py` | Chips, search, filters, layout, select, pagination, collapse |
| `test_tracker_card_e2e.py` | Timeline (incl. datetime edit, reapplied, offer), notes, Q&A, highlights, edit, replace link, delete |
| `test_tracker_overview_e2e.py` | Overview panels, heatmap (desktop click / phone double-tap), location bubbles, journey i, agent-push banner, Stacks |
| `test_tracker_fetch_e2e.py` | Fetch details, Run AI, batch fetch / AI / delete |
| `test_unmatched_e2e.py` | Search, Can apply, close, source / score / agent filters |
| `test_timeouts_e2e.py` | Add as Not Applied, dismiss, source / status filter |
| `test_log_job_e2e.py` | Lookup, Save Link Only, Scrape & Log, Clear, agent API |
| `test_pages_e2e.py` | Every page loads styled, no JS errors |

Contract and E2E both run against `tracker_test` and need `pnpm db:up` plus `apps/web/.env.contract` (test credentials; see [migration-contracts.md](./migration-contracts.md)). They start their own `next dev`. E2E talks to a local fake OpenAI server (`tests/e2e/fake_openai.py`), so Run AI needs no key and costs nothing.

The contract suite compares the app's JSON with snapshots recorded from the old Flask app; `--update` rewrites them after an intended change.

## Legacy Flask + MongoDB stack

The Python app (`src/web`, `templates/`, `static/`) and its MongoDB scripts stay in the repo until Render and Atlas shut down. They still use the old `MONGO_URI` / `FLASK_SECRET_KEY` settings and commands:

| What | Command |
|---|---|
| Flask UI | `./scripts/start_ui.sh` (port 5050) |
| Python unit tests | `python3 -m unittest discover -s tests` |
| Flask E2E (throwaway `mongod`) | `./scripts/run_e2e.sh` |
| Matcher eval against Tracker decisions | `python3 scripts/tools/eval_matcher.py` |
| Demo database for screenshots | `python3 scripts/db/seed_demo.py`, then `DATABASE_NAME=job_scraper_demo ./scripts/start_ui_demo.sh` |

The Claude Code Stop hook (`scripts/e2e_hook.sh`) runs Vitest, the Python page-scraper tests, and the Next.js e2e suite when `apps/web`, `packages/*`, `src/scrapers`, or `tests` change.

README images go in `docs/images/`: `tracker-flow.gif`, `tracker-desktop.jpg`, `match-detail.png`, `tracker-phone.jpg`.

## Troubleshooting

**Cannot reach the database**

```bash
pnpm db:up
docker compose ps          # postgres should be "healthy"
```

On Neon, add `&connect_timeout=15` to the string: a suspended database needs a few seconds to wake up.

**Login always fails locally**

The hash in `apps/web/.env.local` was cut at a `$`. Write each `$` as `\$`.

**`DATABASE_URL is not set`**

The pipeline reads `.env` and `apps/web/.env.local` from the repo root; Prisma reads `packages/db/.env`.

**OpenAI credits**

If the account runs out, matching stops and the remaining postings stay unanalysed for the next run (`pnpm pipeline match`). Usage: https://platform.openai.com/usage
