---
name: nextjs-typescript
description: >-
  TypeScript and Next.js 15 App Router conventions for this pnpm monorepo
  (apps/web, packages/core, matching, pipeline, db). Use when editing
  React pages, route handlers, Prisma, Vitest, or workspace packages.
  Not NestJS. Enforces layer splits, React Compiler (no useMemo),
  NodeNext .js imports in packages, and the 500/700-line file split.
---

# Next.js + TypeScript

Read this skill before changing `apps/web` or `packages/*`. Product rules (funnel, impact check, phone UI) stay in the **job-scraper** skill.

This repo is **Next.js 15** (App Router) + **React 19** + **TypeScript 5.8**. It is not NestJS: no modules, `@Injectable`, or Nest controllers.

## Syntax (current, match the tree)

- ESM only (`"type": "module"`). Named exports. Default export only for Next.js `page.tsx` / `layout.tsx` / `route.ts` / `middleware.ts` / `next.config.ts`.
- `strict: true`. In `packages/*` also `noUncheckedIndexedAccess`. Do not add `any` without a one-line comment saying why.
- `import type` for types. Prefer `satisfies` (Prisma `select`) and `as const` (tab lists) over wide assertions.
- `async`/`await`. Early return. `??` / `?.`. No `var`.
- Target: packages **ES2023** + **NodeNext**; `apps/web` **ES2022** + bundler resolution + `@/*` → `apps/web/src/*`.
- **Relative imports in `packages/*` keep the `.js` suffix** (`./status.js` for `status.ts`). `apps/web` does **not** use that suffix; use `@/…`.
- Next.js 15: `params` and `searchParams` are **Promises** — `const { id } = await params`.
- Authenticated JSON routes: `export const dynamic = "force-dynamic"`.
- React 19 + **React Compiler** (`experimental.reactCompiler` in `next.config.ts`): do **not** add `useMemo` / `useCallback`. The compiler memoizes.
- `"use client"` only at the interactive boundary (hooks, events, TanStack Query). `page.tsx` stays a server component that loads CSS + `<Providers>` + `<Suspense>` around the client app.
- Adjusting state during render to sync from the URL is OK (see `TrackerApp` search box). Do not invent effects for that.

## Layers (hard rule)

Lower never imports higher. Put work in the lowest layer that can hold it.

```text
apps/web/src/app            pages + route handlers (thin)
apps/web/src/components     React UI
apps/web/src/lib            client API, formatters, HTTP helpers (no Prisma)
apps/web/src/server         Prisma reads/writes, agent push, fetch-details
packages/pipeline           ingest, sources, Telegram  → core, matching, db
packages/matching           language/quality gates, LLM labels, code score
packages/db                 Prisma schema + client
packages/core               pure rules (status, time, URLs) — no Prisma, no Next
src/                        Python scrapers + Flask fallback only
```

| Smell | What to do |
|-------|------------|
| Route handler grows query/filter logic | Move to `@/server/…`; keep the route as parse → call → `NextResponse` |
| Client component imports `@tracker/db` or `@/server/*` | Stop. Call `/api/…` through `@/lib/…/api.ts` |
| Status / date / country rules next to Prisma | Move to `@tracker/core` so Vitest needs no database |
| Copying title / language / match-gate logic | Extend `@tracker/matching` or `@tracker/pipeline` |
| New Nest-style `services/` / `modules/` tree under `app/` | Do not. Use `server/` + packages |

`packages/core` must not import `db`, `matching`, `pipeline`, or `apps/web`. `matching` may use `core` only.

## File size, reuse, and structure (hard rule)

Same numbers as the rest of the repo: past **~500 lines**, look for a split; at **~700 lines**, split in the same PR unless the bulk is a data table.

Split by **responsibility**, not line cuts. Related files go in a folder (`components/tracker/card/`, `components/tracker/overview/`). A page that is still one component stays one file.

| Smell | What to do |
|-------|------------|
| Same helper or CSS on two pages | Shared module (`@/components/list`, `@/lib/…`, `static/css/shared/`) |
| `JobCard.tsx` also owns timeline, batch, and filters | Card pieces in `card/`; page chrome in `TrackerApp` / `Toolbar` |
| Prisma in a React file | `server/` + a route |

## UI in this app (do not restyle)

- CSS lives in `static/css/` (copied into `apps/web/public/static` on dev/build). No Tailwind, no CSS-in-JS, no new component library, no extra frontend framework.
- Fonts: EB Garamond + Plus Jakarta Sans (see `layout.tsx`). Phone control height: `--phone-ctrl-h` in `static/css/base.css`.
- Match existing solid primary buttons and density. Do **not** apply a generic “distinctive redesign” skill to this tracker.
- Filters live in the URL. Server data lives in **TanStack Query**; after a write, **invalidate** — do not hand-patch the list.
- Phone vs desktop and `./scripts/check_ui.sh`: job-scraper skill **Web UI**.

## Data and auth

- Postgres through Prisma (`@tracker/db/client`). Ids are 24-hex strings (`isRecordId` in `@/lib/http.ts`).
- Login: iron-session cookie in `middleware.ts`. Agent ingest: `Authorization: Bearer AGENT_API_TOKEN` on `/api/agent/*` (not the login cookie).
- `TRACKER_READ_ONLY=1` refuses API writes (423). Do not bypass it.
- JSON helpers: `jsonError`, `readJsonObject`, `intParam` in `@/lib/http.ts`.
- Fail-open where the port already does (AI title check / language too-short → allow) unless the user asks to tighten.
- Run AI / Lingua: the Linux binary is too large for Vercel; hosted Run AI must keep the “runs locally” path. Do not bundle Lingua into the Vercel function.

## Tests for TS changes

- Unit: Vitest in the same package (`apps/web/test`, `packages/*/test`). No real Postgres in `@tracker/core` / matching / web unit tests. Mock Prisma or test pure functions.
- After a web change, `./scripts/run_tests.sh` for that page (see `AGENTS.md`). E2E is `./scripts/run_e2e_next.sh` (Next.js + throwaway Postgres), not the old Flask `run_e2e.sh`.
- Overlay / viewport contracts stay in `./scripts/check_ui.sh`, not in E2E.
- Matching or weight changes: keep `docs/matching_rules.md`, `packages/matching` schema, and `MATCH_WEIGHTS` aligned; run `python3 scripts/tools/eval_matcher.py` when the eval still applies.
- **No coverage % gate.** A global Vitest number for `apps/web` looks low because route handlers and React pages are hit by contract + e2e, not unit tests. Domain packages (`@tracker/core`, `@tracker/matching`) should stay high. Do not add coverage CI unless asked.

## Workflow

1. Read this skill + job-scraper for the product surface.
2. Put code in the right layer; split at ~500/700.
3. If UI: job-scraper **Web UI**, then `check_ui.sh` + the page test suite.
4. Impact check neighbors in the same PR.
5. Isolated review loop (`change-review-loop` skill). Do not commit unless asked.
