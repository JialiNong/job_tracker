/**
 * Log Job: look up pasted URLs, save them link-only, report the last run.
 * Replaces src/web/routes/log_job.py plus the manual-log part of
 * src/web/chrome_tasks.py.
 *
 * Flask ran the save in a background thread and kept progress in memory.
 * A serverless function has neither, so the link-only save runs inside the
 * request (no browser, no AI: it is quick) and the finished run is stored in
 * stats_cache under "manual-log", where GET /api/manual-apply/status reads
 * it.
 *
 * "Scrape & log" needs the debug Chrome, so it runs only where the app runs
 * on your computer (503 on Vercel). It saves every URL link-only first (the
 * same rules as above: dedupe, mark applied, agent tag, typed fields), then
 * for each card that still has no JD runs Fetch details and Run AI. A card
 * whose scrape fails stays saved, AI pending, like Python's fallback. That
 * part runs after the response, in this long-lived local server, writing its
 * progress to stats_cache as it goes.
 */
import {
  berlinDayBounds, detectSource, expandShortJobUrl, isHttpUrl, jobMissingDetails, normalizeManualIdentity,
  normalizePastedJobUrl, now as clockNow, resolveJobId,
  formatBerlinDate,
} from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
import { AGENTS } from "./agent";
import { FETCH_DETAILS_LOCAL_ONLY, type FetchDetailsDeps, fetchDetailsForCard } from "./fetch-details";
import { lookupKnownJob, openPath } from "./known-jobs";
import { type LinkOnlyOptions, saveLinkOnly } from "./link-only";
import { runAiOnCard } from "./run-ai";

const CACHE_KEY = "manual-log";
const BUSY_MSG = "A manual job log run is already in progress. Please wait.";
// A request that died mid-run never clears "running"; after this long without
// progress it no longer blocks (a scrape run writes progress after every step)
const STALE_RUN_MS = 5 * 60_000;

type Result = { status: number; body: Record<string, unknown> };
const bad = (error: string, status = 400): Result => ({ status, body: { error } });

interface RunRecord {
  running: boolean;
  log: string[];
  done_count: number;
  fail_count: number;
  skip_count: number;
}
const IDLE: RunRecord = { running: false, log: [], done_count: 0, fail_count: 0, skip_count: 0 };

async function writeRun(prisma: PrismaClient, run: RunRecord) {
  const data = run as unknown as Prisma.InputJsonValue;
  const computedAt = clockNow();
  await prisma.statsCache.upsert({
    where: { key: CACHE_KEY }, create: { key: CACHE_KEY, data, computedAt }, update: { data, computedAt },
  });
}

/** POST /api/manual-apply/lookup: is each pasted URL already stored, and where does it open? */
export async function lookupUrls(prisma: PrismaClient, body: Record<string, unknown>): Promise<Result> {
  let urls = body.urls;
  if (urls === undefined && body.url) urls = [body.url];
  if (!Array.isArray(urls)) return bad("urls must be a list (or pass url)");
  const cleaned = urls.filter((u): u is string => typeof u === "string" && !!u.trim()).map((u) => u.trim());
  if (!cleaned.length) return bad("No valid URLs provided");

  const results = [];
  for (const raw of cleaned) {
    const url = (await expandShortJobUrl(raw)) || raw;
    const source = detectSource(url);
    const jobId = resolveJobId(url, source);
    const hit = jobId ? await lookupKnownJob(prisma, jobId, source, url) : null;
    if (!hit) {
      results.push({ url, found: false, source, job_id: jobId || "", on_tracker: false, promotable: true });
      continue;
    }
    const details = hit.on_tracker && jobMissingDetails({ ...hit });
    results.push({
      url, found: true, collection: hit.collection, stage: hit.stage, on_tracker: hit.on_tracker,
      promotable: !hit.on_tracker, id: hit._id, title: hit.title, company: hit.company, status: hit.status,
      source: hit.source, job_id: hit.job_id, match_score: hit.match_score, open_path: openPath(hit),
      ai_pending: hit.ai_pending, details_missing: details,
      needs_scrape: hit.on_tracker && (hit.ai_pending || details),
    });
  }
  return { status: 200, body: { results } };
}

