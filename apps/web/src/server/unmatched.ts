/**
 * Unmatched page: postings whose latest AI run scored below the cut-off,
 * and "Can Apply", which puts one on the Tracker. Replaces
 * src/web/routes/unmatched.py.
 *
 * "Can Apply" used to copy the whole posting into matched_jobs; now the card
 * simply points at the same posting, so the AI result is shared, not copied.
 */
import { berlinDayBounds, LINK_ONLY_ANALYSIS, now as clockNow, serializeJob } from "@tracker/core";
import type { CompanyProfile, Prisma, PrismaClient } from "@tracker/db/client";
import { newRecordId } from "./ids";
import { matchThreshold } from "./stats";

export const UNMATCHED_PAGE_SIZE = 20;
const USER_STATUSES = ["", "watchlist"]; // "" = unmarked, "watchlist" = Can Apply
const API_SOURCES = new Set(["ats", "arbeitsagentur", "arbeitnow", "adzuna"]);

const POSTING_INCLUDE = {
  currentAnalysis: { include: { company: true } },
} satisfies Prisma.JobInclude;
type PostingRow = Omit<Prisma.JobGetPayload<{ include: typeof POSTING_INCLUDE }>, "description">;

const profileFields = (p: CompanyProfile | null) => p && ({
  business: p.business, product_type: p.productType, vertical: p.vertical, markets: p.markets, markets_detail: p.marketsDetail,
});

/** A posting in the card shape (no Tracker fields: it has no card). */
function serializePosting(job: PostingRow) {
  const a = job.currentAnalysis;
  const details = (a?.details ?? {}) as Record<string, unknown>;
  return serializeJob({
    _id: job.id, job_id: job.externalId, source: job.source, link: job.link, title: job.title,
    company: job.company, location: job.location, applicants: job.applicants,
    // Found by the pipeline: API sources vs the scrapers (an agent push is tagged separately)
    origin: API_SOURCES.has(job.source) ? "api" : "pipeline",
    matched_at: a?.analyzedAt ?? null, posted_at: job.postedAt, details_fetched_at: job.detailsFetchedAt,
    link_replaced_at: job.linkReplacedAt, ai_pending: job.analysisState === "pending",
    user_status: job.userStatus, agent_recommended_by: job.agentRecommendedBy,
    agent_recommend_reason: job.agentRecommendReason,
    ...(a ? {
      match_score: a.matchScore, recommendation: a.recommendation, summary: a.summary,
      disqualification_reason: a.disqualificationReason, match_gate: a.matchGate, ...details,
      company_profile: profileFields(a.company),
    } : job.analysisState === "pending" ? { ...LINK_ONLY_ANALYSIS } : {}),
  });
}

function belowCutoff(): Prisma.JobWhereInput {
  return { currentAnalysis: { matchScore: { lt: matchThreshold() } } };
}

export async function listUnmatched(prisma: PrismaClient, params: URLSearchParams) {
  const pageSize = Math.max(1, Math.min(Number.parseInt(params.get("page_size") ?? "", 10) || UNMATCHED_PAGE_SIZE, 50));
  const requested = Math.max(1, Number.parseInt(params.get("page") ?? "", 10) || 1);
  const threshold = matchThreshold();
  const num = (key: string) => {
    const v = params.get(key);
    const n = v === null || v === "" ? Number.NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const agentOnly = ["1", "true", "yes"].includes((params.get("agent_recommended") ?? "").trim().toLowerCase());
  const scoreMin = num("score_min");
  const scoreMax = num("score_max");
  const score: Prisma.FloatNullableFilter = { lt: threshold };
  if (scoreMin !== null) score.gte = scoreMin;
  if (scoreMax !== null) score.lte = Math.min(scoreMax, threshold - 0.0001);

  const where: Prisma.JobWhereInput[] = [{ currentAnalysis: { matchScore: score } }];
  const source = params.get("source");
  if (source && source !== "all") where.push({ source });
  const gate = (params.get("match_gate") ?? "").trim();
  if (gate && gate !== "all") where.push({ currentAnalysis: { matchGate: gate } });
  if (params.get("user_status") === "watchlist") where.push({ userStatus: "watchlist" });
  if (agentOnly) where.push({ agentRecommendedBy: { notIn: [""] }, NOT: { agentRecommendedBy: null } });
  const q = (params.get("q") ?? "").trim();
  if (q) {
    // Plain text, case-insensitive (Flask passed it to Mongo as a regex)
    where.push({ OR: [
      { title: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } },
      { currentAnalysis: { disqualificationReason: { contains: q, mode: "insensitive" } } },
      { currentAnalysis: { summary: { contains: q, mode: "insensitive" } } },
    ] });
  }
  const from = params.get("date_from")?.trim();
  const to = params.get("date_to")?.trim();
  if (from || to) {
    const range: Prisma.DateTimeFilter = {};
    const start = from ? berlinDayBounds(from)?.start : undefined;
    const end = to ? berlinDayBounds(to)?.end : undefined;
    if (start) range.gte = start;
    if (end) range.lte = end;
    // With the agent filter, the day the agent pushed it; otherwise the day it was scored
    where.push(agentOnly ? { agentRecommendedAt: range } : { currentAnalysis: { analyzedAt: range } });
  }

  const filter: Prisma.JobWhereInput = { AND: where };
  const total = await prisma.job.count({ where: filter });
  const pages = total ? Math.ceil(total / pageSize) : 1;
  const page = Math.min(requested, pages);
  const rows = await prisma.job.findMany({
    where: filter, include: POSTING_INCLUDE, omit: { description: true },
    orderBy: { currentAnalysis: { analyzedAt: "desc" } }, skip: (page - 1) * pageSize, take: pageSize,
  });
  return { jobs: rows.map(serializePosting), total, page, page_size: pageSize, pages, threshold };
}

export async function getUnmatched(prisma: PrismaClient, id: string) {
  const row = await prisma.job.findFirst({
    where: { id, ...belowCutoff() }, include: POSTING_INCLUDE, omit: { description: true },
  });
  return row ? serializePosting(row) : null;
}

/** Mark Can Apply (watchlist) or clear it. Can Apply also puts the posting on the Tracker. */
export async function setUnmatchedStatus(prisma: PrismaClient, id: string, body: Record<string, unknown>) {
  const status = body.user_status ?? "";
  if (typeof status !== "string" || !USER_STATUSES.includes(status)) {
    return { status: 400, body: { error: `Invalid user_status. Allowed: ['', 'watchlist']` } };
  }
  const now = clockNow();
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id }, select: { id: true, source: true, application: { select: { id: true } } } });
    if (!job) return { status: 404, body: { error: "Job not found" } };
    await tx.job.update({ where: { id }, data: { userStatus: status, updatedAt: now } });
    let copied = false;
    if (status === "watchlist") {
      // Never touch an existing card (it may hold an application, notes …)
      if (!job.application) {
        await tx.application.create({
          data: {
            id: newRecordId(), jobId: id, status: "pending", fromUnmatched: true,
            origin: API_SOURCES.has(job.source) ? "api" : "pipeline", addedAt: now, updatedAt: now,
          },
        });
      }
      copied = true;
    }
    return { status: 200, body: { ok: true, user_status: status, copied_to_matched: copied, copy_error: null } };
  });
}
