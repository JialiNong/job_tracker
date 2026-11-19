/**
 * Application timeline on the card: which "+ Step" buttons to offer, the
 * step a node is drawn as, the status pill, and the timeline a step write
 * sends. Ported from static/js/tracker/timeline.js. The status rules
 * themselves come from @tracker/core, the same code the API runs.
 */
import { SIDE_STATUSES, statusFromTimeline } from "@tracker/core/status";
import { STATUS_LABEL } from "./format";
import type { TimelineItem } from "./types";

export const TIMELINE_LABEL: Record<string, string> = {
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
const STEP_ORDER = Object.keys(TIMELINE_LABEL);
const INTERVIEW_ROUNDS = ["interview_1", "interview_2", "interview_3", "interview_final"];

export interface StepAction {
  step: string;
  label: string;
  cls: string;
}

const act = (step: string, cls: string): StepAction => ({ step, label: `+ ${TIMELINE_LABEL[step]}`, cls });
const SCREENING = act("screening", "btn-screening-step");
const SUBMITTED = act("screening_done", "btn-screening-step");
const INVITE = act("interview_invite", "btn-interview-step");
const REJECTED = act("rejected", "btn-reject-step");
const REAPPLIED = act("reapplied", "btn-apply-step");
const CANCELLED = act("interview_cancelled", "btn-cancel-step");
const OFFER = act("offer", "btn-offer-step");

/** "YYYY-MM-DD HH:MM" -> sortable number (wall clock, no zone needed for ordering). */
export function timelineTime(at: string | undefined): number {
  const m = String(at ?? "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2})?:?(\d{2})?/);
  if (!m) return 0;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0));
}

/** Date order; canonical step order breaks ties. */
export function sortTimeline<T extends { step: string; at?: string }>(timeline: T[]): T[] {
  return [...timeline].sort((a, b) =>
    timelineTime(a.at) - timelineTime(b.at) || STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));
}

/** Screening / Submitted stay recordable after an invite (they happened earlier). */
function withScreeningBackfill(timeline: TimelineItem[], forward: StepAction[]): StepAction[] {
  if (!timeline.length) return forward;
  const have = new Set(timeline.map((e) => e.step));
  const offered = new Set(forward.map((a) => a.step));
  const extras = [SCREENING, SUBMITTED].filter((a) => !have.has(a.step) && !offered.has(a.step));
  return [...extras, ...forward];
}

/** The steps after the latest Reapplied: the track restarts there. */
function trackAfterReapply(timeline: TimelineItem[]): { step: string }[] {
  const ordered = sortTimeline(timeline);
  const cut = ordered.map((e) => e.step).lastIndexOf("reapplied");
  if (cut < 0) return ordered;
  const rest = ordered.slice(cut + 1);
  return rest.length ? rest : [{ step: "applied" }];
}

function furthestStep(timeline: TimelineItem[]): string {
  const have = new Set(timeline.map((e) => e.step));
  return [...STEP_ORDER].reverse().find((s) => have.has(s)) ?? "";
}

/** The "+ Step" buttons a card offers next. */
export function nextActions(timeline: TimelineItem[]): StepAction[] {
  if (!timeline.length) return [act("applied", "btn-apply-step")];
  const track = trackAfterReapply(timeline);
  const last = track[track.length - 1]?.step || furthestStep(timeline) || timeline[timeline.length - 1]!.step;

  if (last === "rejected") return withScreeningBackfill(timeline, [REAPPLIED]);
  if (last === "offer") return withScreeningBackfill(timeline, []);
  const forward: Record<string, StepAction[]> = {
    applied: [SCREENING, INVITE, REJECTED, REAPPLIED],
    reapplied: [SCREENING, INVITE, REJECTED, REAPPLIED],
    screening: [SUBMITTED, INVITE, REJECTED],
    screening_done: [INVITE, REJECTED],
    interview_cancelled: [INVITE, REJECTED, REAPPLIED],
    interview_invite: [act("interview_1", "btn-interview-step"), CANCELLED, REJECTED],
  };
  if (forward[last]) return withScreeningBackfill(timeline, forward[last]!);
  const round = INTERVIEW_ROUNDS.indexOf(last);
  if (round >= 0) {
    const next = INTERVIEW_ROUNDS[round + 1];
    const actions = [...(next ? [act(next, "btn-interview-step")] : []), CANCELLED, REJECTED, OFFER];
    return withScreeningBackfill(timeline, actions);
  }
  return withScreeningBackfill(timeline, []);
}

