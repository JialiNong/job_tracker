/**
 * The local browser pipeline on Postgres (replaces scripts/run_jobs.sh after
 * the cutover; that script stays as it is for the Mongo stack).
 *
 *   pnpm pipeline scrape [--days 1|3|7|14] [--hours N] [--pages N]
 *
 * 1. One run at a time: logs/pipeline.pid, the same lock run_jobs.sh takes,
 *    so the two pipelines never start a second debug Chrome.
 * 2. Debug Chrome on CDP_PORT (reused if already open).
 * 3. Indeed and LinkedIn lanes in parallel: the Python scrapers (code
 *    unchanged) with TRACKER_STORE=postgres, then AI matching per source.
 * 4. Telegram digest of this run's new matches, macOS notification.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { requireEnv } from "./env.js";
import { berlinDayBounds, formatBerlinDate, now as clockNow } from "@tracker/core";
import { prisma } from "@tracker/db/client";
import { createOpenAiClient, modelSettings } from "@tracker/matching";
import { config } from "../config.js";
import { pushMatchDigest } from "../digest.js";
import { loadMatchingDocs } from "../docs.js";
import { matchNewJobs } from "../match.js";
import { sendTelegramMessage } from "../telegram.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LOG_DIR = join(ROOT, "logs");
const PIDFILE = join(LOG_DIR, "pipeline.pid");
const PYTHON = process.env.PYTHON || "python3";
mkdirSync(LOG_DIR, { recursive: true });

const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" });
const log = (line: string) => {
  const text = `[${stamp()}] ${line}`;
  console.log(text);
  appendFileSync(join(LOG_DIR, "main.log"), `${text}\n`);
};

// ── Arguments (same checks as run_jobs.sh) ──────────────────────────────
const { values } = parseArgs({ options: { days: { type: "string" }, hours: { type: "string" }, pages: { type: "string" } } });
if (values.days && !["1", "3", "7", "14"].includes(values.days)) {
  log(`Invalid --days value: ${values.days} (Indeed only offers 1, 3, 7 or 14)`);
  process.exit(1);
}
const hours = values.hours ?? (values.days ? String(Number(values.days) * 24) : undefined);
if (hours !== undefined && !(Number(hours) > 0)) { log(`Invalid --hours value: ${hours} (need a positive number)`); process.exit(1); }
if (values.pages !== undefined && !/^[1-9]\d*$/.test(values.pages)) { log(`Invalid --pages value: ${values.pages} (need a positive whole number)`); process.exit(1); }

// ── Single-flight lock ──────────────────────────────────────────────────
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function acquireLock(): boolean {
  if (existsSync(PIDFILE)) {
    const holder = Number.parseInt(readFileSync(PIDFILE, "utf8").trim().split(/\s+/)[0] ?? "", 10);
    if (holder > 0 && alive(holder)) return false;
  }
  writeFileSync(PIDFILE, `${process.pid}\n`);
  return true;
}
const releaseLock = () => {
  try {
    if (readFileSync(PIDFILE, "utf8").trim().split(/\s+/)[0] === String(process.pid)) unlinkSync(PIDFILE);
  } catch { /* already gone */ }
};
if (!acquireLock()) {
  log("⚠️  Pipeline already running — not starting a second Chrome (that would kill the first scrape). Exiting.");
  process.exit(0);
}
process.on("exit", releaseLock);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { releaseLock(); process.exit(130); });

requireEnv("DATABASE_URL");
log("=== Job Scraping Pipeline (Postgres) Started ===");

// ── Debug Chrome ────────────────────────────────────────────────────────
const portOpen = () => new Promise<boolean>((resolve) => {
  const socket = connect(config.CDP_PORT, config.CDP_HOST);
  socket.once("connect", () => { socket.end(); resolve(true); });
  socket.once("error", () => resolve(false));
});
let chrome: ReturnType<typeof spawn> | null = null;
if (await portOpen()) {
  log(`Chrome remote debugging already listening on ${config.CDP_PORT}, reusing it`);
} else {
  log("Starting Chrome with remote debugging...");
  chrome = spawn(config.CHROME_BIN, [
    `--remote-debugging-port=${config.CDP_PORT}`, `--user-data-dir=${config.CHROME_USER_DATA_DIR}`,
    "--no-first-run", "--no-default-browser-check",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const chromeLog = createWriteStream(join(LOG_DIR, "chrome.log"));
  chrome.stdout?.pipe(chromeLog);
  chrome.stderr?.pipe(chromeLog);
  log(`Chrome started (PID: ${chrome.pid})`);
  for (let i = 0; i < 20 && !(await portOpen()); i++) await new Promise((r) => setTimeout(r, 500));
  log((await portOpen()) ? "Chrome remote debugging is ready" : `⚠️  WARNING: Chrome debugging port ${config.CDP_PORT} is not open. See logs/chrome.log`);
}

// ── Lanes ───────────────────────────────────────────────────────────────
const fileStamp = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).replace(/\D/g, "").replace(/^(\d{8})/, "$1_");
const runId = `run_${fileStamp}_${process.pid}`;
const pages = values.pages ?? String(config.FULL_MAX_PAGES);
log(`Run id: ${runId}`);
log(`Step 1/2: Full lanes — ${pages} pages/keyword, Indeed ${config.INDEED_JOBS_PER_PAGE}/page (${values.days ?? 1}d), LinkedIn ${config.LINKEDIN_JOBS_PER_PAGE}/page (${hours ?? 24}h)`);

const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
const { cv, rules } = await loadMatchingDocs();
const settings = modelSettings();
const threshold = Number.parseFloat(process.env.MATCH_THRESHOLD ?? "7.0") || 7.0;
const client = apiKey ? await createOpenAiClient(apiKey) : null;

function scrape(source: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const out = createWriteStream(join(LOG_DIR, `${source}_${fileStamp}.log`));
    const child = spawn(PYTHON, [`src/scrapers/${source}_scraper.py`, ...args], {
      cwd: ROOT,
      env: { ...process.env, TRACKER_STORE: "postgres", PIPELINE_RUN_ID: runId },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => { out.write(`${err.message}\n`); resolve(1); });
  });
}

