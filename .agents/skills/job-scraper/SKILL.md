---
name: job-scraper
description: >-
  Project conventions for the personal job tracker (API/ATS ingest,
  LinkedIn/Indeed scrapers, title filters, Lingua language gate,
  AI matching (model labels + code score), Telegram, Next.js Tracker UI).
  Use whenever editing scrapers, matching, config, shell pipelines, bot
  commands, docs/, architecture, or Tracker UI (apps/web, static/css).
  Enforces English docs/comments, phone vs desktop interaction parity,
  unified phone control sizing, a UI chrome check (`./scripts/check_ui.sh`)
  after UI edits, keeps docs/architecture.md in sync with flow changes,
  and requires an impact check of related UI/data/filters in the same PR.
---

# Job Scraper — Project Skill

Read this skill before changing scrape, filter, match, pipeline, Telegram, or Tracker UI behavior. For Next.js / TypeScript syntax and package layers, also read [nextjs-typescript](../nextjs-typescript/SKILL.md).

Live stack (also in `AGENTS.md` / `README.md`): **Next.js 15 + Postgres** on Vercel/Neon; daily ingest is `packages/pipeline` + `packages/matching`. Flask + Mongo is fallback only.

## Language (hard rule)

All of the following must be **English only**:

- All user-facing UI text (labels, buttons, tooltips, Telegram messages)
- Markdown under `docs/` (architecture, criteria, profile notes, READMEs you add)
- Code comments and docstrings
- Commit messages and PR bodies for this repo
- Log / print messages that explain filter decisions (prefer short English)

Chat replies to the user may follow the user’s language. Repo artifacts stay English.

When translating or rewriting docs, keep technical identifiers unchanged (`run_jobs.sh`, `evaluator`, collection / table names, env vars).

## Keep architecture in sync (hard rule)

Canonical flow doc: [`docs/architecture.md`](../../../docs/architecture.md). Entry points and hosting: `README.md` (some architecture diagrams still show Flask/Mongo — prefer README for those).

**After any change that alters how the system works, update `docs/architecture.md` in the same turn** — do not wait to be asked. Trigger examples:

- New / renamed / removed CLI, shell script step, or Telegram command
- Scraper order, parallelism, time window (24h / 12h), or keyword strategy
- Title filter stages, exclude lists, AI title check behavior
- Language detection (`isNonEnglishJobDetail` / `is_non_english_job_detail`)
- Matcher rules (`docs/matching_rules.md`), label schema, `MATCH_WEIGHTS`, threshold
- Postgres tables / important fields written by scrapers or matcher
- Web UI funnel metrics that map to pipeline stages

Update checklist:

1. Adjust the relevant mermaid diagram(s) and tables
2. Fix the one-line summary at the bottom if the funnel changed
3. Keep Full vs Quick differences accurate
4. Keep the “two German-related gates” section accurate if either gate changed

If the change is docs-only typography with no flow change, skip the architecture update.

## Impact check (hard rule)

Before finishing any feature or change, check existing related functionality and update it **in the same PR**. Do not ship a new field, status, flag, or form control that leaves a neighbor (Clear, filters, counts, merge, Vercel vs local, …) stale for a follow-up request.

This is the usual miss: the new path works in isolation, and an older sibling still assumes the previous shape. Examples from this tracker:

- Log Job gained title / company / location, Recommended by, and status — Clear still reset only the URL box
- Side statuses (`unsuitable` / `closed` / …) stopped matching Interview and other stage filters / counts
- Batch Fetch-details checkboxes gated on `recommended_by` and skipped older untagged link-only stubs
- Link-only save imported Playwright at module load, which breaks where Chrome is absent

### Checklist (use every row that applies)

| You touched… | Also update / verify in this PR |
|--------------|----------------------------------|
| Form fields | clear / reset, defaults, validation, edit / prefill, save payload, backend persistence, display on cards / detail, search / filters / counts / stats, export |
| New data fields | old records without the field (backfill-free fallbacks), API responses, scrape / fetch merge rules (**do not overwrite user input**) |
| New statuses / flags | filters, counts, badges, stats, timelines |
| UI | desktop + mobile (~375px), toolbar consistency with sibling pages; see **Web UI** below |
| Environments | local vs Vercel (no Lingua on Vercel — Run AI stays “runs locally”; do not bundle Playwright into the web app) |
| Tests | the affected neighbors, not only the new happy path. `./scripts/run_tests.sh <suite>` |

