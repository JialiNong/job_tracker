# Job Scraper — Architecture & Flows

This document describes the current architecture, entry commands, and the full chain: scrape → filter → AI match.

All project docs and code comments are written in English.

---

## 1. System overview

Daily production ingest is **GitHub Actions** (API/ATS → same matcher) plus **Cursor / Claude agent push** (skip matcher). The browser scrapers below are on-demand from the Mac.

```mermaid
flowchart TB
    subgraph Triggers["Entry points"]
        T1["Telegram<br/>/jobs [days] [li_hours] [pages] · /indeed_ok"]
        T2["Shell<br/>scripts/run_jobs.sh"]
        T3["GitHub Actions<br/>daily APIs + ATS"]
        T4["Web UI<br/>./scripts/start_ui.sh"]
        T5["Manual CLI<br/>scrapers / matcher"]
        T6["Cursor / Claude<br/>daily screen<br/>POST /api/agent/jobs"]
    end

    subgraph Scrape["Scrape layer"]
        Chrome["Chrome CDP :9222"]
        Indeed["indeed_scraper.py<br/>1d default · --days N"]
        LI["linkedin_scraper.py<br/>24h default · --hours N"]
        Manual["services/log_job.py<br/>manual job URLs (Log Job)"]
    end

    subgraph Filters["Per-card filters (before/after click)"]
        F1["1. Title blacklist<br/>TITLE_EXCLUDE_KEYWORDS"]
        F2["2. Auto-pass keywords<br/>TITLE_AUTO_PASS_KEYWORDS"]
        F3["3. AI title check<br/>only if no auto-pass hit"]
        F4["4. Dedup<br/>job_id already in DB?"]
        F5["5. JD language · Lingua<br/>non-English → do not save"]
    end

    subgraph Store["MongoDB"]
        Jobs[("jobs")]
        Matched[("matched_jobs")]
        Stats[("scraper_stats")]
    end

    subgraph Match["Match layer · ai_matcher.py → evaluator.py"]
        M0["Empty description → skip AI"]
        M1["Layer 1 · model labels the job<br/>CV + matching_rules.md<br/>hard fails quote the JD"]
        M1b["Layer 2 · company lookup<br/>web search, cached per company"]
        M2["Code score<br/>MATCH_WEIGHTS"]
        M3["Score ≥ threshold<br/>+ company not blocked<br/>→ matched_jobs"]
    end

    T1 --> T2
    T2 --> Chrome
    T5 --> Chrome
    Chrome --> Indeed & LI & Manual

    Indeed & LI --> F1 --> F2 --> F3 --> F4 --> F5
    F5 -->|English JD saved| Jobs
    F5 -->|non-English| Stats

    T3 -->|API/ATS jobs · same gates| F1
    Jobs --> M0 --> M1 --> M1b --> M2 --> M3
    M3 -->|≥ 7.0| Matched
    M2 -->|write analysis back| Jobs

    T6 -->|skip matcher · already AI-screened| Matched
    T4 --> Matched & Jobs
```

---

## 2. Commands / entry points

### 2.1 Pipeline

The browser pipeline (LinkedIn / Indeed) has **no schedule**: it runs on demand from Telegram `/jobs` (or the same script from a shell) on the Mac.

The **API sources pipeline** (Arbeitnow, Bundesagentur, company ATS boards; Adzuna opt-in; `src/sources/run_sources.py`) runs **daily on GitHub Actions** (`.github/workflows/api-sources-pg.yml`, 09:17 UTC / 10:17 Berlin in winter), with no Mac needed. It uses the same title / language gates and the same AI matcher, and sends its own Telegram summary + match cards.

