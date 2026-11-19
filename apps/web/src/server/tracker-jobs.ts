/**
 * Tracker cards: list filters, pagination, and the JSON for one card.
 * Replaces GET /api/jobs and GET /api/jobs/<id> of the Flask app
 * (src/web/routes/jobs.py, list_query.py, serialize.py).
 *
 * How a list request runs:
 *   1. Load every card's light fields (status, timeline, company, location,
 *      ...; no job description, no AI details). ~750 rows.
 *   2. Filter and sort them in memory with the same @tracker/core rules the
 *      chip counts use, then cut out the requested page.
 *   3. Load the full rows for that page only and serialize them.
 *
 * Why in memory instead of SQL WHERE: Applied / Screening / Interview /
 * Rejected are not stored columns, they are derived from the latest timeline
 * step. Filtering with the same function as the chip counts keeps the list
 * and the counts from ever disagreeing (the Flask app had exactly that bug).
 * At this size it takes a few milliseconds. If the data grows, store the
 * derived progress as a column on write and move the filters to SQL.
 */
import {
  LINK_ONLY_ANALYSIS, TIMEOUT_STUB_ANALYSIS, berlinDayBounds, companyGroupKey, companyHistoryItem, countryFilterKeys,
  jobCountry, matchesStatusFilter, normalizeOrigin, serializeJob, type TrackerJob,
} from "@tracker/core";
import type { CompanyProfile, Prisma, PrismaClient } from "@tracker/db/client";

const COMPANY_HISTORY_LIMIT = 30;

// ── Step 1: light rows ──────────────────────────────────────────────────────

const LIGHT_SELECT = {
  id: true,
  status: true,
  origin: true,
  appliedAt: true,
  addedAt: true,
  updatedAt: true,
  country: true,
  highlights: true,
  applicantPosition: true,
  events: { select: { step: true, at: true }, orderBy: [{ at: "asc" }, { id: "asc" }] },
  job: { select: { title: true, company: true, location: true, source: true } },
} satisfies Prisma.ApplicationSelect;

type LightRow = Prisma.ApplicationGetPayload<{ select: typeof LIGHT_SELECT }>;

export interface LightCard extends TrackerJob {
  _id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  origin: string;
  country: string | null;
  highlights: string[];
  applicant_position: number | null;
}

function toLightCard(row: LightRow): LightCard {
  return {
    _id: row.id,
    status: row.status,
    origin: row.origin,
    applied_at: row.appliedAt,
    updated_at: row.updatedAt,
    matched_at: row.addedAt,
    application_timeline: row.events.map((e) => ({ step: e.step, at: e.at })),
    title: row.job.title,
    company: row.job.company,
    location: row.job.location,
    source: row.job.source,
    country: row.country,
    highlights: row.highlights,
    applicant_position: row.applicantPosition,
  };
}

export async function loadLightCards(prisma: PrismaClient): Promise<LightCard[]> {
  const rows = await prisma.application.findMany({ select: LIGHT_SELECT });
  return rows.map(toLightCard);
}

// ── Step 2: filters (same query parameters as the Flask list) ───────────────

export interface ListFilters {
  status: string | null;
  source: string | null;
  country: string | null;
  q: string;
  companies: string[];
  dateFrom: string | null;
  dateTo: string | null;
  appliedOn: string | null;
  highlightsOnly: boolean;
  origin: string;
}

export function filtersFromParams(params: URLSearchParams): ListFilters {
  const text = (key: string) => (params.get(key) ?? "").trim();
  return {
    status: params.get("status"),
    source: params.get("source"),
    country: params.get("country"),
    q: text("q"),
    companies: params.getAll("company").filter((c) => c.trim()),
    dateFrom: text("date_from") || null,
    dateTo: text("date_to") || null,
    appliedOn: text("applied_on") || null,
    highlightsOnly: ["1", "true", "yes"].includes(text("highlights").toLowerCase()),
    origin: normalizeOrigin(params.get("origin")),
  };
}

const collapse = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const within = (d: Date | string | null | undefined, start: Date, end: Date) =>
  d instanceof Date && d >= start && d <= end;

