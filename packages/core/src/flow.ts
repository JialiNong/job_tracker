/**
 * Overview flow charts: the 3-column Sankey (one current path per
 * application) and applications per ISO week by platform. Port of
 * src/web/flow.py; checked against Python answers in rule_cases.json.
 */
import { now as clockNow } from "./clock.js";
import {
  CANCELLED_TIMELINE_STEP, SCREENING_TIMELINE_STEPS, hydrateTimeline, resolveAppliedAt, type TrackerJob,
} from "./status.js";
import { formatBerlinDate, toInstant } from "./time.js";

const PLATFORM_KEYS = ["linkedin", "indeed", "other"] as const;
type Platform = (typeof PLATFORM_KEYS)[number];

const INTERVIEW_RANK: Record<string, number> = {
  interview_invite: 0, interview_1: 1, interview_2: 2, interview_3: 3, interview_final: 4,
};
const REJECTED_AT = ["rejected_invite", "rejected_1", "rejected_2", "rejected_later", "rejected_later"];
const IN_PROGRESS: Record<string, [string, string]> = { // [past, upcoming]
  interview_invite: ["awaiting", "awaiting"],
  interview_1: ["round_1", "round_1_upcoming"],
  interview_2: ["round_2", "round_2_upcoming"],
  interview_3: ["later", "later_upcoming"],
  interview_final: ["later", "later_upcoming"],
};
const COL1_SINKS = new Set(["waiting", "rejected", "screening"]);

export const SANKEY_NODES = [
  { id: "applied", label: "Applied", column: 0, tone: "applied" },
  { id: "interview", label: "Interview", column: 1, tone: "interview" },
  { id: "screening", label: "Screening", column: 1, tone: "screening" },
  { id: "waiting", label: "Waiting", column: 1, tone: "waiting" },
  { id: "rejected", label: "Rejected", column: 1, tone: "rejected" },
  { id: "awaiting", label: "Awaiting interview", column: 2, tone: "interview" },
  { id: "cancelled", label: "Interview cancelled", column: 2, tone: "cancelled" },
  { id: "round_1_upcoming", label: "Round 1 upcoming", column: 2, tone: "interview" },
  { id: "round_1", label: "After round 1", column: 2, tone: "interview" },
  { id: "rejected_invite", label: "Invite rejected", column: 2, tone: "rejected" },
  { id: "rejected_1", label: "Round 1 rejected", column: 2, tone: "rejected" },
  { id: "round_2_upcoming", label: "Round 2 upcoming", column: 2, tone: "interview" },
  { id: "round_2", label: "After round 2", column: 2, tone: "interview" },
  { id: "rejected_2", label: "Round 2 rejected", column: 2, tone: "rejected" },
  { id: "later_upcoming", label: "Later round upcoming", column: 2, tone: "interview" },
  { id: "later", label: "Later rounds", column: 2, tone: "interview" },
  { id: "rejected_later", label: "Later rejected", column: 2, tone: "rejected" },
  { id: "offer", label: "Offer", column: 2, tone: "offer" },
] as const;

export function platformBucket(source: unknown): Platform {
  const key = String(source ?? "").trim().toLowerCase();
  return key === "linkedin" || key === "indeed" ? key : "other";
}