interface LaneResult { scrapeOk: boolean; matchOk: boolean; cardIds: string[] }

async function lane(name: string, source: string, args: string[]): Promise<LaneResult> {
  const code = await scrape(source, args);
  const scrapeOk = code === 0;
  log(scrapeOk ? `✅ ${name} scrape completed` : `⚠️  WARNING: ${name} scrape failed (exit ${code})`);
  await sendTelegramMessage(scrapeOk ? `🔍 ${name} scrape done — matching started.` : `⚠️ ${name} scrape failed (exit ${code}) — matching saved jobs anyway.`, { log: () => {} });
  if (!client || !cv || !rules) {
    log(`⚠️  ${name} matching skipped: OPENAI_API_KEY, docs/user_profile.md or docs/matching_rules.md missing`);
    return { scrapeOk, matchOk: false, cardIds: [] };
  }
  const matchLog = createWriteStream(join(LOG_DIR, `matcher_${source}_${fileStamp}.log`));
  try {
    const summary = await matchNewJobs(prisma, { client, cv, rules, settings, threshold, source, log: (l) => matchLog.write(`${l}\n`) });
    const matchOk = !summary.stoppedReason;
    log(matchOk ? `✅ ${name} matching completed` : `⚠️  WARNING: ${name} matching stopped: ${summary.stoppedReason}`);
    await sendTelegramMessage(matchOk ? `✅ ${name} matching done.` : `⚠️ ${name} matching stopped: ${summary.stoppedReason}`, { log: () => {} });
    return { scrapeOk, matchOk, cardIds: summary.matchedCardIds };
  } catch (err) {
    log(`⚠️  WARNING: ${name} matching failed (${(err as Error).message})`);
    await sendTelegramMessage(`⚠️ ${name} matching failed.`, { log: () => {} });
    return { scrapeOk, matchOk: false, cardIds: [] };
  } finally {
    matchLog.end();
  }
}

const indeedArgs = [...(values.days ? ["--days", values.days] : []), "--max-pages", pages, "--max-jobs", String(config.INDEED_JOBS_PER_PAGE)];
const linkedinArgs = [...(hours ? ["--hours", hours] : []), "--max-pages", pages, "--max-jobs", String(config.LINKEDIN_JOBS_PER_PAGE)];
log("  Indeed lane and LinkedIn lane running...");
const [indeed, linkedin] = await Promise.all([lane("Indeed", "indeed", indeedArgs), lane("LinkedIn", "linkedin", linkedinArgs)]);

if (chrome) {
  log("Closing Chrome...");
  chrome.kill();
}
const mark = (ok: boolean) => (ok ? "✅" : "❌");
log("=== Pipeline Completed ===");
log(`Indeed scrape:   ${mark(indeed.scrapeOk)}`);
log(`LinkedIn scrape: ${mark(linkedin.scrapeOk)}`);
log(`Indeed match:    ${mark(indeed.matchOk)}`);
log(`LinkedIn match:  ${mark(linkedin.matchOk)}`);

const cardIds = [...indeed.cardIds, ...linkedin.cardIds];
const today = berlinDayBounds(formatBerlinDate(clockNow()))!;
const scraped = await prisma.job.count({ where: { scrapedAt: { gte: today.start } } });
log(`Today: ${scraped} jobs scraped; this run: ${cardIds.length} high-quality matches`);
log("Step 2/2: Pushing this run's matches to Telegram...");
try {
  const digest = await pushMatchDigest(prisma, cardIds, () => {});
  log(digest.sent ? `✅ Telegram match digest sent (${digest.jobs} jobs)` : "⚠️  WARNING: Telegram match digest not sent (Telegram not configured or unreachable)");
} catch (err) {
  log(`⚠️  WARNING: Telegram match digest failed (${(err as Error).message})`);
}
spawn("osascript", ["-e", `display notification "${scraped} new jobs scraped, ${cardIds.length} matched" with title "Job Scraper Done" sound name "Glass"`], { stdio: "ignore" }).on("error", () => {});
await prisma.$disconnect();
