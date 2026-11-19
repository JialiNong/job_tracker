/**
 * Run AI on one Tracker card (replaces Flask's background thread + in-memory
 * lock; src/services/tracker_jobs.py run_ai_on_matched_job).
 *
 * - One request runs one job, start to finish, and answers with the result.
 *   The browser runs batches as a sequence of these calls.
 * - The lock is the posting's analysis_state = running (with
 *   analysis_started_at), so two tabs or two servers never analyse the same
 *   job at once. A run older than STALE_LOCK_MS no longer blocks.
 * - Only a card with a complete stored JD can run here. Fetching a JD needs
 *   the browser scraper, which runs locally (phase 4).
 * - A failed model call keeps the previous analysis; each success adds a row
 *   to job_analyses and points the posting at it.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { LINK_ONLY_TITLE_PREFIX, companyKey, linkNeedsRefetch, now as clockNow } from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
import {
  type Analysis, type CompanyCache, type LlmClient, OutOfCreditsError, assessJobDescription, createOpenAiClient,
  evaluate, inferJobMetadata, modelSettings, stripHtml, toAnalysis,
} from "@tracker/matching";
import { matchThreshold } from "./stats";

const STALE_LOCK_MS = 10 * 60_000;
export const NEEDS_LOCAL_SCRAPE =
  "This card has no complete job description yet. Run Fetch details on your computer first (it needs the browser scraper).";

type Result = { status: number; body: Record<string, unknown> };

// ── Prompt files ────────────────────────────────────────────────────────────

/** A docs/ file: MATCH_PROFILE_PATH / MATCH_RULES_PATH if set, else the first docs/ found going up from cwd. */
function docPath(name: string, envPath: string | undefined): string | null {
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath);
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, "docs", name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function readDoc(name: string, envPath: string | undefined): Promise<string> {
  const path = docPath(name, envPath);
  if (!path) return "";
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

// ── Company profiles (company_profiles) as the matcher's cache ──────────────

function companyCache(prisma: PrismaClient): CompanyCache {
  return {
    async get(key) {
      const p = await prisma.companyProfile.findUnique({ where: { key } });
      return p && {
        business: p.business, product_type: p.productType, vertical: p.vertical, markets: p.markets,
        markets_detail: p.marketsDetail, is_recruiter_for_other_company: p.isRecruiterForOtherCompany, sources: p.sources,
      };
    },
    async set(key, profile) {
      const text = (v: unknown) => (typeof v === "string" ? v : "");
      const fields = {
        business: text(profile.business), productType: text(profile.product_type), vertical: text(profile.vertical),
        markets: text(profile.markets), marketsDetail: text(profile.markets_detail),
        isRecruiterForOtherCompany: profile.is_recruiter_for_other_company === true,
        sources: (Array.isArray(profile.sources) ? profile.sources : []) as Prisma.InputJsonValue,
        model: typeof profile._model === "string" ? profile._model : null,
        usage: (profile._usage ?? null) as Prisma.InputJsonValue,
        cachedAt: clockNow(),
      };
      await prisma.companyProfile.upsert({ where: { key }, create: { key, ...fields }, update: fields });
    },
  };
}

// ── The card ────────────────────────────────────────────────────────────────

const CARD_SELECT = {
  id: true,
  job: {
    select: {
      id: true, source: true, externalId: true, link: true, title: true, company: true, location: true,
      description: true, manualFields: true, analysisState: true, analysisStartedAt: true, currentAnalysisId: true,
      detailsFetchedAt: true, linkReplacedAt: true,
    },
  },
} satisfies Prisma.ApplicationSelect;
type Posting = Prisma.ApplicationGetPayload<{ select: typeof CARD_SELECT }>["job"];

/** The stored JD is complete enough to match without scraping (stored_jd_usable). */
export function storedJdUsable(job: Pick<Posting, "title" | "company" | "description" | "detailsFetchedAt" | "linkReplacedAt">): boolean {
  const title = job.title.trim();
  if (!title || title.startsWith(LINK_ONLY_TITLE_PREFIX)) return false;
  if (!job.description.trim()) return false;
  if (linkNeedsRefetch({ link_replaced_at: job.linkReplacedAt, details_fetched_at: job.detailsFetchedAt })) return false;
  return assessJobDescription(job.description, title, job.company).ok;
}

/** Fill blank title / company / location from the JD; never a field the user typed. */
async function fillIdentity(client: LlmClient, job: Posting, log: (l: string) => void) {
  const identity = { title: job.title, company: job.company, location: job.location };
  const missing = (["title", "company", "location"] as const).filter((f) => !identity[f] && !job.manualFields.includes(f));
  if (missing.length) {
    log(`Inferring missing field(s) ${missing.join(", ")} from the description`);
    const guess = await inferJobMetadata(client, stripHtml(job.description), modelSettings(), log);
    for (const f of missing) identity[f] = guess[f] ?? "";
  }
  if (!identity.title) identity.title = `(Unknown title — job_id ${job.externalId})`;
  return identity;
}

/** The analysis as job_analyses columns + details (same split as the migration, docs/pg-schema.md D4). */
function analysisRow(analysis: Analysis, jobId: string, model: string, profileKey: string | null) {
  return {
    jobId, trigger: "run_ai", model, analyzedAt: clockNow(),
    matchScore: analysis.match_score, matchGate: analysis.match_gate, recommendation: analysis.recommendation,
    summary: analysis.summary, disqualificationReason: analysis.disqualification_reason,
    details: {
      match_reasons: analysis.match_reasons, missing_requirements: analysis.missing_requirements,
      red_flags: analysis.red_flags, nice_to_have_matches: analysis.nice_to_have_matches,
      what_youll_do: analysis.what_youll_do, what_theyre_looking_for: analysis.what_theyre_looking_for,
      special_match: analysis.special_match, special_match_reasons: analysis.special_match_reasons,
      job_labels: analysis.job_labels,
    } as Prisma.InputJsonValue,
    companyKey: profileKey,
  };
}

export async function runAiOnCard(prisma: PrismaClient, cardId: string, client?: LlmClient): Promise<Result> {
  const card = await prisma.application.findUnique({ where: { id: cardId }, select: CARD_SELECT });
  if (!card) return { status: 404, body: { error: "Job not found" } };
  const job = card.job;
  if (!job.link) return { status: 400, body: { ok: false, error: "No job link", match_score: null } };
  if (!storedJdUsable(job)) {
    return { status: 409, body: { ok: false, error: NEEDS_LOCAL_SCRAPE, needs_local_scrape: true, match_score: null } };
  }
  if (!process.env.OPENAI_API_KEY && !client) {
    return { status: 503, body: { ok: false, error: "OPENAI_API_KEY is not set on this server", match_score: null } };
  }
  const [cv, rules] = await Promise.all([
    readDoc("user_profile.md", process.env.MATCH_PROFILE_PATH),
    readDoc("matching_rules.md", process.env.MATCH_RULES_PATH),
  ]);
  if (!cv) return { status: 503, body: { ok: false, error: "Missing user profile (docs/user_profile.md)", match_score: null } };

  // Take the lock: only if nobody is running this job (or their run is stale)
  const now = clockNow();
  const locked = await prisma.job.updateMany({
    where: {
      id: job.id,
      OR: [{ analysisState: { not: "running" } }, { analysisStartedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } }],
    },
    data: { analysisState: "running", analysisStartedAt: now },
  });
  if (!locked.count) return { status: 429, body: { ok: false, error: "Run AI is already running for this job", match_score: null } };
  const previousState = job.analysisState === "running" ? (job.currentAnalysisId ? "done" : "pending") : job.analysisState;
  const release = () => prisma.job.update({ where: { id: job.id }, data: { analysisState: previousState, analysisStartedAt: null } });

  const log: string[] = [];
  const say = (line: string) => log.push(line);
  try {
    const ai = client ?? (await createOpenAiClient());
    say(`Using the stored job description (${job.description.length} chars)`);
    const identity = await fillIdentity(ai, job, say);
    const settings = modelSettings();
    const result = await evaluate(
      { ...identity, description: job.description },
      { client: ai, cv, rules, settings, companyCache: companyCache(prisma), log: say },
    );
    const analysis = toAnalysis(result, matchThreshold());
    if (!analysis) {
      await release();
      say("AI analysis failed; the previous result is kept");
      return { status: 502, body: { ok: false, error: "AI analysis failed", match_score: null, log } };
    }
    const profileKey = Object.keys(analysis.company_profile).length ? companyKey(identity.company) || null : null;
    const model = typeof result.labels?._model === "string" ? result.labels._model : settings.jobModel;
    await prisma.$transaction(async (tx) => {
      const row = await tx.jobAnalysis.create({ data: analysisRow(analysis, job.id, model, profileKey), select: { id: true } });
      await tx.job.update({
        where: { id: job.id },
        data: {
          ...identity, currentAnalysisId: row.id, analysisState: "done", analysisStartedAt: null,
          needsRefetch: analysis.needs_refetch, updatedAt: clockNow(),
        },
      });
    });
    const gate = analysis.match_gate;
    say(gate !== "scored" ? `Stopped at the ${gate} gate; AI scoring was not run` : `AI score ${analysis.match_score}/10 saved`);
    return {
      status: 200,
      body: {
        ok: true, error: null, match_score: analysis.match_score, match_gate: gate,
        gate_reason: analysis.disqualification_reason, used_stored_jd: true,
        title: identity.title, company: identity.company, log,
      },
    };
  } catch (err) {
    await release().catch(() => {});
    const message = err instanceof OutOfCreditsError ? err.message : `Run AI failed: ${(err as Error).message}`;
    return { status: err instanceof OutOfCreditsError ? 402 : 500, body: { ok: false, error: message, match_score: null, log } };
  }
}

/** GET /api/jobs/<id>/run-ai/status: is a run going on for this card (any tab)? */
export async function runAiStatus(prisma: PrismaClient, cardId: string) {
  const card = await prisma.application.findUnique({
    where: { id: cardId },
    select: {
      job: {
        select: {
          analysisState: true, analysisStartedAt: true,
          currentAnalysis: { select: { matchScore: true, matchGate: true, disqualificationReason: true } },
        },
      },
    },
  });
  const j = card?.job;
  const running = !!j && j.analysisState === "running"
    && !!j.analysisStartedAt && clockNow().getTime() - j.analysisStartedAt.getTime() < STALE_LOCK_MS;
  return {
    running, job_id: cardId, log: [], ok: null, error: null,
    match_score: j?.currentAnalysis?.matchScore ?? null, match_gate: j?.currentAnalysis?.matchGate ?? null,
    gate_reason: j?.currentAnalysis?.disqualificationReason ?? null,
  };
}