/** "YYYY-MM-DD" of the Monday (Berlin calendar) of the week containing `at`. */
export function weekMonday(at: Date | string | null | undefined): string | null {
  const instant = toInstant(at);
  if (!instant) return null;
  const [y, m, d] = formatBerlinDate(instant).split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** The track after the latest Reapplied (a reapply restarts it). */
function eventsAfterReapply(job: TrackerJob) {
  const events = hydrateTimeline(job).filter((e) => e?.step).map((e) => ({ step: e.step, at: e.at ?? null }));
  const last = events.map((e) => e.step).lastIndexOf("reapplied");
  if (last < 0) return events;
  const rest = events.slice(last + 1);
  return rest.length ? rest : [{ step: "applied", at: null }];
}

/** Where one application sits now. A round dated in the future is "upcoming". */
export function classifyFlowSink(job: TrackerJob, now: Date = clockNow()): string {
  const events = eventsAfterReapply(job);
  let last = events.length ? events[events.length - 1]!.step : "applied";
  const steps = events.map((e) => e.step);
  const ranks = steps.filter((s) => s in INTERVIEW_RANK).map((s) => INTERVIEW_RANK[s]!);
  // A backfilled Screening must not hide an invite / round already on the track
  if (SCREENING_TIMELINE_STEPS.includes(last) && ranks.length) {
    last = events.filter((e) => e.step in INTERVIEW_RANK)
      .reduce((best, e) => (INTERVIEW_RANK[e.step]! > INTERVIEW_RANK[best.step]! ? e : best)).step;
  }
  const hasOffer = last === "offer" || steps.includes("offer");
  if (hasOffer && last !== "rejected") return "offer";
  if (last === CANCELLED_TIMELINE_STEP) return "cancelled";
  if (last === "rejected") return ranks.length ? REJECTED_AT[Math.max(...ranks)]! : "rejected";
  if (last in INTERVIEW_RANK) {
    const event = [...events].reverse().find((e) => e.step === last);
    const at = toInstant(event?.at ?? null);
    return IN_PROGRESS[last]![at && at > now ? 1 : 0]!;
  }
  if (SCREENING_TIMELINE_STEPS.includes(last)) return "screening";
  return "waiting";
}

export function buildSankey(jobs: TrackerJob[], now: Date = clockNow()) {
  const links = new Map<string, number>(); // insertion order, like Python's Counter
  const sinks = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const job of jobs) {
    const sink = classifyFlowSink(job, now);
    bump(sinks, sink);
    if (COL1_SINKS.has(sink)) bump(links, `applied>${sink}`);
    else { bump(links, "applied>interview"); bump(links, `interview>${sink}`); }
  }
  const interviewed = [...sinks].filter(([s]) => !COL1_SINKS.has(s)).reduce((n, [, c]) => n + c, 0);
  const counts = new Map<string, number>([["applied", jobs.length], ["interview", interviewed], ...sinks]);
  let nodes = SANKEY_NODES
    .map((meta) => ({ ...meta, value: counts.get(meta.id) ?? 0 }))
    .filter((n) => n.value > 0 || n.id === "applied");
  if (!jobs.length) nodes = [{ ...SANKEY_NODES[0], value: 0 }];
  return {
    total: jobs.length,
    nodes,
    links: [...links].map(([k, value]) => {
      const [source, target] = k.split(">") as [string, string];
      return { source, target, value };
    }),
  };
}

/**
 * Applications per week (Monday start, Berlin), stacked by platform: one for
 * the first apply date plus one per Reapplied step. Empty weeks between the
 * first apply and this week are included.
 */
export function buildWeeklyByPlatform(jobs: TrackerJob[], today: Date = clockNow()) {
  const buckets = new Map<string, Record<Platform, number>>();
  const add = (week: string | null, platform: Platform) => {
    if (!week) return;
    const b = buckets.get(week) ?? { linkedin: 0, indeed: 0, other: 0 };
    b[platform] += 1;
    buckets.set(week, b);
  };
  for (const job of jobs) {
    const platform = platformBucket(job.source);
    add(weekMonday(resolveAppliedAt(job)), platform);
    for (const e of Array.isArray(job.application_timeline) ? job.application_timeline : []) {
      if (e?.step === "reapplied") add(weekMonday(e.at ?? null), platform);
    }
  }
  const totals = { linkedin: 0, indeed: 0, other: 0 };
  if (!buckets.size) return { weeks: [], totals: { ...totals, total: 0 } };

  const start = [...buckets.keys()].sort()[0]!;
  let end = weekMonday(today) ?? start;
  if (end < start) end = start;
  const weeks = [];
  for (let cursor = start; cursor <= end;) {
    const b = buckets.get(cursor) ?? { linkedin: 0, indeed: 0, other: 0 };
    weeks.push({ week_start: cursor, ...b, total: b.linkedin + b.indeed + b.other });
    for (const k of PLATFORM_KEYS) totals[k] += b[k];
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    cursor = next.toISOString().slice(0, 10);
  }
  return { weeks, totals: { ...totals, total: totals.linkedin + totals.indeed + totals.other } };
}