**Grep** every touched function, field, and component name before finishing. In the PR body and the final report, list the related areas you checked.

A short always-applied pointer lives in [`.cursor/rules/impact-check.mdc`](../../../.cursor/rules/impact-check.mdc).

## Web UI (hard rule)

Apply whenever editing Tracker React (`apps/web/src/components`, `apps/web/src/app`) or `static/css/*` — not only when the user mentions mobile.

Live UI is **React**. Styles still live in `static/css/` (copied into `apps/web/public/static` on dev/build). Do not restyle with Tailwind or a new component library. TypeScript structure: [nextjs-typescript](../nextjs-typescript/SKILL.md).

### Phone vs desktop interaction

Phones have **no hover**. Do not ship desktop-only affordances (`:hover` tooltips, hover-to-reveal detail, click-immediately-navigates) without a touch path.

| Desktop | Phone (default) |
|---------|-----------------|
| Hover shows detail / count / preview | Single tap shows the same detail |
| Click navigates or opens a filtered view | Double-tap (or an explicit link/button) navigates |
| Copy says “hover” | Copy says “tap” (`TOUCH_UI` / `POINT_VERB` / `[data-point-verb]`) |

Patterns already in the Tracker:

- Detect touch with `TOUCH_UI` / `@media (hover: none)` (not merely `max-width`)
- Dual hints: `.cal-hint-hover` / `.cal-hint-touch` (and similar) so copy matches the input mode
- Heatmap: tap → day panel; double-tap → that day’s applied filter; desktop keeps hover + click-to-open

When adding a new hover-driven control, implement the touch equivalent **in the same PR** and update visible hints.

### Unify control sizing (do not patch one button)

If the user points at one tall / short / uneven control on phone, **do not only fix that node**. Treat it as a density/token problem for the whole surface.

1. Prefer shared tokens — phone control height is `--phone-ctrl-h` in `static/css/base.css` (currently `30px`).
2. Grep sibling controls on the same page and parallel pages (`/`, `/unmatched`, `/timeouts`, `/manual-apply`): toolbar buttons, selects, filter chips, Save/Add, close (×), batch bar, list row actions.
3. Remove one-off `min-height: 44px` (or similar) touch mins that fight the shared token unless there is an explicit a11y reason.
4. Verify ~375px width: controls should share one visual height rhythm, not a mix of “fixed this one” outliers.

Same idea for color/weight (e.g. pale Save buttons): match the established solid primary style across Save / Add / confirm actions, not only the button named in chat.

### UI chrome check (different layer from E2E)

`tests/e2e` is for **data**: click a real Next.js flow, then assert Postgres. Do not put overlay / viewport / select-centering contracts there.

After any edit under `apps/web/src/components`, `apps/web/src/app`, `templates/`, `static/css/`, or `static/js/`, run **`./scripts/check_ui.sh`** in the same turn (throwaway DB + server; never the real DB). It checks:

| Surface | Phone (~390×844) | Desktop (~1280×800) |
|---------|------------------|---------------------|
| Filters | fixed sheet in viewport, scrim, body lock, count label, custom date, Escape + tap-scrim close; selecting a preset closes the pop; Custom Time / Custom Score keep it open; date/score extras stay inside the panel | absolute dropdown, no scrim/lock, click-outside close; same select-closes / custom-stays-open / in-panel date contract |
| Job details | sheet in viewport, mask above it, tap scrim closes | side drawer (`top: 0`), no mask, page still scrolls |
| Log Job / Timeouts selects | shared `--phone-ctrl-h` recipe (appearance none, padding, 16px) | (phone recipe only) |
| Unmatched Filters | same sheet contract + custom score | — |
| Batch bar / timeline modal | bar stays on screen | datetime modal z-index above the drawer |
| Overview | Jobs status chips (`#statsBar`) hidden; they return on Jobs | same |

