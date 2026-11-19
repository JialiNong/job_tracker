/**
 * Application Journey (Overview): the date range from the first application
 * to today, the total count, and one track per job that reached an
 * interview. Port of api_journey in src/web/routes/stats.py.
 */
import { now as clockNow } from "./clock.js";
import {
  JOURNEY_INTERVIEW_STEPS, TIMELINE_STEPS, reappliedCount, resolveAppliedAt, sortTimeline, type TrackerJob,
} from "./status.js";
import { formatBerlin, formatBerlinDate, toInstant } from "./time.js";

/** Steps shown on a company track (Applied, Screening, rounds, Rejected, Offer …). */
const TRACK_STEPS = new Set([
  "applied", "reapplied", "screening", "screening_done", "interview_invite", "interview_1", "interview_2",
  "interview_3", "interview_final", "interview_cancelled", "rejected", "offer",
]);

export interface JourneyJob extends TrackerJob {
  _id: string;
  company?: string | null;
  title?: string | null;
}

interface Step {
  step: string;
  label: string;
  at: string;
  date: string;
  _at: Date;
}

const stepAt = (step: string, at: Date): Step => ({
  step, label: TIMELINE_STEPS[step] ?? step, at: formatBerlin(at), date: formatBerlinDate(at), _at: at,
});

const dayIndex = (d: Date) => {
  const [y, m, day] = formatBerlinDate(d).split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day) / 86_400_000;
};

export function buildJourney(jobs: JourneyJob[], now: Date = clockNow()) {
  let total = 0;
  let firstApplied: Date | null = null;
  const tracks: { job_id: string; company: string; title: string; status: string; steps: Omit<Step, "_at">[]; _sort: number }[] = [];

  for (const job of jobs) {
    const steps: Step[] = [];
    for (const e of Array.isArray(job.application_timeline) ? job.application_timeline : []) {
      if (!e || !TRACK_STEPS.has(e.step)) continue;
      const at = toInstant(e.at ?? null);
      if (at) steps.push(stepAt(e.step, at));
    }
    const appliedAt = resolveAppliedAt(job);
    total += 1 + reappliedCount(job);
    if (appliedAt && (!firstApplied || appliedAt < firstApplied)) firstApplied = appliedAt;
    if (appliedAt && !steps.some((s) => s.step === "applied")) steps.unshift(stepAt("applied", appliedAt));

    // Old records with a flat interview / offer status and no detailed timeline
    if (!steps.some((s) => JOURNEY_INTERVIEW_STEPS.includes(s.step))) {
      const fallback = () => toInstant(job.updated_at || appliedAt || null) ?? now;
      if (job.status === "interview") steps.push(stepAt("interview_invite", fallback()));
      else if (job.status === "offer") steps.push(stepAt("offer", fallback()));
    }
    if (!steps.some((s) => JOURNEY_INTERVIEW_STEPS.includes(s.step))) continue;

    const ordered = sortTimeline(steps.map((s) => ({ ...s, at: s._at })));
    tracks.push({
      job_id: job._id,
      company: job.company || "Unknown",
      title: job.title || "",
      status: job.status || "pending",
      steps: ordered.map(({ step, label, _at }) => ({ step, label, at: formatBerlin(_at), date: formatBerlinDate(_at) })),
      _sort: ordered.length ? ordered[ordered.length - 1]!._at.getTime() : Number.NEGATIVE_INFINITY,
    });
  }

  // Newest activity first (stable: equal dates keep their order, like Python's sort)
  tracks.sort((a, b) => b._sort - a._sort);

  // Axis end: today, or a later scheduled round
  let end = now;
  for (const t of tracks) {
    for (const s of t.steps) {
      const at = toInstant(s.at);
      if (at && at > end) end = at;
    }
  }
  return {
    start_date: firstApplied ? formatBerlinDate(firstApplied) : formatBerlinDate(now),
    end_date: formatBerlinDate(end),
    today: formatBerlinDate(now),
    duration_days: firstApplied ? dayIndex(end) - dayIndex(firstApplied) : 0,
    total_applied: total,
    tracks: tracks.map(({ _sort, ...t }) => t),
  };
}
