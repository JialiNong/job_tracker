/**
 * Tracker status + application timeline rules. Port of src/web/status.py;
 * checked against the Python answers in tests/contract/rule_cases.json.
 *
 * A "TrackerJob" is the Tracker card in the shape the rules were written for
 * (snake_case, timeline as [{step, at}]). Dates are instants or strings.
 */
import { now } from "./clock.js";
import { toInstant } from "./time.js";

export const APPLIED_STATUSES = ["applied", "screening", "rejected", "interview", "interview_cancelled", "offer"] as const;
export const PROGRESS_STAGES: readonly string[] = APPLIED_STATUSES;
export const SIDE_STATUSES: readonly string[] = [
  "unsuitable", "closed", "closed_no_reply", "prev_rejected", "too_many_questions", "repost", "duplicate",
];
export const ACTIVE_STATUS_FILTER = "active";
export const GOT_INTERVIEW_FILTER = "got_interview";

export const STATUS_MAP: Record<string, string> = {
  pending: "Not Applied",
  applied: "Applied",
  screening: "Screening",
  rejected: "Rejected",
  interview: "Interview",
  interview_cancelled: "Cancelled",
  offer: "Offer",
  unsuitable: "Unsuitable",
  closed: "Closed",
  closed_no_reply: "Closed · No Reply",
  prev_rejected: "Prev. Rejected",
  too_many_questions: "Skipped · Long Form",
  repost: "Repost",
  duplicate: "Duplicate",
};

export const TIMELINE_STEPS: Record<string, string> = {
  applied: "Applied",
  reapplied: "Reapplied",
  screening: "Screening",
  screening_done: "Submitted",
  interview_invite: "Invite",
  interview_1: "Round 1",
  interview_2: "Round 2",
  interview_3: "Round 3",
  interview_final: "Final",
  interview_cancelled: "Cancelled",
  rejected: "Rejected",
  offer: "Offer",
};
const STEP_ORDER = Object.keys(TIMELINE_STEPS);

export const INTERVIEW_TIMELINE_STEPS: readonly string[] = [
  "interview_invite", "interview_1", "interview_2", "interview_3", "interview_final",
];
export const CANCELLED_TIMELINE_STEP = "interview_cancelled";
export const SCREENING_TIMELINE_STEPS: readonly string[] = ["screening", "screening_done"];
/** Steps that mean the job reached an interview (Got interview chip). */
export const JOURNEY_INTERVIEW_STEPS: readonly string[] = [
  "interview_invite", "interview_1", "interview_2", "interview_3", "interview_final", "offer",
];

export interface TimelineEvent {
  step: string;
  at?: Date | string | null;
}

export interface TrackerJob {
  status?: string | null;
  applied_at?: Date | string | null;
  updated_at?: Date | string | null;
  matched_at?: Date | string | null;
  application_timeline?: TimelineEvent[] | null;
  [key: string]: unknown;
}

const timeOf = (e: TimelineEvent) => toInstant(e.at)?.getTime() ?? Number.NEGATIVE_INFINITY;
const rankOf = (step: string) => {
  const i = STEP_ORDER.indexOf(step);
  return i === -1 ? 99 : i;
};

/** Date order; canonical step order breaks ties (a backfilled Screening sits before Invite). */
export function sortTimeline<T extends TimelineEvent>(events: T[]): T[] {
  return events
    .filter((e) => e && typeof e === "object" && e.step)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => timeOf(a.e) - timeOf(b.e) || rankOf(a.e.step) - rankOf(b.e.step) || a.i - b.i)
    .map(({ e }) => e);
}

const isLiveInterview = (step: string) => INTERVIEW_TIMELINE_STEPS.includes(step) || step === "offer";
const isInterviewRelated = (step: string) => isLiveInterview(step) || step === CANCELLED_TIMELINE_STEP;