export function stepClass(step: string): string {
  if (step === "applied") return "step-applied";
  if (step === "reapplied") return "step-reapplied";
  if (step.startsWith("screening")) return "step-screening";
  if (step === "rejected") return "step-rejected";
  if (step === "offer") return "step-offer";
  if (step === "interview_cancelled") return "step-cancelled";
  if (step.startsWith("interview_")) return "step-interview";
  return "";
}

/** Connector colour into the next node. */
export function lineClass(nextStep: string): string {
  if (nextStep === "rejected") return "progress-line done end-rejected";
  if (nextStep === "offer") return "progress-line done end-offer";
  if (nextStep === "interview_cancelled") return "progress-line done end-cancelled";
  return "progress-line done";
}

/** The card's status pill: "Reapplied" while the latest step is a reapply. */
export function statusPill(status: string, timeline: TimelineItem[]): { cls: string; label: string } {
  const ordered = sortTimeline(timeline);
  let shown = status || "pending";
  if (!SIDE_STATUSES.includes(shown) && ordered.length) shown = statusFromTimeline(ordered, shown);
  if (shown === "applied" && ordered[ordered.length - 1]?.step === "reapplied") {
    return { cls: "reapplied", label: "Reapplied" };
  }
  return { cls: shown, label: STATUS_LABEL[shown] || shown };
}

export const isAppliedLike = (status: string, timeline: TimelineItem[]) =>
  ["applied", "screening", "interview", "interview_cancelled", "rejected", "offer"].includes(status)
  || timeline.length > 0;

/**
 * The timeline to send when recording `step` at `at`. Recording Cancelled
 * also drops rounds dated after it (the interview did not happen).
 */
export function timelineWithStep(timeline: TimelineItem[], step: string, at: string): TimelineItem[] {
  let next = [...timeline];
  if (step === "interview_cancelled") {
    const cancelAt = timelineTime(at);
    next = next.filter((e) => !INTERVIEW_ROUNDS.includes(e.step) || timelineTime(e.at) <= cancelAt);
  }
  return sortTimeline([...next, { step, at }]);
}

// ── Picking a time ──────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** Now as a datetime-local value ("YYYY-MM-DDTHH:MM", the browser's clock). */
export function nowInputValue(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function toInputValue(at: string | undefined): string {
  const m = String(at ?? "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : nowInputValue();
}

export const fromInputValue = (value: string) => value.replace("T", " ");

function latestAt(timeline: TimelineItem[], step: string): string {
  return [...timeline].reverse().find((e) => e.step === step && e.at)?.at ?? "";
}

/** Backfilled Screening / Submitted start at an earlier time so they land before the invite. */
export function initialTimeFor(step: string, timeline: TimelineItem[]): string {
  if (step === "screening") return toInputValue(latestAt(timeline, "applied") || undefined);
  if (step === "screening_done") {
    return toInputValue(latestAt(timeline, "screening") || latestAt(timeline, "applied") || undefined);
  }
  return nowInputValue();
}

export function stepPrompt(step: string): string {
  const label = TIMELINE_LABEL[step] ?? step;
  switch (step) {
    case "applied": return "When did you apply for this job?";
    case "reapplied": return "When did you apply again (e.g. to the repost)?";
    case "screening": return "When did they send the screening? It is placed on the track by this date.";
    case "screening_done": return "When did you send the answers / video? It is placed on the track by this date.";
    case "interview_invite": return "When did you receive the interview invitation?";
    case "interview_cancelled":
      return "When did they cancel the interview? The invite stays, so Got interview does not change.";
    default: return `When did you get the “${label}” update?`;
  }
}

/** "YYYY-MM-DD HH:MM" -> ["MM-DD", "HH:MM"] for a node label. */
export function nodeTime(at: string): [string, string] | null {
  const m = String(at).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? [`${m[2]}-${m[3]}`, `${m[4]}:${m[5]}`] : null;
}