/** The applied day: today means "now" (the real submit time), another day means its Berlin midnight. */
function parseAppliedDate(raw: unknown): Date | null | "invalid" {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "invalid";
  const bounds = berlinDayBounds(value);
  if (!bounds) return "invalid";
  return value === formatBerlinDate(clockNow()) ? clockNow() : bounds.start;
}

/** POST /api/manual-apply. */
export async function startManualLog(prisma: PrismaClient, body: Record<string, unknown>, deps: ScrapeLogDeps = {}): Promise<Result> {
  if (!Array.isArray(body.urls ?? [])) return bad("urls must be a list");
  const urls: string[] = [];
  for (const u of (body.urls ?? []) as unknown[]) {
    if (typeof u !== "string" || !u.trim()) continue;
    const url = (await expandShortJobUrl(u.trim())) || u.trim();
    if (isHttpUrl(url)) urls.push(url); // saved links become clickable hrefs: http(s) only
  }
  if (!urls.length) return bad("No valid URLs provided");

  const mode = String(body.mode || "scrape").trim().toLowerCase();
  if (mode !== "scrape" && mode !== "link_only") return bad("mode must be 'scrape' or 'link_only'");
  const status = String(body.status || "pending").trim().toLowerCase();
  if (status !== "pending" && status !== "applied") return bad("status must be 'pending' or 'applied'");
  const rawRec = String(body.recommended_by ?? "").trim().toLowerCase();
  if (rawRec && rawRec !== "none" && !AGENTS.includes(rawRec)) {
    return bad("recommended_by must be none, claude, cursor, gemini, or gpt");
  }
  const appliedAt = parseAppliedDate(body.applied_date);
  if (appliedAt === "invalid") return bad("Invalid applied_date format, expected YYYY-MM-DD");
  if (mode === "scrape" && process.env.VERCEL && !deps.fetch) {
    return { status: 503, body: { ok: false, error: FETCH_DETAILS_LOCAL_ONLY } };
  }

  const current = await prisma.statsCache.findUnique({ where: { key: CACHE_KEY } });
  const busy = (current?.data as RunRecord | undefined)?.running
    && clockNow().getTime() - current!.computedAt.getTime() < STALE_RUN_MS;
  if (busy) return bad(BUSY_MSG, 429);
  await writeRun(prisma, { ...IDLE, running: true });

  const opts: LinkOnlyOptions = {
    status, appliedAt, recommendedBy: rawRec === "none" ? "" : rawRec,
    identity: normalizeManualIdentity(body.title, body.company, body.location),
  };
  if (mode === "scrape") {
    const work = scrapeAndLog(prisma, urls, opts, deps);
    // Locally the server outlives the request: the page polls the status. Tests wait for it.
    if (deps.wait) await work; else void work;
  } else {
    const run: RunRecord = { ...IDLE };
    try {
      const saved = await saveLinkOnly(prisma, urls, opts);
      Object.assign(run, {
        log: saved.log, done_count: saved.ok.length, skip_count: saved.skipped.length, fail_count: saved.failed.length,
      });
    } catch (err) {
      Object.assign(run, { log: [`Fatal error: ${(err as Error).message}`], fail_count: urls.length });
    } finally {
      await writeRun(prisma, run);
    }
  }
  return { status: 200, body: { status: "started", total: urls.length, job_status: status, mode } };
}

export interface ScrapeLogDeps {
  /** Fetch details / Run AI stand-ins (tests); default the real scraper and model. */
  fetch?: FetchDetailsDeps;
  runAi?: typeof runAiOnCard;
  /** Await the background part before answering (tests). */
  wait?: boolean;
}

