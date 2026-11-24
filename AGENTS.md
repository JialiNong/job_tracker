# Agent instructions

Cursor, Claude Code, and Codex all read this file. Keep it short; procedures live in skills.

## Stack (do not confuse)

- **Live tracker:** Next.js 15 App Router + React 19 + Postgres (Neon / local Docker). Vercel hosts the web app.
- **Daily ingest:** `packages/pipeline` on GitHub Actions, then `packages/matching`. Writes go to Postgres.
- **Browser scrapers** (LinkedIn / Indeed): still Python, on-demand from the Mac. `pnpm pipeline scrape` writes those cards to Postgres.
- **Flask + Mongo** is a fallback only. Do not treat `src/web/` or Mongo as the live tracker, and do not send production writes there.

This is Next.js, not NestJS. No Nest modules, decorators, or DI.

## Always

- **English** for UI copy, `docs/`, comments, commit messages, and filter logs. Chat with the user may follow their language.
- Do **not** commit unless the user asks. Never commit `.env`, `.env.local`, or secrets.
- **Impact check** in the same change: grep every touched field/component; update Clear/reset, filters, counts, old records, and sibling pages. See the job-scraper skill.
- After Tracker UI edits (`apps/web/src/components`, `apps/web/src/app`, `static/css/`): phone and desktop, no hover-only paths, shared `--phone-ctrl-h`, then `./scripts/check_ui.sh` and the matching `./scripts/run_tests.sh` suite.
- Do not self-review in the same context you just implemented. Spawn the reviewer agents (fresh context, diff only).

## Skills (one copy, three tools)

Canonical files: `.agents/skills/<name>/SKILL.md`. Symlinked to `.claude/skills/` and `.cursor/skills/` so each tool can discover them.

| Skill | When |
|-------|------|
| `job-scraper` | Scrape, match, pipeline, Telegram, impact check, Web UI contracts |
| `nextjs-typescript` | Next.js / React / pnpm packages — syntax, layers, splits |
| `change-review-loop` | After application code: isolated `change-reviewer` + `security-reviewer` |

Reviewer prompts: `.agents/reviewers/` (linked from `.cursor/agents/` and `.claude/agents/`).

## Tests

```bash
./scripts/run_tests.sh tracker|fetch|unmatched|timeouts|log-job|matching|scrape|ui
./scripts/run_tests.sh unit    # Vitest only
./scripts/run_tests.sh e2e     # Next.js browser suite
```

There is no coverage gate. Prefer the suite for the area you touched over a global percentage.

## More

Funnel and gates: `.agents/skills/job-scraper/SKILL.md` and `docs/architecture.md` (some diagrams still show the Flask/Mongo era — prefer this file and `README.md` for entry points). Matching rules: `docs/matching_rules.md`.
