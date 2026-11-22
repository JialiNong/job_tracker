/**
 * Fetch job details for one Tracker card: open its link in the debug Chrome,
 * scrape title / company / location / description, save them (no AI).
 * Replaces fetch_job_details_for_matched_job in src/services/tracker_jobs.py.
 *
 * - The scrape is the Python page scraper (src/scrapers/job_page.py, unchanged),
 *   run as a child process through scripts/tools/scrape_job_page.py, which
 *   prints one JSON line. This module saves the result to Postgres.
 * - It needs the user's Chrome, so it runs only where the app runs on the
 *   user's computer (next dev / next start). On Vercel it answers 503.
 * - Never writes status, timeline, notes, recommended_by or analysis fields.
 *   User-typed identity fields (manual_fields) are kept.
 * - FETCH_DETAILS_SCRAPER points at another script with the same output
 *   (the e2e suite's fake scraper); PYTHON picks the interpreter.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { LINK_ONLY_TITLE_PREFIX, canFetchDetails, normalizeLink, now as clockNow } from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
import { type LlmClient, assessJobDescription, createOpenAiClient, inferJobMetadata, modelSettings, stripHtml } from "@tracker/matching";

export const FETCH_DETAILS_LOCAL_ONLY =
  "Fetch job details runs on your computer (it needs your debug Chrome). Open the app on localhost to use it.";
const SCRAPE_TIMEOUT_MS = 3 * 60_000;
const SCRIPT = "scripts/tools/scrape_job_page.py";
const IDENTITY = ["title", "company", "location"] as const;

type Result = { status: number; body: Record<string, unknown> };
export interface ScrapedJob { title: string; company: string; location: string; description: string; applicants: string; link: string }
export type ScrapeResult = { ok: true; job: ScrapedJob } | { ok: false; error: string };
export type Scraper = (url: string) => Promise<ScrapeResult>;

// ── The Python scraper ──────────────────────────────────────────────────────

/** The repo root: the first directory going up from cwd (apps/web) that holds the script. */
function repoRoot(): string | null {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, SCRIPT))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Last stdout line as the script's JSON answer. */
export function parseScraperOutput(stdout: string): ScrapeResult | null {
  const last = stdout.trim().split("\n").pop() ?? "";
  try {
    const parsed = JSON.parse(last) as Record<string, unknown>;
    if (parsed.ok === true && parsed.job && typeof parsed.job === "object") {
      const raw = parsed.job as Record<string, unknown>;
      const field = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
      return {
        ok: true,
        job: {
          title: field("title"), company: field("company"), location: field("location"),
          description: field("description"), applicants: field("applicants"), link: field("link"),
        },
      };
    }
    if (parsed.ok === false) return { ok: false, error: String(parsed.error || "Scraping failed") };
  } catch {
    // not JSON: fall through
  }
  return null;
}

/**
 * One Chrome scrape at a time in this server: Fetch details on the Tracker and
 * Scrape & log share the debug Chrome's first tab, and two navigations at once
 * would read each other's page. Kept on globalThis so every route bundle
 * shares the same queue.
 */
const QUEUE_KEY = "__trackerChromeScrapeQueue";
function inChromeQueue<T>(task: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as Record<string, Promise<unknown> | undefined>;
  const run = (g[QUEUE_KEY] ?? Promise.resolve()).then(task, task);
  g[QUEUE_KEY] = run.catch(() => undefined);
  return run;
}

export const pythonScraper: Scraper = (url) => inChromeQueue(() => runScraperScript(url));

const runScraperScript = (url: string) => new Promise<ScrapeResult>((done) => {
  const root = repoRoot();
  if (!root) return done({ ok: false, error: `${SCRIPT} not found (run the app from the repo)` });
  const override = process.env.FETCH_DETAILS_SCRAPER?.trim();
  const script = override ? (isAbsolute(override) ? override : resolve(root, override)) : join(root, SCRIPT);
  const python = process.env.PYTHON?.trim() || "python3";

  const child = spawn(python, [script, url], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: join(root, "src") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => {
    stderr += d;
    process.stdout.write(`[fetch-details] ${d}`);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), SCRAPE_TIMEOUT_MS);
  child.on("error", (err) => {
    clearTimeout(timer);
    done({ ok: false, error: `Cannot start ${python}: ${err.message} (set PYTHON in apps/web/.env.local)` });
  });
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    const parsed = parseScraperOutput(stdout);
    if (parsed) return done(parsed);
    if (signal) return done({ ok: false, error: `Scraper timed out after ${SCRAPE_TIMEOUT_MS / 60_000} min` });
    const tail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400);
    done({ ok: false, error: `Scraper exited with code ${code}${tail ? `: ${tail}` : ""}` });
  });
});