A third daily lane is **agent ingest**: Cursor and Claude scheduled screens `POST /api/agent/jobs` on the Vercel app. Those picks skip this funnel (see [2.4](#24-agent-ingest-cursor--claude-daily)). Full source list, setup and watchlist: [`job_sources.md`](./job_sources.md).

| Command | What it does | Typical time |
|---------|--------------|--------------|
| `./scripts/run_jobs.sh [--days N] [--hours H] [--pages P]` | Indeed + LinkedIn lanes in parallel. Each source matches as soon as its scrape finishes, with Telegram pings; match-card digest after both lanes. Defaults: Indeed 1 day, LinkedIn 24h (or `days × 24` when `--days` is given), `FULL_MAX_PAGES` (3) pages per keyword on both platforms | 40–60 min at defaults |
| `python3 src/sources/run_sources.py [--sources …] [--days N] [--dry-run]` | API sources: fetch → funnel → AI match → Telegram (same as the daily GitHub Actions run). See [`job_sources.md`](./job_sources.md) | 2–8 min |
| `./scripts/start_ui.sh` | Start Job Tracker Web UI (default `:5050`); `--reload` restarts on `.py` or HTML saves; HTML is `Cache-Control: no-store` so a refresh shows template edits without a restart | — |
| `./scripts/start_ui_demo.sh [port]` | Same UI against the fictional `job_scraper_demo` database (default `:5051`). Seed with `python3 scripts/db/seed_demo.py`. Refuses `DATABASE_NAME=job_scraper` | — |

Prefer `caffeinate -i` for manual runs so sleep does not interrupt Playwright:

```bash
caffeinate -i ./scripts/run_jobs.sh                              # both last 24h, 3 pages/keyword
caffeinate -i ./scripts/run_jobs.sh --days 7                     # Indeed 7d, LinkedIn 168h
caffeinate -i ./scripts/run_jobs.sh --days 3 --hours 72 --pages 2
```

### 2.2 Telegram bot commands

| Command | Purpose |
|---------|---------|
| `/start` | Confirm bot is online |
| `/test` | Confirm the Mac is connected and ready |
| `/jobs [days] [linkedin_hours] [pages]` | Run `scripts/run_jobs.sh` in the background; per-source scrape/match pings; “Done” when both lanes finish. `days` ∈ 1/3/7/14 (Indeed), `linkedin_hours` defaults to `days × 24`, `pages` applies to both platforms. Examples: `/jobs`, `/jobs 7`, `/jobs 3 120`, `/jobs 3 72 2` |
| `/indeed_ok` | Resume Indeed after human verification (also: inline **Continue** button) |

**Per-source progress:** each lane sends two short Telegram notes — scrape done (matching started), then matching done. Indeed and LinkedIn do not wait for each other to start matching.

**Match card push:** `scripts/run_jobs.sh` calls `tg.digest.push_todays_matched_jobs()` only after **both** lanes finish. That covers Telegram `/jobs` and any manual shell run.

**Single-flight lock:** `scripts/run_jobs.sh` writes `logs/pipeline.pid`. A second `/jobs` or shell run exits immediately instead of launching another debug Chrome (same `--user-data-dir` would kill the first Chrome and abort Indeed with `TargetClosedError`). Telegram also checks this pidfile. If Indeed’s tab still dies mid-run, `indeed_scraper` reconnects over CDP and retries that page instead of exiting 1.

**Destination:** Job cards, pipeline Done/error status, and Indeed challenge alerts go to the configured forum topic (`TELEGRAM_CHAT_ID` + `TELEGRAM_MESSAGE_THREAD_ID` — Jiali Personal Hub → Job Assistance). Command authorization stays on `TELEGRAM_ALLOWED_USER_ID` (your personal account). Slash-command replies (`/start`, Started, …) stay in the topic you typed in; send commands from Job Assistance so those stay there too.

Start the bot: `python3 src/tg/bot.py`

### 2.2.1 Indeed human verification handshake

Indeed sometimes shows a captcha / “press and hold” challenge. The scraper **does not solve** that check. It:

1. Detects the challenge page (URL / captcha widgets / challenge copy)
2. Sends a Telegram alert with a **Continue** button
3. Pauses (up to 45 minutes) until **either** the job list is back in Chrome **or** you confirm
4. Reloads the SERP and continues the same keyword / page

You complete the check in the debug Chrome window. When the SERP returns, the scraper continues on its own. Optional confirm: tap **Continue**, send `/indeed_ok`, or (bot offline) `touch logs/indeed_human_resume.flag`.

If Indeed’s tab/browser closes mid-run (`TargetClosedError`), the scraper reconnects to the debug Chrome and retries the current results page instead of aborting the lane.

Indeed pacing is slower and more human-like than LinkedIn: random think-time before each card click, hold-delay on click, longer rests between cards (~5–11s), pages (~35–80s), and keywords (~30–70s).

### 2.2.2 Fetch details / Log Job page wait

Tracker **Fetch details**, **Run AI** (when the card has no stored JD), and Log Job scrape open the posting in debug Chrome (`src/scrapers/job_page.py`). After `goto`:

1. Wait 2–3 seconds so LinkedIn / Indeed / Glassdoor can paint
2. If the job text is still not readable (login, cookie, captcha, “Show more”), Telegram asks you to click in the debug window
3. When the posting becomes visible, Telegram confirms the click worked, then the scraper extracts (up to 2 minutes)

A `goto` timeout no longer aborts the extract — the listing is often already on screen. Glassdoor stays `source=manual` but uses Glassdoor selectors first; trafilatura is the fallback. Indeed Fetch details no longer bails on a challenge page: it waits for you to finish the check, same as the wait above.

### 2.3 Standalone CLI (debug / partial runs)

| Command | Purpose |
|---------|---------|
| `python3 src/scrapers/indeed_scraper.py [-k …] [-p N] [-j N] [--days N]` | Indeed only, no matching (default 3 pages × 15, last 1 day) |
| `python3 src/scrapers/linkedin_scraper.py [-k …] [-p N] [-j N] [--hours N]` | Full LinkedIn keyword loop (default 3 pages × 30; `--hours` < 24 → 2 pages; time window default config 24h, or `--hours`) |
| `python3 src/matching/ai_matcher.py [-l N] [-s source] [-t 7.0]` | AI match only (jobs without `matched_at`) |
| `python3 scripts/tools/log_jobs.py <urls…>` | Manual job URLs → `matched_jobs` (default `status=pending`; `--status applied` optional). Already on Tracker with a full card: skip, or mark applied when requested. Link-only / `ai_pending` Tracker rows are scraped in place (notes / timeline kept). Chrome / Indeed / AI failure still saves a **new** URL stub (`ai_pending`). `--link-only` skips scrape/AI. |
| `python3 scripts/tools/log_recommended_jobs.py <jobs.json \| ->` | Local twin of `POST /api/agent/jobs`. Batch log agent picks as link-only Tracker stubs: `pending`, `recommended_by` from `--recommended-by` (default `claude`; per-job `recommended_by` wins), per-job title / company / location. No browser / no AI; a job_id already in `matched_jobs` / `jobs` / `timeout_jobs` is skipped with no write. Skips on Unmatched are returned as `below_threshold` (title, score, `/unmatched?open=` path) and tagged `agent_recommended_by` on the `jobs` row so Overview and Unmatched can show the disagreement. Score later with Tracker **Select missing details** → **Run AI for selected**. |
| `python3 scripts/db/cleanup_excluded_titles.py …` | Cleanup DB rows by title blacklist |
| `python3 scripts/db/seed_demo.py` | Fictional screenshot dataset into `job_scraper_demo` (never copies production; refuses the `job_scraper` name unless `--force`) |
| `./scripts/start_ui_demo.sh [port]` | Tracker UI against `job_scraper_demo` (default port 5051). Refuses `DATABASE_NAME=job_scraper` |
| `python3 scripts/tools/eval_matcher.py …` | Matcher evaluation |
| `python3 scripts/tools/eval_matcher.py [--pos N --neg N --german N] [--job-model M]` | Check the matcher against Tracker decisions (applied vs unsuitable) and re-check old German rejects. `--unapplied [--limit N]` scores Tracker jobs she did not apply to. `--from-results <file>` re-scores a saved run with the current weights (no API calls). Read-only on MongoDB (company lookups cached in `evals/results/company_cache.json`); output in `evals/results/`. |

### 2.4 Agent ingest (Cursor / Claude daily)

Scheduled Cursor and Claude screens `POST /api/agent/jobs` on Render (`Authorization: Bearer AGENT_API_TOKEN`). Each agent already filtered with its own model, so this path **does not** run title gates or the matcher. It is a third ingest lane next to GitHub Actions and the on-demand browser scrapers, not a coding-agent side effect.

- New URL → `matched_jobs` link-only stub (`origin=agent`, `recommended_by` = `cursor` / `claude` / `gemini` / `gpt`)
- URL already on Tracker, in `jobs`, or in `timeout_jobs` → no overwrite of a scraped JD
- URL already Unmatched → stamp `agent_recommended_by` / `agent_recommend_reason`, return `below_threshold` so the agent can report the disagreement

Local twin: `python3 scripts/tools/log_recommended_jobs.py`. Source list: [`job_sources.md`](./job_sources.md).

---

## 3. Pipeline — `scripts/run_jobs.sh` / `/jobs`

```mermaid
sequenceDiagram
    participant S as run_jobs.sh
    participant C as Chrome :9222
    participant I as Indeed scraper
    participant L as LinkedIn scraper
    participant DB as MongoDB
    participant AI as ai_matcher
    participant TG as Telegram topic

    S->>C: Start or reuse debug Chrome
    par Parallel lanes
        S->>I: indeed_scraper.py --days N -p P -j 15
        I->>DB: save_job after filters
        I->>TG: Indeed scrape done — matching started
        S->>AI: ai_matcher.py --source indeed
        AI->>DB: mark_job_as_matched / save matched_jobs
        AI->>TG: Indeed matching done
    and
        S->>L: linkedin_scraper.py --hours H -p P -j 30
        L->>DB: save_job after filters
        L->>TG: LinkedIn scrape done — matching started
        S->>AI: ai_matcher.py --source linkedin
        AI->>DB: mark_job_as_matched / save matched_jobs
        AI->>TG: LinkedIn matching done
    end
    S->>TG: today's match-card digest
    S->>S: Desktop notification + close Chrome (only if this run started it)
```

Order:

1. Chrome remote debugging (reuse if `:9222` already open)
2. **Indeed + LinkedIn lanes in parallel** — `--pages` per keyword (default `FULL_MAX_PAGES` = 3). Indeed processes about 15 cards per page (`start` steps by 15). LinkedIn processes up to 30 cards per page.
3. As soon as a source finishes scraping → **AI matcher for that source only** (`--source indeed` / `--source linkedin`) + Telegram ping
4. After both lanes finish → push today's match-card digest + optionally close Chrome

The pipeline does **not** delete or clear any database rows.

Indeed search URL (`INDEED_CONFIG`): `de.indeed.com/jobs?q=<keyword>&l=&fromage=<days>`. Location stays empty (same as the desktop SERP). Hyphens in keywords are sent as spaces (`full-stack` → `q=full+stack`) so the query matches typing “Full Stack” in the search box. Indeed only offers 1, 3, 7 or 14 days.

LinkedIn time window: `f_TPR=r<hours × 3600>`.

Budgets are defined in `src/core/config.py` (`FULL_MAX_PAGES`, `INDEED_JOBS_PER_PAGE`, `LINKEDIN_JOBS_PER_PAGE`, `LINKEDIN_SHORT_WINDOW_MAX_PAGES`). `run_jobs.sh` reads them at start; `--pages` overrides `FULL_MAX_PAGES`. A standalone `linkedin_scraper.py --hours N` run without `-p` uses `linkedin_default_max_pages(hours)`.

---

## 4. Per-job funnel: list card → database

For every list card during scrape:

```mermaid
flowchart TD
    Card["List card: read title"]

    Card --> Excl{"1. Title hits<br/>TITLE_EXCLUDE_KEYWORDS?<br/>e.g. Java / DevOps / Lead / QA…"}
    Excl -->|yes| Skip1["Skip — do not open detail"]
    Excl -->|no| KW{"2. Title contains<br/>TITLE_AUTO_PASS_KEYWORDS?<br/>frontend / fullstack / product /<br/>forward deployed engineer"}

    KW -->|yes| Dedup
    KW -->|no| AITitle{"3. AI title check<br/>clearly not web/product dev?"}
    AITitle -->|unrelated| Skip2["Skip<br/>count ai_title_filtered"]
    AITitle -->|related / API fail-open| Dedup

    Dedup{"4. job_id already in DB?"}
    Dedup -->|yes| Skip3["Skip click"]
    Dedup -->|no| Click["Open detail<br/>count title_passed_clicked"]

    Click --> Detail{"JD panel loaded?"}
    Detail -->|timeout| TO["timeout_jobs<br/>(title + link, /timeouts)"]
    Detail -->|yes| Fetch["Fetch description (up to 3 retries)"]
    Fetch --> Lang{"5. Lingua language check<br/>is_non_english_job_detail"}
    Lang -->|non-English de/fr/…| SkipDE["Do not save<br/>count german_filtered"]
    Lang -->|English or undetectable| Quality{"Complete description?<br/>assess_job_description"}
    Quality -->|empty / incomplete| SaveEmpty["Still save<br/>description_empty / description_incomplete<br/>matcher will skip AI"]
    Quality -->|yes| Save["save_job → jobs"]
```

### What each stage does

| Step | Implementation | Purpose |
|------|----------------|---------|
| 1. Title blacklist | `is_title_excluded()` · `TITLE_EXCLUDE_KEYWORDS` | Skip clearly wrong roles before clicking. `Cloud` only matches Cloud Engineer / Architect / similar roles, not “Cloud SaaS” in a frontend title. |
| 2. Auto-pass hit | `title_matches_auto_pass()` · `TITLE_AUTO_PASS_KEYWORDS` | frontend / full-stack / fullstack / product / forward deployed engineer → click without AI. `software engineer` is a search keyword (`DEFAULT_KEYWORDS`) but **not** auto-pass, because it also matches embedded / HMI / data titles |
| 3. AI title screen | `is_title_relevant_by_ai()` (`AI_MODEL`, default gpt-4.1-mini) | After blacklist + no auto-pass: the prompt describes a JS/TS web engineer and skips only titles that are clearly not web/product development (embedded, HMI/Qt, data/BI, integration, growth/marketing, DevOps, QA, sales, other language stacks). Unsure → open. API error → open |
| 4. Dedup | `is_job_id_exists()` | Do not re-open known jobs |
| 4b. Detail timeout | `save_timeout_job()` | Title passed but JD panel missing → `timeout_jobs` for `/timeouts` |
| 4c. LinkedIn JD body | `extract_linkedin_description()` | About-the-job region only (`JobDetails_AboutTheJob_*`). Expands See more / Mehr anzeigen. Never the whole SDUI `lazy-column` (top card + teaser + similar jobs). |
| 4c2. LinkedIn applicants | `extract_linkedin_applicants()` | Short phrase from classic top-card or SDUI details (`25 applicants`, `Be among the first 25`). Stored as `applicants`; shown on Tracker / Unmatched List rows. |
| 4d. JD completeness | `assess_job_description()` | Too short, UI chrome, similar-jobs sidebar, or a **short** title/company mismatch → save with `description_incomplete` (or `description_empty`); matcher skips AI. Long LinkedIn JDs that name a product instead of the parent company are still complete. |
| 5. JD language | `is_non_english_job_detail()` · Lingua | **JD body not English** (usually German posts) → **do not save**, even if completeness is incomplete. UI: German Filtered |

> Step 5 answers “what language is the JD written in?”, not “does an English JD require German skills?”. The latter is the match-stage German gate. Language runs **before** completeness. Incomplete English teasers are saved and skipped at match, not sent to the model.

Unified title-gate entry point:

`should_skip_title_before_click()` → `src/core/title_gate.py`

---

## 5. After save: AI matching

`ai_matcher.py` only processes `jobs` documents that still lack `matched_at`. Each job goes through `matching/evaluator.py`:

```mermaid
flowchart TD
    New["get_new_jobs()<br/>no matched_at yet"]
    New --> Empty{"Empty description?<br/>assess_job_description kind=empty"}
    Empty -->|yes| FailEmpty["score 0 · empty_desc · needs_refetch<br/>no AI call"]
    Empty -->|no| Lang{"Non-English JD?<br/>is_non_english_job_detail"}
    Lang -->|yes| FailLang["score 0 · non_english<br/>no AI call"]
    Lang -->|no| Inc{"Incomplete JD?<br/>assess_job_description not ok"}
    Inc -->|yes| FailInc["score 0 · incomplete_desc · needs_refetch<br/>no AI call"]
    Inc -->|no| L1["Layer 1 · classify_job()<br/>CV (user_profile.md) + matching_rules.md + JD<br/>gpt-5.4-mini · JSON schema"]
    L1 --> Hard{"Hard fail?<br/>German required · required non-JS backend ·<br/>leadership · not web dev · backend-heavy ·<br/>years · contract/location · unusable JD ·<br/>blocked company"}
    Hard -->|yes| FailHard["score 1 (0 for unusable JD)<br/>match_gate = fail kind<br/>reason quotes the JD"]
    Hard -->|no| L2["Layer 2 · research_company()<br/>web search → business, product type,<br/>customer markets, recruiter?<br/>cached in company_profiles"]
    L2 --> Score["score_job()<br/>role type + stack + seniority + backend ask +<br/>AI product + location + product type + markets<br/>weights: MATCH_WEIGHTS"]
    Score --> T{"score ≥ MATCH_THRESHOLD (7.0)?"}
    T -->|yes| MJ["matched_jobs (Tracker) · status pending"]
    T -->|no| OnlyJobs["jobs only (Unmatched page)"]
    MJ --> Mark["mark_job_as_matched<br/>analysis + job_labels + company_profile"]
    OnlyJobs --> Mark
    FailEmpty --> Mark
    FailLang --> Mark
    FailInc --> Mark
    FailHard --> Mark
```

**Who decides what**

| Step | Decided by |
|------|------------|
| Empty / incomplete / non-English JD | Code (`assess_job_description` + `is_non_english_job_detail`) — no API call |
| Job labels and hard fails | Model (`MATCH_JOB_MODEL`, default `gpt-5.4-mini`), rules in [`matching_rules.md`](./matching_rules.md). Every hard fail and German requirement must quote the posting |
| What a label does | Code (`score_job`). Only `backend_language_ask = required_non_js` fails on backend; `implied_non_js` is −1. Duties like "lead a squad / lead projects" → `lead_or_above` (−3) |
| Company business / markets | Model with web search (`MATCH_COMPANY_MODEL`), cached per normalised company name in MongoDB `company_profiles`. Only for jobs that passed layer 1 |
| Final score | Code, `MATCH_WEIGHTS` in `src/core/config.py`. Tune preferences there, not in prompts |
| Tracker cut-off | `MATCH_THRESHOLD` (`.env`, default 7.0) and `MATCH_BLOCKED_COMPANIES` (case-insensitive) |

**Stored fields:** `match_score`, `match_gate` (`scored`, `german`, `non_english`, `stack`, `leadership`, `not_web_dev`, `backend_heavy`, `too_many_years`, `contract_or_location`, `blocked_company`, `incomplete_desc`, `empty_desc`, `score_failed`; older rows may still carry `ai_ml`), `disqualification_reason` (quote), `summary`, `match_reasons` (Business / Customers/markets / Stack / score breakdown), `red_flags` (watch-out), `job_labels`, `company_profile`. JDs are never cleared.

**Scrape-time language filter vs German requirement:** Lingua (`core.language.is_non_english_job_detail`) drops postings *written* in another language before they are saved — including JDs that look “incomplete” because the company string does not appear. If a non-English JD still reaches matching (Fetch details / an older row), code skips the model with `match_gate=non_english`. A German requirement inside an English JD is a layer-1 hard fail (`german_required` + quote); German as a plus / "German or English" passes.

If the OpenAI account runs out of credits, matching stops and the remaining jobs stay without `matched_at` for the next run.

Already-scored jobs are not rematched automatically. To re-score one: Unmatched **Can Apply** → Tracker **Re-run AI**, or clear `matched_at` on that `jobs` row and run `ai_matcher.py`.

---

**Timeouts page (`/timeouts`):** cards whose **title already passed** the scrape gates but the detail panel did not load in time. These are not saved to `jobs` (no JD). You open the original link and, if it is a real match, **Add as Not Applied** — that copies the card into `matched_jobs` as `pending`. Cards with no readable title (typical Indeed ad/empty slots, ~1 per SERP page) are not listed.

**Unmatched page (`/unmatched`):** any job below the match threshold can be marked **Can Apply** (`user_status=watchlist`). That copies it into `matched_jobs` as `pending` (does not overwrite an existing Tracker row) so it can be tracked or marked applied. This is a manual override when AI scoring was wrong; it is not limited to the 6–7 score band. Filter by hard-fail kind with the gate dropdown; each card shows the quoted reason plus the company / score breakdown. The **Agent recommended** chip lists jobs an agent pushed that were already on Unmatched (`agent_recommended_by` on the `jobs` row). Cards show an “Also: Cursor” (etc.) pill and the agent’s reason. Deep link: `/unmatched?agent=1&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD` (date is the push day).

**Tracker / Unmatched Cards layout:** collapsed cards show score, title, company and location only (same face on both pages: title, then company + location chip). A click or tap opens the same side details sheet as List (with a Close ×); the board card stays in the grid.

**Tracker / Unmatched List layout:** the company line also shows LinkedIn applicant count (`applicants` when scraped). On Tracker, a saved `#N at apply` (`applicant_position`) replaces that scraped phrase on the row.

**Sidebar:** from Tracker, Log a job / Timeouts / Unmatched open in a new tab so the job list stays. Switching among those three pages stays in the same tab. Tracker status chips (Active, Not applied, …) live in `.side-extra` — Jobs only. Overview hides that block (phone chip row and desktop Status column); switching back to Jobs restores it.

**Overview pipeline rail:** one bar to scale where the full width is every opened job (`title_passed_clicked`). Parts: not in English (grey) · in English not matched · AI matched, with **Applied** inside matched, **Got interview** inside Applied (same lookback as the Got interview chip: invite / a round / offer, including later rejected or cancelled before the interview happened), and **Offer** inside Got interview. Volume percentages (through Applied) are a share of opened jobs. **Got interview** and **Offer** are a share of Applied (interview rate and offer rate among applications), not of opened jobs. Offer stays in the readout at 0 so the slot is reserved. On a phone the colour strip is 14px; labels sit under the bar.

**Overview application flow:** a Sankey of *current* application state (`GET /api/stats/flow`). One path per job (same `APPLICATION_QUERY` set as Journey). Applied splits into Waiting, Screening, and Rejected (never interviewed), plus Interview. Screening is a questionnaire / Loom / similar request before a live interview; it is not Got interview. The track has two dates: **Screening** (they asked) then **Submitted** (you sent the answers / video); both stay the Screening chip. Missing Screening / Submitted buttons stay available after Invite / rounds so you can backfill; the timeline is stored in date order. Status follows the latest-dated step, except a backfilled Screening never overrides Invite / a round / Offer / Cancelled. `closed_no_reply` without an interview sits in Waiting (same “no response yet” bucket). Interview continues by the latest round on the timeline: a round whose timestamp is still in the future is “upcoming”; a past timestamp is “after” that round; rejected / offer are terminals. **Cancelled** (`interview_cancelled`) is a progress step when the company called off an interview before it happened: the Invite stays on the track (Got interview does not change), any not-yet-held round dated after the cancel is dropped, the Interview chip clears, and the Sankey sits on Interview → Interview cancelled. A later Invite / Round after Cancelled is a reschedule. A Reapplied step restarts which slice of the timeline counts; it is not a second Sankey path. Recording Applied / Rejected / Cancelled (or any other progress step) updates the sidebar chips immediately, then `/api/stats` and Overview (journey / flow / heatmap / locations) reload with `Cache-Control: no-store` so a slower older GET cannot paint over the new totals. Hover or tap a band for the count (tap again to clear). Charts use a fixed height so they do not grow with the page.

**Overview weekly applications:** stacked columns per ISO week (Monday), LinkedIn / Indeed / Other, on the same endpoint. Counting matches funnel Applied and the heatmap: first `applied_at` plus each Reapplied step on that step’s day. Empty weeks between the first apply and this week still appear.

**Overview daily activity:** the heatmap day panel can show **Agent recommended, still Unmatched** when an agent push that day hit a job already scored below threshold. The link opens `/unmatched?agent=1` for that date. This is a reminder, not a pipeline stage — it does not change the rail counts.

**Tracker Other statuses:** `unsuitable`, `closed`, `repost`, `duplicate` are overlays on a card. They do **not** clear `applied_at` or `application_timeline`; a job that was applied still shows its progress and still counts in funnel / Journey / Locations / daily-activity applied totals / application-flow Sankey / weekly bars. Reset Not Applied (`pending`) is the explicit wipe: it clears the timeline, `applied_at` and `applicant_position` and is not counted as an application. `repost` is a manual mark when the same role was posted again as a new listing and does not need another application. `duplicate` marks a listing already tracked from another source (e.g. LinkedIn and Indeed for the same role). Tracker chips **Applied / Screening / Interview / Cancelled / Offer / Rejected** filter and count by that progress (latest timeline step, or `applied_at` / flat applied-like status when there is no timeline), not exclusively by the `status` field — so an Unsuitable card with an interview step still appears under Interview, with the overlay pill still visible. **Screening** is the latest-step chip for a pre-interview questionnaire / Loom / similar (asked or already submitted); it does not count as Got interview. **Cancelled** is the latest-step chip when an interview was called off before it happened; the current Interview chip drops, **Got interview** stays. **Got interview** is a lookback chip: any job that ever reached Invite / a round / Offer, including ones later marked Rejected, Cancelled, or a side overlay. Applied→Rejected with no interview step stays on Rejected only. Overlay chips still filter by the side-status field.

AI `special_match` / `special_match_reasons` are still written by the matcher for scoring (9–10 band) but are **not** shown as badges on the Tracker. Highlight badges on the matched-jobs page come only from the user-editable `highlights` list (`PATCH /api/jobs/<id>/highlights`).

**Tracker company history:** `GET /api/jobs` (and `GET /api/jobs/<id>`) attach `company_history` / `company_history_total` to each job: the other `matched_jobs` rows with the same company (case-insensitive exact match, one query per page). Cards show a "N× before" pill and, when expanded, a "seen this company before" box with each earlier job's outcome (Rejected / Applied · no reply yet / Screening / Interview / Interview cancelled / Not Applied / side status). Recording progress on one card updates matching history rows on other visible cards. Clicking a company name adds it as a chip in the search box (`?company=`, exact match, OR if several). The first chip resets the other filters so every job at that company is listed; later chips add companies. Each chip has its own ×. "Show all jobs at …" still opens a new tab with that one company.

**Applicant position (LinkedIn):** `applicant_position` is a user-entered integer ("I was applicant #N when I applied"), saved with `PATCH /api/jobs/<id>/applicant-position`. It is separate from the scraped `applicants` text; scrapers and Log Job never write it. On the details sheet it sits in Application progress, above Notes (filled at apply time). Tracker List shows `#N at apply` on the row when this is set, otherwise the scraped count. After a posting-link replace that changes `source` off LinkedIn, the block still shows when a number is already saved.

**Replace posting link:** when an original URL is closed (common on agent-recommended company pages) but the same role is still on the company site, the details sheet has a Replace posting link row (`PATCH /api/jobs/<id>/link`). Save updates `link` / `source` / `job_id` / `posting_key` on `matched_jobs` and the twin `jobs` row, stamps `link_replaced_at`, and does not scrape. Fetch job details then opens the new URL. Until details are fetched again, Run AI also scrapes that new page instead of the old stored JD. A URL already stored on another card is rejected (409). Notes, timeline, status, and `recommended_by` are kept.

---

## 7. Directory map

```
job_scraper/
├── docs/
│   ├── architecture.md          # this file
│   ├── setup.md                 # local install, .env, tests
│   ├── matching_rules.md        # layer-1 rules for the model (hard fails, labels)
│   ├── job_sources.md           # every way jobs come in + API sources / ATS setup
│   ├── user_profile.md          # resume / profile
│   ├── images/                  # README screenshots / GIFs
│   ├── deployment/              # Render setup
│   └── archive/testing/         # past one-off test / verification reports
├── pyproject.toml               # `pip install -e .` → src/ packages are importable (no sys.path edits)
├── src/                         # layers, top → bottom: web / CLI → services → scrapers, matching, sources → core
│   ├── core/                    # bottom layer: never imports scrapers / services / web / tg (tests/test_architecture.py)
│   │   ├── paths.py             # PROJECT_ROOT (templates/, config/, logs/ … are found from here)
│   │   ├── config.py            # keywords, title blacklist, platform URLs
│   │   ├── db_mongo.py          # Mongo facade (`from core.db_mongo import …`)
│   │   ├── mongo/               # Mongo implementation (not flat mongo_*.py siblings)
│   │   │   ├── client.py        # connection pool, indexes
│   │   │   ├── jobs.py          # scrape-store CRUD + matcher write-back
│   │   │   ├── lookup.py        # known-job lookup + timeout review
│   │   │   └── tracker.py       # unmatched list, application counts, heatmap
│   │   ├── applied_location.py  # Germany + Remote bubble labels (no Mongo)
│   │   ├── country.py           # Tracker country (agent field or location guess) + filter query
│   │   ├── job_url.py           # Log Job URL parse / Indeed jk= + job-id variants / stubs / replace-link fields
│   │   ├── manual_log.py        # Save Link Only / stub save (no Playwright)
│   │   ├── agent_push.py        # POST /api/agent/jobs: save stubs, report Unmatched skips
│   │   ├── title_gate.py        # pre-click title gate: blacklist → auto-pass → AI title check
│   │   ├── jd_quality.py        # is a scraped JD empty / incomplete / ok to match?
│   │   ├── language.py          # Lingua English-only gate (optional import: not on Render)
│   │   ├── text.py              # strip_html
│   │   ├── browser.py           # debug-Chrome CDP connect + Playwright page helpers (no Playwright import)
│   │   ├── indeed_meta.py       # Indeed company / location header parsing, rating-chip guard
│   │   ├── indeed_resume.py     # resume flag for the Indeed captcha handshake (bot writes, scraper waits)
│   │   ├── pipeline_lock.py     # Single-flight pidfile for scripts/run_jobs.sh
│   │   └── dedup.py             # Cross-source duplicate check (company + title) for API sources
│   ├── scrapers/                # Indeed / LinkedIn scrapers; `job_page.py` = one-URL extract
│   │   ├── challenge_wait.py    # Indeed captcha detect + auto-continue / Telegram resume
│   │   ├── content_wait.py      # Fetch details: settle + wait for a click, Telegram when it worked
│   │   └── cli.py               # shared --keywords / --max-pages / --hours / --days options
│   ├── services/                # workflows shared by web + CLI; import-safe on Render
│   │   ├── log_job.py           # Log Job: scrape + AI + save pasted URLs → {ok, skipped, failed}
│   │   ├── tracker_jobs.py      # Run AI / Fetch details on an existing Tracker card
│   │   ├── job_analysis.py      # AI identity fill, evaluate, write analysis back
│   │   └── browser_session.py   # lazy Playwright + first debug-Chrome tab
│   ├── sources/                 # API sources: Arbeitnow / Bundesagentur / Adzuna / company ATS (run_sources.py)
│   ├── matching/
│   │   ├── ai_matcher.py        # match orchestration (`evaluate_job`)
│   │   └── evaluator.py         # layer 1 labels, layer 2 company lookup, code score
│   ├── web/                     # Tracker UI (Flask)
│   │   ├── web_app.py           # app entry: config, login manager, registers Blueprints
│   │   ├── auth.py              # single-user login Blueprint
│   │   ├── status.py            # status + application timeline rules (pure, no Flask)
│   │   ├── flow.py              # Overview Sankey sinks + weekly-by-platform (pure, no Flask)
│   │   ├── list_query.py        # Tracker list filters → Mongo query
│   │   ├── serialize.py         # Mongo doc → card JSON, company history
│   │   ├── chrome_tasks.py      # Log Job / Run AI / batch Fetch state + locks (one Chrome, one worker)
│   │   ├── task_log.py          # per-thread capture of printed progress for those tasks
│   │   └── routes/              # Blueprints, no URL prefix: pages, jobs, unmatched,
│   │                            #   timeouts, stats, log_job, ai_tasks
│   └── tg/                      # Telegram — package is not named `telegram` (would shadow python-telegram-bot)
│       ├── bot.py               # Bot: commands in (/jobs, /indeed_ok)
│       ├── client.py            # Push out: sync Bot API sendMessage helper
│       └── digest.py            # Today's match cards → Telegram (after run_jobs.sh / run_sources.py)
└── scripts/
    ├── run_jobs.sh              # pipeline behind Telegram /jobs
    ├── start_ui.sh              # Tracker web UI
    ├── start_ui_demo.sh         # Tracker UI against `job_scraper_demo` (screenshots)
    ├── lib/pipeline_common.sh   # shared shell helpers (lanes, Telegram pings)
    ├── db/                      # one-off DB maintenance + `seed_demo.py` (fictional screenshot data)
    └── tools/                   # log_jobs (Log Job CLI), log_recommended_jobs, eval_matcher, generate_password_hash
```

---

## 8. One-line funnel

> **Title gates (blacklist → auto-pass keywords → AI title) → open detail → discard non-English JD → save English JD → matcher skips empty / incomplete / non-English desc → model labels the job against CV + rules (hard fails quote the JD) → model looks up the company (cached) → code scores with MATCH_WEIGHTS → ≥ 7 and company not blocked enters Tracker.**

`/jobs` arguments only change *how much* to scrape: Indeed days, LinkedIn hours, and pages per keyword (both platforms). Each source starts AI matching as soon as its scrape finishes; job cards are pushed only after both lanes complete. **Filter and match rules are the same for every window.**

Agent-recommended URLs skip this funnel: Cursor / Claude already screened them, and `POST /api/agent/jobs` writes `origin=agent` stubs to Tracker. A URL the matcher already rejected is not copied onto Tracker; it is tagged on Unmatched instead.
