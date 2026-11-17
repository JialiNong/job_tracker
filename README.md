# Job Tracker

AI-assisted job search pipeline for the German market, running daily in production.

Public APIs and company ATS boards are collected on GitHub Actions, scored against my CV, and the matches land on a phone-friendly tracker plus Telegram.

![From a new match to a status change](docs/images/tracker-flow.gif)

## Why I built it

Screening German-market listings by hand was slow. Many posts are written in German, require German as a must-have, or sit on the wrong stack. I wanted a system that throws those out first, then tells me *why* a remaining role is a fit, so I spend time on applications instead of tabs.

## What it does

- **Collects** listings every morning from Arbeitnow, the Bundesagentur für Arbeit, and ~80 company ATS boards (Greenhouse, Lever, Ashby, Personio, Recruitee, Workable). [Job sources](docs/job_sources.md).
- **Filters cheaply, then matches with AI.** Empty, non-English, and incomplete JDs never hit the model. The rest get labels, a company lookup, and a 0–10 score.
- **Tracks applications** in a login-protected web UI: status and timeline, Unmatched / Timeouts review, stats, and a log-a-job form. Built for phone as well as desktop.
- **Pushes today's matches** to Telegram.
- **Accepts agent-recommended jobs** through an authenticated API, so a coding agent can drop a URL onto the tracker.

| Desktop overview | Job detail | Phone |
| --- | --- | --- |
| ![Desktop overview](docs/images/tracker-desktop.jpg) | ![Job detail](docs/images/match-detail.png) | ![Phone layout](docs/images/tracker-phone.jpg) |

## Architecture

The collector and matcher write **directly to MongoDB Atlas**. Render only serves the UI and writes application status. Collection never goes through Render.

```mermaid
flowchart LR
  GHA["GitHub Actions<br/>daily"] --> Sources["APIs + ATS boards"]
  Sources --> Matcher["Gates → LLM labels → code score"]
  Matcher --> Mongo[(MongoDB Atlas)]
  Matcher --> TG["Telegram"]
  Mongo <--> Render["Render · Flask tracker"]
  Render --> User["Phone / browser"]
  TG --> User
```

Full flow, gates, and stored fields: [architecture.md](docs/architecture.md). Matching rules the model follows: [matching_rules.md](docs/matching_rules.md).

## Design decisions

### Deterministic checks stay in code; judgment goes to the LLM

Empty JDs, non-English JDs, and incomplete page chrome are rejected in code (`assess_job_description`, Lingua). Those jobs are never sent to the model. The LLM only sees a usable English posting, and every hard fail has to quote the JD.

### The LLM outputs labels; code computes the score

The model returns structured labels (role type, stack fit, seniority, German requirement, company markets, …). `MATCH_WEIGHTS` in `src/core/config.py` turns those labels into a 0–10 score. The number is explainable, I can retune a preference (for example hardware −2.5) without rewriting prompts, and swapping models does not change the scoring logic.

### Two-layer matching, with a company cache

Layer 1 labels the job against my CV and [matching_rules.md](docs/matching_rules.md). Layer 2 (web search) runs only for jobs that passed layer 1, and only the first time a company is seen — later jobs reuse `company_profiles`. Layer 1 costs about 4k input + 0.4k output tokens per job; a first-time company lookup is about 12–14k input plus search fees.

### Past decisions are the eval set

Before I change a prompt, a weight, or a model, I re-score jobs I already marked applied or unsuitable (`python3 scripts/tools/eval_matcher.py`). The eval is my own Tracker history, not a public benchmark — that is a limitation, but it catches regressions against the taste the pipeline is for.

## Tech stack

Python 3.12 · Flask · gunicorn · MongoDB Atlas · OpenAI · Lingua · GitHub Actions · Render · Telegram Bot API

## Built with AI coding agents

This repo is the daily workflow, not a demo of prompting.

- I implement features with Claude Code / Cursor against project skills (matching rules, UI contracts, impact checks).
- After Claude edits web code, a Stop hook (`scripts/e2e_hook.sh`) runs unit tests and browser E2E tests against a throwaway MongoDB. A failure is sent back to Claude to fix; the same failure is reported once.
- Coding agents can also push recommended jobs through `POST /api/agent/jobs`.

## Quick start

Operator details live in **[docs/setup.md](docs/setup.md)**. Deploying the UI: **[docs/deployment/RENDER_SETUP.md](docs/deployment/RENDER_SETUP.md)**.

```bash
cp .env.example .env          # MongoDB, OpenAI, tracker login
pip3 install -r requirements.txt
python3 src/sources/run_sources.py --dry-run
./scripts/start_ui.sh
```

## Limitations and next steps

- **Single user.** Auth, CV, and weights are mine; this is not a multi-tenant product.
- **The eval set is small** and is my own Tracker decisions, so it will overfit my taste.
- **Render's free plan cold-starts** after about 15 minutes idle (about 20–30s on the next open).
- **Coverage is the public APIs plus an ATS watchlist.** Jobs that only appear on a board I do not query never enter the pipeline.

Next: grow the eval set, and tighten company coverage on the ATS watchlist.