// ── Saving ──────────────────────────────────────────────────────────────────

const CARD_SELECT = {
  id: true,
  recommendedBy: true,
  job: {
    select: {
      id: true, source: true, externalId: true, link: true, title: true, company: true, location: true,
      description: true, manualFields: true, detailsFetchedAt: true, linkReplacedAt: true,
    },
  },
} satisfies Prisma.ApplicationSelect;
type Card = Prisma.ApplicationGetPayload<{ select: typeof CARD_SELECT }>;

/** The page to open: the stored link, or the canonical LinkedIn / Indeed URL from the job id. */
export function cardUrl(job: Pick<Card["job"], "link" | "source" | "externalId">): string {
  const link = normalizeLink({ link: job.link.trim(), source: job.source, job_id: job.externalId });
  if (link.startsWith("http")) return link;
  if (link.startsWith("/")) return (job.source === "indeed" ? "https://de.indeed.com" : "https://www.linkedin.com") + link;
  if (link) return link;
  if (job.source === "indeed" && job.externalId) return `https://de.indeed.com/viewjob?jk=${job.externalId}`;
  return "";
}

/** User-typed fields win; a blank scrape keeps a real stored value (keep_manual_identity). */
export function keepManualIdentity(scraped: ScrapedJob, job: Pick<Card["job"], "title" | "company" | "location" | "manualFields">) {
  const out = { title: scraped.title.trim(), company: scraped.company.trim(), location: scraped.location.trim() };
  for (const f of IDENTITY) {
    const current = job[f].trim();
    if (job.manualFields.includes(f) && current) out[f] = current;
    else if (!out[f] && current && !current.startsWith(LINK_ONLY_TITLE_PREFIX)) out[f] = current;
  }
  return out;
}

export interface FetchDetailsDeps { scrape?: Scraper; llm?: LlmClient | null }

export async function fetchDetailsForCard(prisma: PrismaClient, cardId: string, deps: FetchDetailsDeps = {}): Promise<Result> {
  if (process.env.VERCEL && !deps.scrape) return { status: 503, body: { ok: false, error: FETCH_DETAILS_LOCAL_ONLY } };
  const card = await prisma.application.findUnique({ where: { id: cardId }, select: CARD_SELECT });
  if (!card) return { status: 404, body: { ok: false, error: "Job not found" } };
  const job = card.job;
  const asDoc = {
    title: job.title, description: job.description, details_fetched_at: job.detailsFetchedAt,
    link_replaced_at: job.linkReplacedAt, recommended_by: card.recommendedBy,
  };
  if (!canFetchDetails(asDoc)) return { status: 400, body: { ok: false, error: "This card already has job details" } };
  const url = cardUrl(job);
  if (!url) return { status: 400, body: { ok: false, error: "No job link" } };

  const scraped = await (deps.scrape ?? pythonScraper)(url);
  if (!scraped.ok) return { status: 502, body: { ok: false, error: scraped.error } };

  const identity = keepManualIdentity(scraped.job, job);
  const missing = IDENTITY.filter((f) => !identity[f]);
  const llm = deps.llm !== undefined ? deps.llm : process.env.OPENAI_API_KEY ? await createOpenAiClient() : null;
  if (missing.length && llm) {
    try {
      const guess = await inferJobMetadata(llm, stripHtml(scraped.job.description), modelSettings());
      for (const f of missing) identity[f] = guess[f]?.trim() ?? "";
    } catch {
      // the scrape is still worth saving without the guess
    }
  }
  if (!identity.title) identity.title = job.title;

  const description = scraped.job.description;
  const quality = assessJobDescription(description, identity.title, identity.company);
  const now = clockNow();
  await prisma.job.update({
    where: { id: job.id },
    data: {
      ...identity,
      description,
      applicants: scraped.job.applicants,
      // Keep the card's own link unless it had none worth opening (same rule as Python)
      ...(job.link.startsWith("http") ? {} : { link: scraped.job.link.startsWith("http") ? scraped.job.link : url }),
      descriptionQuality: quality.kind, descriptionQualityReason: quality.reason,
      descriptionEmpty: quality.kind === "empty", descriptionIncomplete: quality.kind !== "ok",
      needsRefetch: false,
      detailsFetchedAt: now,
      updatedAt: now,
    },
  });
  return { status: 200, body: { ok: true, error: null, ...identity } };
}