export function matchesFilters(card: LightCard, f: ListFilters): boolean {
  if (!matchesStatusFilter(card, f.status)) return false;
  if (f.source && f.source !== "all" && card.source !== f.source) return false;

  const countries = countryFilterKeys(f.country);
  if (countries && !countries.includes(jobCountry(card.location, card.country))) return false;

  // Filters on the stored origin, like the Flask query (serialization infers "api" for old rows)
  if (f.origin && card.origin !== f.origin) return false;
  if (f.highlightsOnly && card.highlights.length === 0) return false;

  if (f.q) {
    // Case-insensitive substring. Flask passed the text to Mongo as a regex,
    // so "c++" crashed the request there; here it is plain text.
    const needle = f.q.toLowerCase();
    if (!card.title.toLowerCase().includes(needle) && !card.company.toLowerCase().includes(needle)) return false;
  }
  if (f.companies.length) {
    const wanted = new Set(f.companies.map(collapse).filter(Boolean));
    if (wanted.size && !wanted.has(collapse(card.company))) return false;
  }
  if (f.dateFrom || f.dateTo) {
    const start = f.dateFrom ? berlinDayBounds(f.dateFrom)?.start : undefined;
    const end = f.dateTo ? berlinDayBounds(f.dateTo)?.end : undefined;
    const matched = card.matched_at as Date;
    if (start && matched < start) return false;
    if (end && matched > end) return false;
  }
  if (f.appliedOn) {
    const day = berlinDayBounds(f.appliedOn);
    if (day) {
      const applied = within(card.applied_at as Date | null, day.start, day.end);
      const reapplied = (card.application_timeline ?? []).some(
        (e) => e.step === "reapplied" && within(e.at as Date, day.start, day.end),
      );
      if (!applied && !reapplied) return false;
    }
  }
  return true;
}

/** Newest first, like .sort("matched_at", -1). */
export function sortNewestFirst(cards: LightCard[]): LightCard[] {
  return [...cards].sort((a, b) => (b.matched_at as Date).getTime() - (a.matched_at as Date).getTime());
}

// ── Step 3: full rows for one page ──────────────────────────────────────────

const FULL_INCLUDE = {
  events: { orderBy: [{ at: "asc" }, { id: "asc" }] },
  job: {
    omit: { description: true }, // lazy-loaded via /api/jobs/<id>/description
    include: { currentAnalysis: { include: { company: true } } },
  },
} satisfies Prisma.ApplicationInclude;

type FullRow = Prisma.ApplicationGetPayload<{ include: typeof FULL_INCLUDE }>;

function profileFields(profile: CompanyProfile | null) {
  if (!profile) return null;
  return {
    business: profile.business,
    product_type: profile.productType,
    vertical: profile.vertical,
    markets: profile.markets,
    markets_detail: profile.marketsDetail,
  };
}

/** Postgres rows -> the card shape the serialization rules expect. */
export function toTrackerJob(row: FullRow, fromTimeout = false): TrackerJob & Record<string, unknown> {
  const { job } = row;
  const analysis = job.currentAnalysis;
  const details = (analysis?.details ?? {}) as Record<string, unknown>;
  const ai = analysis
    ? {
      match_score: analysis.matchScore,
      recommendation: analysis.recommendation,
      summary: analysis.summary,
      disqualification_reason: analysis.disqualificationReason,
      match_gate: analysis.matchGate,
      ...details,
      company_profile: profileFields(analysis.company),
    }
    : job.analysisState === "pending" ? { ...LINK_ONLY_ANALYSIS }
    // Added from the Timeouts page and not scraped since: the "added after scrape timeout" placeholder
    : fromTimeout ? { ...TIMEOUT_STUB_ANALYSIS } : {};
  return {
    _id: row.id,
    job_id: job.externalId,
    source: job.source,
    link: job.link,
    title: job.title,
    company: job.company,
    location: job.location,
    applicants: job.applicants,
    status: row.status,
    origin: row.origin,
    applied_at: row.appliedAt,
    matched_at: row.addedAt,
    updated_at: row.updatedAt,
    posted_at: job.postedAt,
    details_fetched_at: job.detailsFetchedAt,
    link_replaced_at: job.linkReplacedAt,
    ai_pending: job.analysisState === "pending",
    notes: row.notes,
    highlights: row.highlights,
    application_qa: row.applicationQa as unknown,
    applicant_position: row.applicantPosition,
    country: row.country,
    recommended_by: row.recommendedBy,
    recommend_reason: row.recommendReason,
    agent_recommended_by: job.agentRecommendedBy,
    agent_recommend_reason: job.agentRecommendReason,
    user_status: job.userStatus,
    from_unmatched: row.fromUnmatched,
    application_timeline: row.events.map((e) => ({ step: e.step, at: e.at })),
    ...ai,
  };
}

