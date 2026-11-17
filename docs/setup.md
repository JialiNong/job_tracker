# Setup

Local install, `.env`, tests, and matcher CLI. For how the pipeline works see [architecture.md](./architecture.md). For deploying the web UI see [deployment/RENDER_SETUP.md](./deployment/RENDER_SETUP.md). Job sources: [job_sources.md](./job_sources.md).

## 1. Install

```bash
pip3 install -r requirements.txt
pip3 install --no-deps -e .   # makes src/ importable (core, web, services, …)
playwright install chromium   # used by the E2E tests
```

Python 3.12 is what GitHub Actions uses.

The editable install (`pyproject.toml`) is what lets every script, test and
the web server `import core…` / `import web…` — nothing edits `sys.path`. Keep
it editable: the code finds `templates/`, `static/`, `config/` and `docs/`
next to `src/`. If you see `ModuleNotFoundError: No module named 'core'`, run
the install line again in the Python you are using.

## 2. Configure `.env`

Copy [`.env.example`](../.env.example) and fill in real values. Never commit `.env`.

```bash
cp .env.example .env
```

| Variable | Role |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `OPENAI_API_KEY` | Matching and (optional) scrape-time title check |
| `AI_MODEL` | Scrape-time title check only (default `gpt-4.1-mini`) |
| `MATCH_JOB_MODEL` | Matcher layer 1: label the job (default `gpt-5.4-mini`) |
| `MATCH_COMPANY_MODEL` | Matcher layer 2: company lookup (default `gpt-5.4-mini`) |
| `MATCH_REASONING` | Reasoning effort for the matcher (default `low`) |
| `MATCH_THRESHOLD` | Score needed to enter the Tracker (default `7.0`) |
| `TRACKER_USERNAME` / `TRACKER_PASSWORD_HASH` | Web UI login (required) |
| `FLASK_SECRET_KEY` | Session signing; auto-generated if unset |
| `TELEGRAM_*` | Daily match cards and bot commands |
| `AGENT_API_TOKEN` | Bearer token for `POST /api/agent/jobs` (Cursor / Claude daily screens) |

Generate the password hash:

```bash
python3 scripts/tools/generate_password_hash.py
```

Copy the `TRACKER_PASSWORD_HASH=...` line into `.env`.

## 3. Profile and rules

- `docs/user_profile.md` — CV the model reads (gitignored)
- `docs/matching_rules.md` — hard fails and label schema
- `MATCH_WEIGHTS` in `src/core/config.py` — how labels become a score

## 4. Test run

```bash
python3 src/sources/run_sources.py --dry-run    # preview, no writes
python3 src/sources/run_sources.py              # fetch + match + Telegram
python3 src/matching/ai_matcher.py -l 3         # score 3 unmatched jobs
./scripts/start_ui.sh                           # Tracker at http://127.0.0.1:5050
```

`ai_matcher.py` options: `-l` / `--limit`, `-s` / `--source`, `-t` / `--threshold` (default `7.0`).

```bash
python3 src/matching/ai_matcher.py -l 5
python3 src/matching/ai_matcher.py -s arbeitnow -t 7.5
```

Keywords and title gates live in `src/core/config.py` (`DEFAULT_KEYWORDS`, `TITLE_AUTO_PASS_KEYWORDS`, `TITLE_EXCLUDE_KEYWORDS`). Raise `MATCH_THRESHOLD` for fewer, stricter Tracker cards.

## 5. Demo database (screenshots / GIFs)

Seed a **separate** Mongo database of fictional jobs so Overview looks full without real application data:

```bash
python3 scripts/db/seed_demo.py
DATABASE_NAME=job_scraper_demo ./scripts/start_ui_demo.sh
```

This writes `job_scraper_demo` and refuses the production name `job_scraper` unless you pass `--force`. The demo UI defaults to port 5051.

README images go in `docs/images/`:

| File | What to show |
|---|---|
| `tracker-flow.gif` | New match → reasons → change status |
| `tracker-desktop.jpg` | Desktop overview |
| `match-detail.png` | Job detail drawer |
| `tracker-phone.jpg` | Phone layout |

## 6. Tests

| What | Command |
|---|---|
| Unit tests | `python3 -m unittest discover -s tests` |
| Browser E2E | `./scripts/run_e2e.sh` (add `-v` for each test name) |

E2E (`tests/e2e/`) starts a throwaway MongoDB on a random local port, the real web server, and headless Chrome, then clicks through login, application progress, notes, edit, delete, Unmatched → Can Apply, Timeouts → Add, Log Job, and the agent API. It **never touches production data**: the harness refuses to start unless the server points at `127.0.0.1` and a database ending in `_e2e`, with AI / Telegram keys blank.

Needs `mongod` (`brew install mongodb/brew/mongodb-community`; no service needs to run) and Playwright.

**Claude Code Stop hook:** `.claude/settings.json` runs `scripts/e2e_hook.sh` when a turn changes `src/web`, `src/core`, `templates`, `static`, or `tests`. Failures go back to Claude to fix. Last output: `logs/e2e_last.log`.

Check a matcher change against Tracker decisions before relying on it:

```bash
python3 scripts/tools/eval_matcher.py
python3 scripts/tools/eval_matcher.py --unapplied --limit 100
```

## Troubleshooting

**MongoDB connection failed**

```bash
python3 -c "from core.db_mongo import init_db; init_db(); print('OK')"
```

Check `MONGO_URI` and that your IP is allowed in Atlas Network Access.

**No new jobs to process**

Existing jobs already have `matched_at`. Fetch today's listings first:

```bash
python3 src/sources/run_sources.py
```

**OpenAI credits**

If the account runs out, matching stops and remaining jobs stay without `matched_at` for the next run. Usage: https://platform.openai.com/usage
