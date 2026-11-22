/**
 * POST /api/agent/jobs: scheduled agents (e.g. the daily Claude job push)
 * log recommended jobs as link-only Tracker cards. Port of
 * src/core/agent_push.py.
 *
 * A job already stored anywhere is skipped with no write, except that a
 * posting on Unmatched (or still waiting for the matcher) is tagged with the
 * agent and the reason, so Unmatched and the Overview can show "an agent
 * recommended this, the matcher did not".
 */
import {
  detectSource, expandShortJobUrl, isHttpUrl, isShortJobUrl, normalizeManualIdentity, normalizeRecommendReason,
  normalizeRecommendedBy, now as clockNow, resolveJobId,
} from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";
import { type KnownJob, lookupKnownJob, openPath } from "./known-jobs";
import { saveLinkOnly } from "./link-only";

export const AGENT_JOBS_MAX = 50;
export const AGENTS = ["claude", "cursor", "gemini", "gpt"];

const BUCKET: Record<string, "already_on_tracker" | "below_threshold" | "awaiting_match" | "timeout"> = {
  tracker: "already_on_tracker", unmatched: "below_threshold", awaiting_match: "awaiting_match", timeout: "timeout",
};

/** Why a URL landed in `failed`, so the agent can report it or retry with a better link. */
export const FAILED_REASONS = {
  not_http: "Not an http(s) job link.",
  short_link_unresolved:
    "This Indeed short link did not lead to a job key (jk=): Indeed blocked the redirect, "
    + "which happens with encrypted click links. Send the job's https://de.indeed.com/viewjob?jk=<id> link instead.",
  no_job_id: "Could not read a job id from this URL.",
  save_failed: "The tracker could not save this job (database error, see the server log).",
} as const;
export type FailedReason = keyof typeof FAILED_REASONS;

function existingRow(url: string, jobId: string, hit: KnownJob) {
  return {
    url,
    job_id: hit.job_id || jobId,
    stage: hit.stage,
    on_tracker: hit.on_tracker,
    title: hit.title,
    company: hit.company,
    match_score: hit.match_score,
    match_gate: hit.match_gate,
    open_path: openPath(hit) ?? (hit.stage === "tracker" ? "/" : null),
  };
}

export async function logAgentJobs(prisma: PrismaClient, jobs: unknown[], defaultAgent: string) {
  const out = {
    ok: [] as string[], skipped: [] as string[], failed: [] as string[],
    failed_reasons: [] as { url: string; reason: FailedReason; message: string }[],
    existing: [] as ReturnType<typeof existingRow>[],
    already_on_tracker: 0, below_threshold: 0, awaiting_match: 0, timeout: 0,
  };
  const fail = (url: string, reason: FailedReason) => {
    out.failed.push(url);
    out.failed_reasons.push({ url, reason, message: FAILED_REASONS[reason] });
  };
  for (const raw of jobs) {
    const item = typeof raw === "string" ? { url: raw } : raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    if (!item) continue;
    const pasted = String(item.url ?? "").trim();
    const url = (await expandShortJobUrl(pasted)) || pasted;
    if (!url) continue;
    if (!isHttpUrl(url)) { fail(url, "not_http"); continue; } // never store javascript: / data: links
    const source = detectSource(url);
    const jobId = resolveJobId(url, source);
    if (!jobId) { fail(url, isShortJobUrl(url) ? "short_link_unresolved" : "no_job_id"); continue; }
    const agent = normalizeRecommendedBy(item.recommended_by) || defaultAgent;

    const hit = await lookupKnownJob(prisma, jobId, source, url);
    if (hit) {
      if (hit.stage === "unmatched" || hit.stage === "awaiting_match") {
        const reason = normalizeRecommendReason(item.reason);
        await prisma.job.update({
          where: { id: hit.jobId },
          data: { agentRecommendedBy: agent, agentRecommendedAt: clockNow(), ...(reason ? { agentRecommendReason: reason } : {}) },
        });
      }
      out.skipped.push(url);
      out.existing.push(existingRow(url, jobId, hit));
      continue;
    }
    const identity = normalizeManualIdentity(item.title, item.company, item.location);
    const saved = await saveLinkOnly(prisma, [url], {
      status: "pending", recommendedBy: agent, identity,
      recommendReason: String(item.reason ?? ""), country: String(item.country ?? ""),
    });
    if (saved.ok.includes(url)) out.ok.push(url);
    else if (saved.skipped.includes(url)) out.skipped.push(url);
    else fail(url, "save_failed");
  }
  for (const row of out.existing) out[BUCKET[row.stage]!] += 1;
  return out;
}