/** Status from the latest-dated timeline step. */
export function statusFromTimeline(timeline: TimelineEvent[], fallback = "pending"): string {
  const ordered = sortTimeline(timeline ?? []);
  if (!ordered.length) return SIDE_STATUSES.includes(fallback) || fallback === "pending" ? fallback : "pending";
  const steps = ordered.map((e) => e.step);
  let last = steps[steps.length - 1]!;
  if (SCREENING_TIMELINE_STEPS.includes(last) && steps.some(isInterviewRelated)) {
    last = [...steps].reverse().find(isInterviewRelated)!;
  }
  if (last === "applied" || last === "reapplied") return "applied";
  if (SCREENING_TIMELINE_STEPS.includes(last)) return "screening";
  if (last === CANCELLED_TIMELINE_STEP) return CANCELLED_TIMELINE_STEP;
  if (INTERVIEW_TIMELINE_STEPS.includes(last)) return "interview";
  if (last === "rejected") return "rejected";
  if (last === "offer") return "offer";
  return fallback;
}

const timelineOf = (job: TrackerJob) =>
  Array.isArray(job.application_timeline) ? job.application_timeline : [];

export function reachedInterview(job: TrackerJob): boolean {
  const raw = timelineOf(job);
  if (raw.length) return raw.some((e) => e && JOURNEY_INTERVIEW_STEPS.includes(e.step));
  const status = job.status || "pending";
  return status === "interview" || status === "offer" || status === CANCELLED_TIMELINE_STEP;
}

/** applied / screening / interview / interview_cancelled / rejected / offer, or null. */
export function applicationProgress(job: TrackerJob): string | null {
  const raw = timelineOf(job);
  if (raw.length) {
    const derived = statusFromTimeline(raw, "");
    return PROGRESS_STAGES.includes(derived) ? derived : null;
  }
  const status = job.status || "pending";
  if (status === "pending") return null;
  if (PROGRESS_STAGES.includes(status)) return status;
  if (job.applied_at) return "applied";
  return null;
}

/** Same rules as GET /api/jobs?status= and the chip counts. */
export function matchesStatusFilter(job: TrackerJob, filter: string | null | undefined): boolean {
  if (!filter || filter === "all") return true;
  const status = job.status || "pending";
  if (filter === ACTIVE_STATUS_FILTER) return !SIDE_STATUSES.includes(status);
  if (filter === GOT_INTERVIEW_FILTER) return reachedInterview(job);
  if (PROGRESS_STAGES.includes(filter)) return applicationProgress(job) === filter;
  return status === filter;
}

export function chipStatusCounts(jobs: TrackerJob[]): Record<string, number> {
  const counts: Record<string, number> = { [ACTIVE_STATUS_FILTER]: 0, [GOT_INTERVIEW_FILTER]: 0 };
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  for (const job of jobs) {
    const status = job.status || "pending";
    if (!SIDE_STATUSES.includes(status)) bump(ACTIVE_STATUS_FILTER);
    if (!PROGRESS_STAGES.includes(status)) bump(status);
    const progress = applicationProgress(job);
    if (progress) bump(progress);
    if (reachedInterview(job)) bump(GOT_INTERVIEW_FILTER);
  }
  return counts;
}

/** The timeline to show; older records without one are seeded from applied_at / status. */
export function hydrateTimeline(job: TrackerJob): TimelineEvent[] {
  const raw = timelineOf(job);
  if (raw.length) return sortTimeline(raw);
  const status = job.status || "pending";
  if (status === "pending") return [];
  if (!job.applied_at && !(APPLIED_STATUSES as readonly string[]).includes(status)) return [];
  const at = job.applied_at || job.updated_at || job.matched_at || null;
  const later = job.updated_at || at || now();
  const seeded: TimelineEvent[] = [{ step: "applied", at: at || now() }];
  if (status === "rejected") seeded.push({ step: "rejected", at: later });
  else if (status === "offer") seeded.push({ step: "offer", at: later });
  else if (status === "interview") seeded.push({ step: "interview_1", at: later });
  else if (status === CANCELLED_TIMELINE_STEP) {
    seeded.push({ step: "interview_invite", at: later }, { step: CANCELLED_TIMELINE_STEP, at: later });
  } else if (status === "screening") seeded.push({ step: "screening", at: later });
  return seeded;
}
