/**
 * AI matching for newly scraped jobs (port of process_new_jobs in
 * src/matching/ai_matcher.py): every posting never analysed
 * (analysis_state = none), newest first. A score at or above the cut-off
 * puts the posting on the Tracker; below it stays on Unmatched.
 *
 * A posting scraped more than STALE_DAYS before it is scored (e.g. the
 * LinkedIn "Viewed" rows Python never scored) stays on Unmatched even with a
 * high score: it is not one of today's matches; Can apply still adds it.
 *
 * A failed model call is stored as a score-0 "score_failed" analysis so
 * the job is not retried forever (as in Python). Out of credits stops the
 * run: the remaining jobs wait for the next one.
 */
import { foundOrigin, now as clockNow } from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
import {
  type Analysis, type LlmClient, type ModelSettings, OutOfCreditsError, evaluate, isBlockedMatchCompany,
  scrubBulletLocation, toAnalysis,
} from "@tracker/matching";
import { prismaCompanyCache, profileKeyOf, saveAnalysis } from "./analysis-store.js";
import { newRecordId } from "./ids.js";

/** Older postings than this (scraped -> scored) do not go onto the Tracker automatically. */
export const STALE_DAYS = 7;

export interface MatchOptions {
  client: LlmClient;
  cv: string;
  rules: string;
  settings: ModelSettings;
  threshold: number;
  source?: string;
  limit?: number;
  log?: (line: string) => void;
  /** Defaults to STALE_DAYS. */
  staleDays?: number;
}

export interface MatchSummary {
  found: number;
  analysed: number;
  matched: number;
  failed: number;
  /** Scored ≥ threshold but a Tracker card already existed (not listed again). */
  alreadyOnTracker: number;
  /** Scored ≥ threshold but scraped too long ago to auto-add. */
  stale: number;
  /** Scored ≥ threshold but company is on the block list. */
  blocked: number;
  /** Analysed and scored below the cut-off. */
  belowThreshold: number;
  gates: Record<string, number>;
  stoppedReason: string | null;
  /** Tracker cards this run created (the Telegram digest lists them). */
  matchedCardIds: string[];
}

/** One Telegram / log line like Agent push: new · already stored · below cut-off. */
export function formatMatchOutcomeLine(s: Pick<
  MatchSummary,
  "matched" | "alreadyOnTracker" | "belowThreshold" | "stale" | "blocked" | "failed"
>): string {
  const parts = [`${s.matched} new on Tracker`];
  if (s.alreadyOnTracker) parts.push(`${s.alreadyOnTracker} already stored`);
  if (s.belowThreshold) parts.push(`${s.belowThreshold} below cut-off`);
  if (s.stale) parts.push(`${s.stale} too old to auto-add`);
  if (s.blocked) parts.push(`${s.blocked} blocked company`);
  if (s.failed) parts.push(`${s.failed} score failed`);
  return `🎯 Matcher: ${parts.join(" · ")}`;
}

/** Sum several source match runs into one summary for the Telegram header. */
export function mergeMatchSummaries(parts: MatchSummary[]): MatchSummary {
  const out: MatchSummary = {
    found: 0, analysed: 0, matched: 0, failed: 0, alreadyOnTracker: 0, stale: 0, blocked: 0,
    belowThreshold: 0, gates: {}, stoppedReason: null, matchedCardIds: [],
  };
  for (const s of parts) {
    out.found += s.found;
    out.analysed += s.analysed;
    out.matched += s.matched;
    out.failed += s.failed;
    out.alreadyOnTracker += s.alreadyOnTracker;
    out.stale += s.stale;
    out.blocked += s.blocked;
    out.belowThreshold += s.belowThreshold;
    out.matchedCardIds.push(...s.matchedCardIds);
    for (const [k, v] of Object.entries(s.gates)) out.gates[k] = (out.gates[k] ?? 0) + v;
    if (s.stoppedReason && !out.stoppedReason) out.stoppedReason = s.stoppedReason;
  }
  return out;
}

/** The stored result for a job whose model call failed (mark_job_as_matched with score 0). */
const FAILED_ANALYSIS: Analysis = {
  match_score: 0, recommendation: "No", special_match: false, special_match_reasons: [],
  disqualification_reason: "AI analysis failed", match_reasons: [], missing_requirements: [], red_flags: [],
  nice_to_have_matches: [], summary: "AI analysis failed; skipped to avoid reprocessing.",
  what_youll_do: { matched: [], unmatched: [] }, what_theyre_looking_for: { matched: [], unmatched: [] },
  match_gate: "score_failed", needs_refetch: false, job_labels: {}, company_profile: {},
};

