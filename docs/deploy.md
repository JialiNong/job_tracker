# Deploy: Vercel + Neon, parallel week, cutover (phase 5)

The Next.js app runs on Vercel, the data lives in Neon Postgres. During the
parallel week the Flask app (Render + MongoDB Atlas) stays the place where
you work; a nightly job copies Mongo into Neon so the new app shows the same
data, read-only. At the cutover Neon becomes the live database.

## 1. Neon

1. Create the project in **AWS Europe Central (Frankfurt)**, the region the
   Vercel functions run in (`apps/web/vercel.json`: `fra1`). Every page load
   makes several queries; a database on another continent makes each one
   slow.
2. On the dashboard, **Connect** shows two connection strings:
   - **Pooled** (host contains `-pooler`): for the app on Vercel. Add
     `&pgbouncer=true&connect_timeout=15` to the end.
   - **Direct** (no `-pooler`): for migrations, the nightly sync and the
     pipeline. Add `&connect_timeout=15`.

   `connect_timeout` gives Neon time to wake up a suspended database.

## 2. Tables and the first copy (from your computer)

```bash
export DIRECT_DATABASE_URL='postgresql://…direct…'   # quotes: the URL has & and ?
DATABASE_URL="$DIRECT_DATABASE_URL" pnpm db migrate:deploy   # creates the tables
DATABASE_URL="$DIRECT_DATABASE_URL" pnpm db from-mongo --replace-remote   # copies Mongo (MONGO_URI from .env)
```

`from-mongo` only reads Mongo. It ends with checks (row counts, cards,
scores) that must all say `ok`. It replaces every table in the target, so a
non-local `DATABASE_URL` needs `--replace-remote`: after the cutover, never
run it against Neon.

## 3. Vercel

**Add New → Project →** import the GitHub repository, then:

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Framework Preset | Next.js (detected) |
| Build / Install Command | leave the defaults |
| Include files outside the root directory | on (default): the build copies `static/` from the repo root |

Environment variables (Production and Preview):

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** string (with `pgbouncer=true`) |
| `DIRECT_DATABASE_URL` | Neon **direct** string |
| `SESSION_SECRET` | `openssl rand -base64 48` (32+ characters; keep it secret) |
| `TRACKER_USERNAME` | same as on Render |
| `TRACKER_PASSWORD_HASH` | same bcrypt hash as on Render (paste as is) |
| `TRACKER_READ_ONLY` | `1` during the parallel week |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (uses the pnpm version pinned in `package.json`) |
| `MATCH_THRESHOLD` | optional, default `7.0` |

Run AI is local only: the Lingua language model's Linux binary is 277 MB,
over Vercel's 250 MB function limit, so `next.config.ts` leaves it out of
the Vercel build and the hosted Run AI button answers "runs on your computer".

Not set on purpose during the week: `AGENT_API_TOKEN` (agents keep pushing
to the Flask app; the agent API answers 503) and `OPENAI_API_KEY` (Run AI
runs locally).

Deploy, open the URL, log in with the Tracker login.

## 4. GitHub (nightly sync)

Repository **Settings → Secrets and variables → Actions**:

- Secret `DIRECT_DATABASE_URL`: the Neon direct string.
- Secret `DATABASE_URL`: the Neon direct string too (for
  `api-sources-pg.yml`, used after the cutover).
- Variable `MONGO_SYNC` = `on`: lets the 02:37 schedule of
  `sync-mongo-to-pg.yml` run. Start one run by hand (**Actions → Sync Mongo
  to Postgres → Run workflow**) to check it.

The sync logs counts only (`--quiet`): no job names or ids in the Actions log.

## 5. During the week

- Work in the Flask app as usual. The new app is read-only: a change there
  is refused with "make this change in the current Tracker" (423), because
  the next sync would overwrite it.
- Compare both apps after a sync (GET requests only):

  ```bash
  python3 tests/contract/compare_live.py \
      --old https://<render-app>.onrender.com --new https://<vercel-app>.vercel.app
  ```

  The username comes from `TRACKER_USERNAME` in `.env`; the password is
  asked for (not echoed, so it stays out of the shell history).

  Differences right after an edit in the Flask app are expected until the
  next sync. Anything else: note it and fix it before the cutover.

- Compare the scrapers (once or twice, same day). Never point the new
  pipeline at Neon now: the nightly sync overwrites it. Use the local
  Docker Postgres (`apps/web/.env.local` already points there):

  ```bash
  pnpm db:up
  pnpm db from-mongo                      # snapshot; note the time, e.g. 10:00
  ./scripts/run_jobs.sh                   # old pipeline -> Mongo; wait until it ends
  PYTHON=/opt/miniconda3/bin/python3 pnpm pipeline scrape   # new -> local Postgres
  PYTHONPATH=src python3 scripts/tools/compare_pipeline_runs.py --since "2026-11-21 10:00"
  ```

  Order matters: the snapshot first (otherwise the new run finds every
  posting already saved and adds nothing), the new run after the old one
  (both share `logs/pipeline.pid`). `PYTHON` must be an interpreter with
  `psycopg` installed. The new run sends its own Telegram digest.
  Expected differences: the new run scores LinkedIn "Viewed" cards (more
  jobs), a few postings appear in one run only (search results change
  between runs), AI scores move a little. Investigate a source with far
  fewer postings, or many jobs that land in Tracker on one side and
  Unmatched on the other.

## 6. Cutover (one evening)

