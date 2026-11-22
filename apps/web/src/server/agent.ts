/**
 * POST /api/agent/jobs: scheduled agents (e.g. the daily Claude job push)
 * log recommended jobs as link-only Tracker cards. Port of
 * src/core/agent_push.py.
 *
 * A job already stored anywhere is skipped with no write, except that a
 * posting on Unmatched (or still waiting for the matcher) is tagged with the
 * agent and the reason, so Unmatched and the Overview can show "an agent
 * recommended this, the matcher did not".
 *
 * An Indeed short link whose redirect Indeed blocks has no job id. With a
 * title and company it is still saved, under an id built from those two (so
 * the same posting pushed again with a new short link is a duplicate), and
 * listed as "needs link": the user pastes the real viewjob link on the card.
 *
 * Every call is recorded in agent_push_runs for the Tracker's daily banner.
 */
import { createHash } from "node:crypto";
import {
  companyKey, detectSource, expandShortJobUrl, isHttpUrl, isShortJobUrl, normalizeManualIdentity, normalizeRecommendReason,
  normalizeRecommendedBy, now as clockNow, resolveJobId,
} from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
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
    + "which happens with encrypted click links. Send the job's https://de.indeed.com/viewjob?jk=<id> link, "
    + "or send title and company so it is saved as a card that needs its link fixed.",
  no_job_id: "Could not read a job id from this URL.",
  save_failed: "The tracker could not save this job (database error, see the server log).",
} as const;
export type FailedReason = keyof typeof FAILED_REASONS;

export type PushFailure = { url: string; reason: FailedReason; message: string; title: string; company: string };
export type NeedsLinkJob = { card_id: string; url: string; title: string; company: string };

/** Stand-in Indeed job id for a posting known only by title + company. */
export function unresolvedIndeedId(title: string, company: string): string {
  const key = `${companyKey(company)}|${title.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return `unresolved-${createHash("sha1").update(key, "utf8").digest("hex").slice(0, 16)}`;
}

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
    failed_reasons: [] as PushFailure[],
    needs_link: [] as NeedsLinkJob[],
    existing: [] as ReturnType<typeof existingRow>[],
    already_on_tracker: 0, below_threshold: 0, awaiting_match: 0, timeout: 0,
  };
  for (const raw of jobs) {
    const item = typeof raw === "string" ? { url: raw } : raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    if (!item) continue;
    const identity = normalizeManualIdentity(item.title, item.company, item.location);
    const title = identity.values.title ?? "";
    const company = identity.values.company ?? "";
    const fail = (url: string, reason: FailedReason) => {
      out.failed.push(url);
      out.failed_reasons.push({ url, reason, message: FAILED_REASONS[reason], title, company });
    };
    const pasted = String(item.url ?? "").trim();
    const url = (await expandShortJobUrl(pasted)) || pasted;
    if (!url) continue;
    if (!isHttpUrl(url)) { fail(url, "not_http"); continue; } // never store javascript: / data: links
    let source = detectSource(url);
    let jobId = resolveJobId(url, source);
    let pinned = false;
    if (!jobId && isShortJobUrl(url) && title && company) {
      source = "indeed";
      jobId = unresolvedIndeedId(title, company);
      pinned = true;
    }
    if (!jobId) { fail(url, isShortJobUrl(url) ? "short_link_unresolved" : "no_job_id"); continue; }
    const agent = normalizeRecommendedBy(item.recommended_by) || defaultAgent;

    const hit = await lookupKnownJob(prisma, jobId, source, pinned ? undefined : url);
    if (hit) {
      // Pushed again before the link was fixed: remind again today
      if (pinned && hit.on_tracker) out.needs_link.push({ card_id: hit._id, url, title, company });
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
    const saved = await saveLinkOnly(prisma, [url], {
      status: "pending", recommendedBy: agent, identity,
      recommendReason: String(item.reason ?? ""), country: String(item.country ?? ""),
      ...(pinned ? { pinnedId: { source, jobId } } : {}),
    });
    if (saved.ok.includes(url)) {
      out.ok.push(url);
      if (pinned) {
        const card = await lookupKnownJob(prisma, jobId, source);
        if (card?.on_tracker) out.needs_link.push({ card_id: card._id, url, title, company });
      }
    } else if (saved.skipped.includes(url)) out.skipped.push(url);
    else fail(url, "save_failed");
  }
  for (const row of out.existing) out[BUCKET[row.stage]!] += 1;
  return out;
}

/** One row per push for the Tracker's daily banner. Never fails the push itself. */
export async function recordPushRun(
  prisma: PrismaClient, agent: string, received: number, result: Awaited<ReturnType<typeof logAgentJobs>>,
) {
  try {
    await prisma.agentPushRun.create({
      data: {
        agent, received, saved: result.ok.length, skipped: result.skipped.length, failed: result.failed.length,
        failures: result.failed_reasons as unknown as Prisma.InputJsonValue,
        needsLinkJobs: result.needs_link as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error("agent push: could not record the run", err);
  }
}