/** The Tracker card a URL was saved to, as Log Job's lookup sees it. */
async function cardFor(prisma: PrismaClient, url: string) {
  const normalized = normalizePastedJobUrl(url);
  if (!normalized) return null;
  const source = detectSource(normalized);
  const hit = await lookupKnownJob(prisma, resolveJobId(normalized, source) ?? "", source, normalized);
  return hit?.on_tracker ? hit : null;
}

/** Link-only save, then Fetch details + Run AI for each card that still needs them. */
async function scrapeAndLog(prisma: PrismaClient, urls: string[], opts: LinkOnlyOptions, deps: ScrapeLogDeps) {
  const run: RunRecord = { ...IDLE, running: true };
  const say = async (line: string) => {
    run.log.push(line);
    await writeRun(prisma, run);
  };
  try {
    const saved = await saveLinkOnly(prisma, urls, opts);
    run.log.push(...saved.log);
    const ok = new Set(saved.ok);
    const skipped = new Set(saved.skipped);
    const failed = new Set(saved.failed);
    const sync = () => Object.assign(run, { done_count: ok.size, skip_count: skipped.size, fail_count: failed.size });
    sync();
    await writeRun(prisma, run);

    const targets = [...saved.ok, ...saved.skipped];
    await say(`Scrape & log: ${targets.length} card(s) to check`);
    for (const [i, url] of targets.entries()) {
      const card = await cardFor(prisma, url);
      if (!card) continue;
      const missing = jobMissingDetails({ ...card });
      const aiPending = card.ai_pending || card.match_score == null;
      if (!missing && !aiPending) continue;
      const wasSkipped = skipped.has(url);
      await say(`[${i + 1}/${targets.length}] ${card.title || url}`);

      if (missing) {
        await say("  Scraping the job page in Chrome…");
        const fetched = await fetchDetailsForCard(prisma, card._id, deps.fetch);
        if (!fetched.body.ok) {
          await say(`  ❌ ${String(fetched.body.error)} — card kept, AI pending`);
          // An existing card left unchanged counts as failed, a new one is still saved
          if (wasSkipped) { skipped.delete(url); failed.add(url); sync(); await writeRun(prisma, run); }
          continue;
        }
        await say(`  ✅ Details saved: ${String(fetched.body.title || "")} @ ${String(fetched.body.company || "")}`);
      }

      await say("  Running AI…");
      const ai = await (deps.runAi ?? runAiOnCard)(prisma, card._id);
      if (ai.body.ok) {
        const gate = String(ai.body.match_gate || "");
        await say(gate && gate !== "scored" ? `  ⛔ Stopped at the ${gate} gate (not scored)` : `  ✅ AI score ${String(ai.body.match_score)}/10`);
      } else {
        await say(`  ⚠️ AI pending: ${String(ai.body.error)}`);
      }
      if (wasSkipped) { skipped.delete(url); ok.add(url); sync(); }
    }
    await say(`Done: ${ok.size} saved, ${skipped.size} skipped, ${failed.size} failed`);
  } catch (err) {
    run.log.push(`Fatal error: ${(err as Error).message}`);
  } finally {
    run.running = false;
    await writeRun(prisma, run).catch(() => undefined);
  }
}

/** GET /api/manual-apply/status?since=N: log lines after the first N, plus the total. */
export async function manualLogStatus(prisma: PrismaClient, since: string | null) {
  const row = await prisma.statsCache.findUnique({ where: { key: CACHE_KEY } });
  const run = { ...IDLE, ...(row?.data as Partial<RunRecord> | undefined) };
  const start = Math.max(0, Number.parseInt(since ?? "", 10) || 0);
  return {
    running: run.running, log: run.log.slice(start), log_total: run.log.length,
    done_count: run.done_count, fail_count: run.fail_count, skip_count: run.skip_count,
  };
}