The workflow changes live on one branch (`chore/cutover-workflows`): it
deletes `sync-mongo-to-pg.yml`, moves the daily schedule from
`api-sources.yml` to `api-sources-pg.yml`, and makes `stack-stats.yml`
manual (the Next.js app refreshes its own Stacks numbers). Merging it is
the point of no return, so merge only after step 2.

Before you start: a backup of Atlas (snapshot or `mongodump`).

1. Stop writing to the Flask app. Run **Sync Mongo to Postgres** by hand,
   wait for all checks `ok`.
2. Neon: create a branch from `main` (e.g. `pre-cutover`) as a snapshot.
   Set the GitHub variable `MONGO_SYNC` to `off`. From now on Neon is the
   live data; a sync would destroy every change made after it.
3. Merge `chore/cutover-workflows` into `main` and push. Check that the
   GitHub secret `DATABASE_URL` (Neon direct string) exists: the daily
   `api-sources-pg.yml` run needs it.
4. Vercel: delete `TRACKER_READ_ONLY`; add `AGENT_API_TOKEN` (the same token
   as on Render) and redeploy. Point the agents (the Cursor / Claude daily
   job push) at the Vercel URL.
5. Your computer: put `DATABASE_URL` (Neon direct string) in the repo-root
   `.env`; the pipeline reads it before `apps/web/.env.local`. Add
   `TRACKER_PIPELINE=postgres` to the same file and restart the Telegram
   bot, so `/jobs` runs `pnpm pipeline scrape` instead of
   `scripts/run_jobs.sh` (docs/pipeline.md).
6. Keep Render and Atlas running, untouched, for two weeks as a fallback,
   then shut them down. Do not log in to the Flask app meanwhile: its
   writes go to Mongo and never reach Neon.

The next day, check: the daily **API job sources (Postgres)** run passed;
the agents' picks show up in the Vercel app; a `/jobs` run added postings
and sent its Telegram digest. (The old Mongo **API job sources** workflow
was removed after cutover.)

## 7. Public demo (separate subdomain)

Interviewers need a login-free Tracker with fictional data. Production stays
on its own Vercel project and Neon database. Soft writes are allowed; a
nightly Action reseeds the demo DB so vandalism does not stick.

### Neon (demo)

1. Create a **second** Neon project (or a second database) in Frankfurt, named
   so the database path ends in `_demo` (e.g. `tracker_demo`).
2. Note the pooled and direct connection strings (same `connect_timeout=15`
   tips as in §1).

```bash
export DIRECT_DATABASE_URL='postgresql://…/tracker_demo?…'
DATABASE_URL="$DIRECT_DATABASE_URL" pnpm --filter @tracker/db exec prisma migrate deploy
DATABASE_URL="$DIRECT_DATABASE_URL" DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" pnpm db demo:seed
```

`pnpm db demo:seed` refuses any database whose name does not end in `_demo`.

### Vercel (demo project)

**Add New → Project** from the same GitHub repo (do not reuse the production
project's env):

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Custom domain | e.g. `demo.your-domain.com` |

Environment variables (Production only):

| Name | Value |
|---|---|
| `DATABASE_URL` | demo Neon **pooled** string |
| `DIRECT_DATABASE_URL` | demo Neon **direct** string |
| `TRACKER_DEMO` | `1` |
| `SESSION_SECRET` | any 32+ character string (login is skipped; iron-session still loads) |
| `TRACKER_USERNAME` | `demo` (unused while `TRACKER_DEMO=1`) |
| `TRACKER_PASSWORD_HASH` | any bcrypt hash (unused) |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |
| `DEMO_WRITE_LIMIT_PER_HOUR` | optional, default `10` — max mutating calls per IP per route family / hour |

Do **not** set on the demo project: `AGENT_API_TOKEN`, `OPENAI_API_KEY`,
`TELEGRAM_*`, or the production `DATABASE_URL`. Agent / Run AI / Fetch details
APIs answer 503; Log Job link-only and status/notes/delete stay open. The
Tracker still shows a **fixed sample** agent-push banner (marked fictional)
so visitors can see the daily digest UI without live ingest.

### GitHub Actions (nightly reseed)

Repository secrets:

| Secret | Value |
|---|---|
| `DEMO_DIRECT_DATABASE_URL` | demo Neon **direct** string |

Workflow: [`.github/workflows/reseed-demo.yml`](../.github/workflows/reseed-demo.yml)
(03:41 UTC daily + **workflow_dispatch**). Run it by hand before an interview
if someone emptied the board.

### Local check

```bash
pnpm db:up
# if the volume predates tracker_demo:
#   docker compose exec postgres psql -U tracker -d postgres -c 'CREATE DATABASE tracker_demo OWNER tracker;'
DATABASE_URL=postgresql://tracker:tracker@127.0.0.1:54329/tracker_demo \
  DIRECT_DATABASE_URL=postgresql://tracker:tracker@127.0.0.1:54329/tracker_demo \
  pnpm --filter @tracker/db exec prisma migrate deploy
DATABASE_URL=postgresql://tracker:tracker@127.0.0.1:54329/tracker_demo \
  DIRECT_DATABASE_URL=postgresql://tracker:tracker@127.0.0.1:54329/tracker_demo \
  pnpm db demo:seed
./scripts/start_web_demo.sh   # http://127.0.0.1:3001 , no login
```

Flask + Mongo screenshot seed remains: `python3 scripts/db/seed_demo.py` and
`./scripts/start_ui_demo.sh` (legacy only).
