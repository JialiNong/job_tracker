/**
 * Log Job: look up pasted URLs, save them link-only, report the last run.
 * Replaces src/web/routes/log_job.py plus the manual-log part of
 * src/web/chrome_tasks.py.
 *
 * Flask ran the save in a background thread and kept progress in memory.
 * A serverless function has neither, so the link-only save runs inside the
 * request (no browser, no AI: it is quick) and the finished run is stored in
 * stats_cache under "manual-log", where GET /api/manual-apply/status reads
 * it. "Scrape & log" needs a local browser, so it answers 503 here.
 */
import {
  berlinDayBounds, detectSource, expandShortJobUrl, isHttpUrl, jobMissingDetails, normalizeManualIdentity,
  now as clockNow, resolveJobId,
  formatBerlinDate,
} from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
import { PLAYWRIGHT_UNAVAILABLE } from "@/lib/local-only";
import { AGENTS } from "./agent";
import { lookupKnownJob, openPath } from "./known-jobs";
import { saveLinkOnly } from "./link-only";

const CACHE_KEY = "manual-log";
const BUSY_MSG = "A manual job log run is already in progress. Please wait.";
// A request that died mid-run never clears "running"; after this long it no longer blocks
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
export async function startManualLog(prisma: PrismaClient, body: Record<string, unknown>): Promise<Result> {
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
  if (mode === "scrape") {
    return { status: 503, body: { ok: false, error: PLAYWRIGHT_UNAVAILABLE } };
  }

  const current = await prisma.statsCache.findUnique({ where: { key: CACHE_KEY } });
  const busy = (current?.data as RunRecord | undefined)?.running
    && clockNow().getTime() - current!.computedAt.getTime() < STALE_RUN_MS;
  if (busy) return bad(BUSY_MSG, 429);
  await writeRun(prisma, { ...IDLE, running: true });

  const run: RunRecord = { ...IDLE };
  try {
    const saved = await saveLinkOnly(prisma, urls, {
      status, appliedAt, recommendedBy: rawRec === "none" ? "" : rawRec,
      identity: normalizeManualIdentity(body.title, body.company, body.location),
    });
    Object.assign(run, {
      log: saved.log, done_count: saved.ok.length, skip_count: saved.skipped.length, fail_count: saved.failed.length,
    });
  } catch (err) {
    Object.assign(run, { log: [`Fatal error: ${(err as Error).message}`], fail_count: urls.length });
  } finally {
    await writeRun(prisma, run);
  }
  return { status: 200, body: { status: "started", total: urls.length, job_status: status, mode } };
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