const JOB_SELECT = {
  id: true, source: true, title: true, company: true, location: true, description: true, scrapedAt: true,
  application: { select: { id: true } },
} satisfies Prisma.JobSelect;

export async function matchNewJobs(prisma: PrismaClient, opts: MatchOptions): Promise<MatchSummary> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const jobs = await prisma.job.findMany({
    where: { analysisState: "none", ...(opts.source ? { source: opts.source } : {}) },
    orderBy: { scrapedAt: "desc" },
    take: opts.limit,
    select: JOB_SELECT,
  });
  const summary: MatchSummary = {
    found: jobs.length, analysed: 0, matched: 0, failed: 0, alreadyOnTracker: 0, stale: 0, blocked: 0,
    belowThreshold: 0, gates: {}, stoppedReason: null, matchedCardIds: [],
  };
  log(`Found ${jobs.length} new jobs to analyze`);
  const cache = prismaCompanyCache(prisma);

  for (const [i, job] of jobs.entries()) {
    log(`\n--- Job ${i + 1}/${jobs.length}: ${job.title} | ${job.company} (${job.source})`);
    let analysis: Analysis | null;
    let model = opts.settings.jobModel;
    try {
      const result = await evaluate(job, { client: opts.client, cv: opts.cv, rules: opts.rules, settings: opts.settings, companyCache: cache, log });
      analysis = toAnalysis(result, opts.threshold);
      if (typeof result.labels?._model === "string") model = result.labels._model;
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        summary.stoppedReason = err.message;
        log(`✗ ${err.message} — stopping; remaining jobs stay unmatched for the next run`);
        break;
      }
      throw err;
    }

    if (!analysis) {
      log("⚠ AI analysis failed — marked so it is not retried forever");
      await saveAnalysis(prisma, { jobId: job.id, analysis: FAILED_ANALYSIS, model, trigger: "pipeline", profileKey: null, state: "failed" });
      summary.failed += 1;
      continue;
    }

    summary.analysed += 1;
    summary.gates[analysis.match_gate] = (summary.gates[analysis.match_gate] ?? 0) + 1;
    log(`Score: ${analysis.match_score}/10 · gate: ${analysis.match_gate}`);
    if (analysis.disqualification_reason) log(`  ⚠ ${analysis.disqualification_reason.slice(0, 200)}`);
    for (const reason of analysis.match_reasons) log(`  • ${reason.slice(0, 200)}`);

    const ageDays = (Date.now() - job.scrapedAt.getTime()) / 86_400_000;
    const stale = ageDays > (opts.staleDays ?? STALE_DAYS);
    const blocked = isBlockedMatchCompany(job.company);
    const onTracker = analysis.match_score >= opts.threshold && !blocked && !job.application && !stale;
    const cardId = newRecordId();
    await prisma.$transaction(async (tx) => {
      await saveAnalysis(tx, {
        jobId: job.id, analysis, model, trigger: "pipeline", profileKey: profileKeyOf(analysis, job.company),
        // Never store a separator or a rating chip as the location (save_matched_job)
        jobFields: onTracker ? { location: scrubBulletLocation(job.location) } : undefined,
      });
      if (onTracker) {
        const now = clockNow();
        await tx.application.create({
          data: { id: cardId, jobId: job.id, status: "pending", origin: foundOrigin(job.source), addedAt: now, updatedAt: now },
        });
      }
    });
    if (onTracker) {
      summary.matched += 1;
      summary.matchedCardIds.push(cardId);
      log(`✓ Saved matched job: ${job.title} (score: ${analysis.match_score})`);
    } else if (analysis.match_score >= opts.threshold) {
      if (job.application) {
        summary.alreadyOnTracker += 1;
        log("Already on the Tracker");
      } else if (stale) {
        summary.stale += 1;
        log(`✗ Scraped ${Math.floor(ageDays)} days ago — kept on Unmatched (Can apply adds it)`);
      } else {
        summary.blocked += 1;
        log(`✗ Blocked company (${JSON.stringify(job.company)}) — not put on the Tracker`);
      }
    } else {
      summary.belowThreshold += 1;
      log(`✗ Below threshold (${opts.threshold}); kept on Unmatched`);
    }
  }

  log("\n=== Matching Complete ===");
  log(`Gates: ${Object.entries(summary.gates).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
  log(`Matched (≥ ${opts.threshold}): ${summary.matched}`);
  return summary;
}
