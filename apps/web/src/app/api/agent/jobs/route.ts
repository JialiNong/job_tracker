/**
 * POST /api/agent/jobs: token-authenticated Log Job for scheduled agents.
 * Header: Authorization: Bearer <AGENT_API_TOKEN>. Body: {"jobs": [...],
 * "recommended_by"?} or a bare job list. Disabled (503) without the token.
 * Not behind the login cookie (see middleware.ts).
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeRecommendedBy } from "@tracker/core";
import { prisma } from "@tracker/db/client";
import { jsonError } from "@/lib/http";
import { AGENT_JOBS_MAX, AGENTS, logAgentJobs, recordPushRun } from "@/server/agent";

export const dynamic = "force-dynamic";

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = (process.env.AGENT_API_TOKEN ?? "").trim();
  if (!expected) return jsonError("Agent API is disabled (AGENT_API_TOKEN not set)", 503);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || !tokenMatches(token, expected)) return jsonError("Unauthorized", 401);

  let data: unknown;
  try {
    data = await req.json();
  } catch {
    data = {};
  }
  if (Array.isArray(data)) data = { jobs: data }; // agents sometimes post the bare list
  if (!data || typeof data !== "object") return jsonError('Body must be {"jobs": [...]} or a job list', 400);
  const body = data as Record<string, unknown>;
  const jobs = body.jobs;
  if (!Array.isArray(jobs) || !jobs.length) return jsonError("jobs must be a non-empty list", 400);
  if (jobs.length > AGENT_JOBS_MAX) return jsonError(`At most ${AGENT_JOBS_MAX} jobs per request`, 400);

  const recError = "recommended_by must be claude, cursor, gemini, or gpt";
  const rec = String(body.recommended_by || "claude").trim().toLowerCase();
  if (!AGENTS.includes(rec)) return jsonError(recError, 400);
  for (const item of jobs) {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>).recommended_by : undefined;
    if (r && !normalizeRecommendedBy(r)) return jsonError(recError, 400);
  }

  const result = await logAgentJobs(prisma, jobs, rec);
  const recorded = await recordPushRun(prisma, rec, jobs.length, result);
  return NextResponse.json({
    recommended_by: rec,
    saved: result.ok.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
    already_on_tracker: result.already_on_tracker,
    below_threshold: result.below_threshold,
    awaiting_match: result.awaiting_match,
    timeout: result.timeout,
    below_threshold_jobs: result.existing.filter((e) => e.stage === "unmatched"),
    urls: { ok: result.ok, skipped: result.skipped, failed: result.failed, existing: result.existing },
    // Only when something failed, so a clean response keeps its old shape.
    ...(result.failed_reasons.length ? { failed_reasons: result.failed_reasons } : {}),
    // Jobs above were saved; only the Tracker's daily banner will miss this push
    ...(recorded ? {} : {
      run_recorded: false,
      run_recorded_error: "The jobs were processed, but this push could not be logged for the Tracker's daily summary.",
    }),
    ...(result.needs_link.length ? {
      needs_link: result.needs_link.map((j) => ({ ...j, open_path: `/?open=${j.card_id}` })),
    } : {}),
    ...(result.below_threshold ? {
      hint: "below_threshold jobs are already in Unmatched (scored below the match cut-off). "
        + "They were not added to the Tracker match list.",
    } : {}),
  });
}