/** Other cards at the same company, newest first (the "Seen this company before" box). */
function attachCompanyHistory(
  serialized: Record<string, unknown>[], all: LightCard[],
): Record<string, unknown>[] {
  const byCompany = new Map<string, LightCard[]>();
  for (const card of sortNewestFirst(all)) {
    const key = companyGroupKey(card.company);
    if (key) byCompany.set(key, [...(byCompany.get(key) ?? []), card]);
  }
  return serialized.map((job) => {
    const key = companyGroupKey(job.company);
    const others = key ? (byCompany.get(key) ?? []).filter((c) => c._id !== job._id) : [];
    return {
      ...job,
      company_history: others.slice(0, COMPANY_HISTORY_LIMIT).map(companyHistoryItem),
      company_history_total: others.length,
    };
  });
}

/** source + job id of the cards without an AI result that were added from the Timeouts page. */
async function timeoutAddedKeys(prisma: PrismaClient, rows: FullRow[]): Promise<Set<string>> {
  const bare = rows.filter((r) => !r.job.currentAnalysis && r.job.analysisState !== "pending");
  if (!bare.length) return new Set();
  const hits = await prisma.scrapeTimeout.findMany({
    where: { reviewStatus: "added", OR: bare.map((r) => ({ source: r.job.source, externalId: r.job.externalId })) },
    select: { source: true, externalId: true },
  });
  return new Set(hits.map((t) => `${t.source}\u0000${t.externalId}`));
}

async function serializePage(prisma: PrismaClient, ids: string[], all: LightCard[]) {
  if (!ids.length) return [];
  const rows = await prisma.application.findMany({ where: { id: { in: ids } }, include: FULL_INCLUDE });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is FullRow => !!r);
  const fromTimeout = await timeoutAddedKeys(prisma, ordered);
  return attachCompanyHistory(
    ordered.map((r) => serializeJob(toTrackerJob(r, fromTimeout.has(`${r.job.source}\u0000${r.job.externalId}`)))), all,
  );
}

// ── Entry points ────────────────────────────────────────────────────────────

export async function listTrackerJobs(prisma: PrismaClient, params: URLSearchParams) {
  const pageSize = Math.max(1, Math.min(Number.parseInt(params.get("page_size") ?? "", 10) || 20, 100));
  const requested = Math.max(1, Number.parseInt(params.get("page") ?? "", 10) || 1);

  const all = await loadLightCards(prisma);
  const filters = filtersFromParams(params);
  const matching = sortNewestFirst(all.filter((c) => matchesFilters(c, filters)));

  const total = matching.length;
  const pages = total ? Math.ceil(total / pageSize) : 1;
  const page = Math.min(requested, pages);
  const ids = matching.slice((page - 1) * pageSize, page * pageSize).map((c) => c._id);

  return { jobs: await serializePage(prisma, ids, all), total, page, page_size: pageSize, pages };
}

export async function getTrackerJob(prisma: PrismaClient, id: string) {
  const exists = await prisma.application.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  const all = await loadLightCards(prisma);
  const [job] = await serializePage(prisma, [id], all);
  return job ?? null;
}

export async function getTrackerJobDescription(prisma: PrismaClient, id: string) {
  const row = await prisma.application.findUnique({
    where: { id }, select: { job: { select: { description: true } } },
  });
  return row ? row.job.description : null;
}
