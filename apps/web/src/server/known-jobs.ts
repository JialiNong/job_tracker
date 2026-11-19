/**
 * "Is this posting already stored?" for Log Job, the agent API and link
 * replacement. Port of lookup_known_job (src/core/mongo/lookup.py): by
 * source + job id first (Indeed: every jk variant), then by the URL's
 * posting key; a Tracker card wins over a scraped posting, which wins over
 * a timeout still waiting for review.
 */
import { indeedJobIdVariants, postingKey } from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";

export type Stage = "tracker" | "unmatched" | "awaiting_match" | "timeout";

export interface KnownJob {
  collection: "matched_jobs" | "jobs" | "timeout_jobs";
  stage: Stage;
  on_tracker: boolean;
  _id: string; // the card id for Tracker hits, else the posting / timeout id
  jobId: string; // the posting row (jobs.id), "" for a timeout
  title: string;
  company: string;
  status: string;
  source: string;
  job_id: string;
  match_score: number | null;
  match_gate: string;
  ai_pending: boolean;
  details_fetched_at: Date | null;
  summary: string;
  description: string;
  matched_by: "job_id" | "posting_key";
}

const JOB_SELECT = {
  id: true, source: true, externalId: true, title: true, company: true, userStatus: true,
  analysisState: true, detailsFetchedAt: true, description: true,
  currentAnalysis: { select: { matchScore: true, matchGate: true, summary: true } },
  application: { select: { id: true, status: true } },
} satisfies Prisma.JobSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

function fromJob(row: JobRow, matchedBy: KnownJob["matched_by"]): KnownJob {
  const analysis = row.currentAnalysis;
  const base = {
    jobId: row.id, title: row.title, company: row.company, source: row.source, job_id: row.externalId,
    match_score: analysis?.matchScore ?? null, match_gate: analysis?.matchGate ?? "",
    ai_pending: row.analysisState === "pending", details_fetched_at: row.detailsFetchedAt,
    summary: analysis?.summary ?? "", description: row.description, matched_by: matchedBy,
  };
  if (row.application) {
    return { ...base, collection: "matched_jobs", stage: "tracker", on_tracker: true, _id: row.application.id, status: row.application.status };
  }
  // Scored (below the cut-off) -> on Unmatched; never scored -> still waiting for the matcher
  return {
    ...base, collection: "jobs", stage: analysis ? "unmatched" : "awaiting_match", on_tracker: false,
    _id: row.id, status: row.userStatus ?? "",
  };
}

async function byId(prisma: PrismaClient, jobId: string, source: string): Promise<KnownJob | null> {
  const ids = source === "indeed" ? indeedJobIdVariants(jobId) : [jobId];
  if (!ids.length) return null;
  const job = await prisma.job.findFirst({ where: { source, externalId: { in: ids } }, select: JOB_SELECT });
  if (job) return fromJob(job, "job_id");
  const timeout = await prisma.scrapeTimeout.findFirst({
    where: { source, externalId: { in: ids }, reviewStatus: { not: "added" } },
  });
  if (!timeout) return null;
  return {
    collection: "timeout_jobs", stage: "timeout", on_tracker: false, _id: timeout.id, jobId: "",
    title: timeout.title, company: timeout.company, status: timeout.reviewStatus, source: timeout.source,
    job_id: timeout.externalId, match_score: null, match_gate: "", ai_pending: false, details_fetched_at: null,
    summary: "", description: "", matched_by: "job_id",
  };
}

export async function lookupKnownJob(
  prisma: PrismaClient, jobId: string, source: string, link?: string,
): Promise<KnownJob | null> {
  const id = (jobId ?? "").trim();
  const src = (source ?? "").trim().toLowerCase();
  if (id && src) {
    const hit = await byId(prisma, id, src);
    if (hit) return hit;
  }
  const key = link ? postingKey(link) : null;
  if (key) {
    const job = await prisma.job.findFirst({ where: { postingKey: key }, select: JOB_SELECT });
    if (job) return fromJob(job, "posting_key");
  }
  return null;
}

/** Where a hit opens: its Tracker card, its Unmatched card, or the Timeouts page. */
export function openPath(hit: KnownJob): string | null {
  if (hit.stage === "tracker") return `/?open=${hit._id}`;
  if (hit.stage === "unmatched") return `/unmatched?open=${hit._id}`;
  if (hit.stage === "timeout") return "/timeouts";
  return null; // awaiting_match: scraped but not scored, nowhere to open yet
}