Look at the screenshots under the path the script prints (`/tmp/job-ui-chrome/` unless `UI_CHECK_OUT` is set). A green exit code is not a substitute for a visual miss (text sitting high, mask too faint).

If the script fails, fix the UI and re-run before finishing. Also run the page suite (`./scripts/run_tests.sh tracker|…`). Mention both in the final report.

The chrome script still boots the Flask markup that those CSS contracts were written against. **Do not “fix” Flask templates as the live UI.** If you change React ids/classes that the CSS depends on, keep the class names or update both CSS and the chrome checks.

### First-load request order

On Tracker cold entry, **`/api/jobs` is critical path**. Chips (`/api/stats`) and Overview (journey / heatmap / locations / flow) load **after** the first job list. Do not reintroduce parallel `/api/stats` on init without a reason.

## Matching source of truth

- The model only **labels** a job (`packages/matching`, rules in [`docs/matching_rules.md`](../../../docs/matching_rules.md)) and looks up the company; **code** turns labels into a score with `MATCH_WEIGHTS` in `packages/matching/src/weights.ts`.
- Candidate CV lives in `docs/user_profile.md` (gitignored).
- Preference changes (e.g. "hardware lower") go into `MATCH_WEIGHTS`, not prompts. New label fields go into the matching schema **and** `matching_rules.md`.
- Backend policy: only explicit required / must / strong non-Node backend (`required_non_js`) fails; listed-only (`implied_non_js`) is a −1 gap; ideally / e.g. / duties / company stack pass.
- Validate rule or weight changes with `python3 scripts/tools/eval_matcher.py` (Tracker decisions) before shipping.
- Python `src/matching/evaluator.py` is the scrape-era port. Production ingest uses TypeScript. If you change weights or labels, keep both aligned until the Python path is gone.

## Pipeline mental model (do not confuse)

One-line funnel (must stay true in architecture + code):

> Title gates (exclude → TITLE_AUTO_PASS_KEYWORDS → AI title) → click detail → non-English JD discarded (even if completeness is incomplete) → English JD saved → matcher skips empty / incomplete / non-English desc → layer 1 model labels (hard fails quote the JD) → layer 2 company lookup (cached) → code score (`MATCH_WEIGHTS`) → ≥ threshold and company not in `MATCH_BLOCKED_COMPANIES` → tracker card.

### Two German-related gates

| Stage | Module | Question | Outcome |
|-------|--------|----------|---------|
| Scrape / ingest | `isNonEnglishJobDetail` (`packages/matching`) | Is the JD body non-English? | Do **not** save; count `german_filtered` |
| Match | layer 1 (`german_required` + quote) | Does an **English** JD require German as a must-have language? | Hard fail (score 1), `match_gate=german` |

Location / German company / “nice to have German” / plus / German-OR-English / basic German / “businesses speak German” in a since-clause must **not** fail the match gate.

## Entry points

Daily production ingest runs without the Mac: **GitHub Actions** (API / ATS → Postgres) and scheduled **Cursor / Claude** screens (`POST /api/agent/jobs` on Vercel). The browser scrapers are on-demand from the Mac.

