/**
 * What PATCH /status and PATCH /timeline write. Port of the update helpers in
 * src/web/status.py (_normalize_timeline, _status_update_fields,
 * _timeline_update_fields and the cancel / side-status rules they use).
 * Pure: the route turns the result into one transaction.
 */
import { now as clockNow } from "./clock.js";
import {
  APPLIED_STATUSES, CANCELLED_TIMELINE_STEP, INTERVIEW_TIMELINE_STEPS, SIDE_STATUSES,
  TIMELINE_STEPS, sortTimeline, statusFromTimeline, type TrackerJob,
} from "./status.js";
import { toInstant } from "./time.js";

export interface DatedEvent {
  step: string;
  at: Date;
}

/** Unknown steps in a payload: the route refuses them instead of dropping them silently. */
export function unknownTimelineSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const bad = new Set<string>();
  for (const item of raw) {
    if (item && typeof item === "object" && !((item as any).step in TIMELINE_STEPS)) bad.add(String((item as any).step));
  }
  return [...bad].sort();
}

/** Valid steps only, every one dated (missing / unreadable dates become now), in date order. */
export function normalizeTimeline(raw: unknown, now: Date = clockNow()): DatedEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: DatedEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const step = (item as any).step;
    if (!(step in TIMELINE_STEPS)) continue;
    out.push({ step, at: toInstant((item as any).at) ?? now });
  }
  return sortTimeline(out);
}

const priorEvents = (job: TrackerJob): DatedEvent[] =>
  (Array.isArray(job.application_timeline) ? job.application_timeline : [])
    .map((e) => ({ step: e.step, at: toInstant(e.at) }))
    .filter((e): e is DatedEvent => !!e.step && e.at !== null);

function latestCancel(events: { step: string; at: Date | null }[]): Date | null {
  let latest: Date | null = null;
  for (const e of events) {
    if (e.step === CANCELLED_TIMELINE_STEP && e.at && (!latest || e.at > latest)) latest = e.at;
  }
  return latest;
}

/**
 * Recording Cancelled means the scheduled interview did not happen: drop
 * rounds dated after the new cancel (the invite stays, Got interview still
 * counts). Only for a cancel that was not stored before.
 */
function pruneRoundsAfterNewCancel(job: TrackerJob, timeline: DatedEvent[]): DatedEvent[] {
  const cancel = latestCancel(timeline);
  if (!cancel || latestCancel(priorEvents(job))) return timeline;
  return timeline.filter((e) =>
    !(INTERVIEW_TIMELINE_STEPS.includes(e.step) && e.step !== "interview_invite" && e.at > cancel));
}

/** The stored Applied event, or one rebuilt from applied_at. */
function existingAppliedEvent(job: TrackerJob): DatedEvent | null {
  const raw = Array.isArray(job.application_timeline) ? job.application_timeline : [];
  for (const e of raw) {
    if (e?.step === "applied") {
      const at = toInstant(e.at);
      if (at) return { step: "applied", at };
    }
  }
  const at = toInstant(job.applied_at);
  return at ? { step: "applied", at } : null;
}

/** A side-status job keeps its Applied step when the payload left it out. */
function ensureAppliedRecord(job: TrackerJob, timeline: DatedEvent[]): DatedEvent[] {
  if (timeline.some((e) => e.step === "applied")) return timeline;
  const applied = existingAppliedEvent(job);
  return applied ? [applied, ...timeline] : timeline;
}

export interface StatusUpdate {
  status: string;
  /** undefined = leave as is; null = clear */
  appliedAt?: Date | null;
  applicantPosition?: null;
  /** undefined = leave the events as they are */
  events?: DatedEvent[];
}

/**
 * PATCH /status. Reset Not Applied clears the application record; side
 * statuses only change the status; entering an applied-like status stamps
 * applied_at once and never restamps it.
 */
export function statusUpdate(job: TrackerJob, newStatus: string, now: Date): StatusUpdate {
  if (newStatus === "pending") return { status: newStatus, events: [], appliedAt: null, applicantPosition: null };
  if ((APPLIED_STATUSES as readonly string[]).includes(newStatus) && !job.applied_at) {
    return { status: newStatus, appliedAt: now };
  }
  return { status: newStatus };
}

/**
 * PATCH /timeline. Side statuses stay; otherwise the status follows the
 * latest step. applied_at is set from the Applied event when missing, synced
 * to it when the job is not on a side status, and cleared only when the
 * status falls back to pending.
 */
export function timelineUpdate(job: TrackerJob, payload: DatedEvent[]): StatusUpdate & { events: DatedEvent[] } {
  let timeline = pruneRoundsAfterNewCancel(job, payload);
  const prevStatus = job.status || "pending";
  let status: string;
  if (SIDE_STATUSES.includes(prevStatus)) {
    timeline = ensureAppliedRecord(job, timeline);
    status = prevStatus;
  } else {
    status = statusFromTimeline(timeline, "pending");
  }
  timeline = sortTimeline(timeline);

  const result: StatusUpdate & { events: DatedEvent[] } = { status, events: timeline };
  const appliedEvent = timeline.find((e) => e.step === "applied");
  if (status === "pending") {
    result.appliedAt = null;
    result.applicantPosition = null;
  } else if (job.applied_at) {
    if (appliedEvent && !SIDE_STATUSES.includes(prevStatus)) result.appliedAt = appliedEvent.at;
  } else if (appliedEvent) {
    result.appliedAt = appliedEvent.at;
  } else if (timeline.length) {
    result.appliedAt = timeline[0]!.at;
  }
  return result;
}