| Entry | Role |
|-------|------|
| GitHub Actions → `packages/pipeline` (`pnpm pipeline sources`) | **Daily.** Arbeitnow / Bundesagentur / company ATS (Adzuna opt-in) → title gates, dedup, JD language → AI matcher → Telegram. See `docs/job_sources.md` |
| `POST /api/agent/jobs` (`Authorization: Bearer AGENT_API_TOKEN`) | **Daily (scheduled agents).** Already screened: link-only Tracker stubs, no title gates, no matcher (`apps/web/src/server/agent.ts`) |
| `pnpm pipeline scrape` / `scripts/run_jobs.sh` / Telegram `/jobs` | Indeed + LinkedIn parallel lanes on the Mac; cards written to Postgres |
| `pnpm --filter @tracker/web dev` | Next.js tracker (http://localhost:3000) |
| `src/tg/bot.py` | `/start` `/test` `/jobs` `/indeed_ok` (only `/jobs` starts scrapers) |
| `/timeouts` | Review title-qualified scrape timeouts; add to Tracker as pending |

Schedules live in GitHub Actions and the agents' own schedulers. Do not add a cron / launchd job on the Mac. `./scripts/start_ui.sh` still boots **Flask** — not the live app.

## Code conventions

TypeScript / Next.js: **[nextjs-typescript](../nextjs-typescript/SKILL.md)** (layers, React Compiler, `.js` imports in packages, 500/700 split).

Python (scrapers + fallback Flask only):

- **Python 3.12**, packages under `src/` installed with `pip install --no-deps -e .`. Never add `sys.path` edits.
- Layers, top → bottom: `web` / CLI → `services` → `scrapers`, `matching`, `sources` → `core`. A lower layer never imports a higher one (`tests/test_architecture.py`).
- Prefer shared helpers in `src/core/` and config in `src/core/config.py`. Keyword lists there are exported to `packages/pipeline/src/config.generated.json` (`scripts/tools/export_pipeline_config.py`).
- Playwright talks to an existing Chrome via CDP (`CDP_URL` / port 9222). Do not close the user’s Chrome session from scrapers.
- Fail-open where the current code already does unless the user asks to tighten.
- Keep changes scoped: no drive-by refactors; no new markdown files unless asked (architecture updates are required when flow changes).
- Do not commit unless the user asks.

### File size, reuse, and structure (hard rule)

When a file you are editing is **past ~500 lines**, stop and look for a split / reuse before adding more. At **~700 lines**, split in the same PR unless the bulk is a data table (city aliases, keyword lists) that would be worse elsewhere.

Split by **responsibility**, not by arbitrary line cuts. Put related files in a folder.

## Config knobs (where to edit)

| Concern | Location |
|---------|----------|
| Search keywords / title auto-pass / title blacklist | `src/core/config.py`, then `python3 scripts/tools/export_pipeline_config.py` (TS reads `packages/pipeline/src/config.generated.json`) |
| Tracker company blocklist / match score weights | `packages/matching/src/weights.ts` (keep Python `src/core/config.py` in sync if the scraper path still scores) |
| Indeed / LinkedIn URLs & selectors | `*_CONFIG` in `src/core/config.py` |
| Scrape window / pages | `/jobs [days] [linkedin_hours] [pages]` → `run_jobs.sh`; default pages `FULL_MAX_PAGES` |
| Match threshold / models | `.env` (`MATCH_THRESHOLD`, `MATCH_JOB_MODEL`, `MATCH_COMPANY_MODEL`, `MATCH_REASONING`, `OPENAI_API_KEY`); `AI_MODEL` is only the scrape-time title check |
| Telegram destination | `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `TELEGRAM_CHAT_ID`, `TELEGRAM_MESSAGE_THREAD_ID`) |
| Matching rules (model) | `docs/matching_rules.md` |
| Web session / agent token | `apps/web/.env.local` (`SESSION_SECRET`, `TRACKER_USERNAME`, `TRACKER_PASSWORD_HASH`, `AGENT_API_TOKEN`) |

## Suggested agent workflow for feature work

1. Read this skill + `AGENTS.md`. For TS/UI, also the nextjs-typescript skill. Skim `docs/architecture.md` for the affected stage.
2. Implement. If the file is past ~500 lines (must-split at ~700), extract or split by responsibility in the same PR.
3. If UI changed: apply **Web UI**, then `./scripts/check_ui.sh` and `./scripts/run_tests.sh <suite>`.
4. Update `docs/architecture.md` if flow/commands/filters/gates changed.
5. If matching changed, keep `docs/matching_rules.md`, the TS schema, and `MATCH_WEIGHTS` aligned, and run `scripts/tools/eval_matcher.py`.
6. Impact check: grep usages of every touched function / field / component; update neighbors from the checklist in the same PR.
7. Run the **change review loop** in [change-review-loop](../change-review-loop/SKILL.md): reviewers in a **fresh context** (not this chat’s implementation rationale), fix Must-fix, at most 2 rounds.
8. Briefly tell the user what flow docs were updated, which related areas you checked, and the review-loop outcome.

## Out of scope reminders

- Personal use scrapers — respect site ToS; no credential dumping into git.
- Never commit `.env` or secrets.
