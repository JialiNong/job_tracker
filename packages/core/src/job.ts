/**
 * Serializing a Tracker card for the API. Port of src/web/serialize.py
 * (_serialize, company_history_item, _normalize_link), core/job_origin.py
 * (infer_origin) and core/manual_log.py (missing details / Fetch details).
 *
 * Output keeps the field names the frontend reads (tests/contract/
 * consumer_fields.json); internal fields are not exposed.
 */
import { COUNTRY_LABELS, jobCountry } from "./country.js";
import {
  SIDE_STATUSES, TIMELINE_STEPS, applicationProgress, hydrateTimeline, statusFromTimeline,
  type TrackerJob,
} from "./status.js";
import { formatBerlin, formatBerlinDate, toInstant } from "./time.js";

const AGENTS = ["claude", "cursor", "gemini", "gpt"];
const API_SOURCES = new Set(["ats", "arbeitsagentur", "arbeitnow", "adzuna"]);
const ORIGINS = ["pipeline", "manual", "agent", "api"];
export const IDENTITY_FIELDS = ["title", "company", "location"];
const LINK_ONLY_TITLE_PREFIX = "(Link only)";

export function normalizeRecommendedBy(value: unknown): string {
  const key = String(value ?? "").trim().toLowerCase();
  return AGENTS.includes(key) ? key : "";
}

export function normalizeOrigin(value: unknown): string {
  const key = String(value ?? "").trim().toLowerCase();
  return ORIGINS.includes(key) ? key : "";
}

const foundOrigin = (source: unknown) =>
  API_SOURCES.has(String(source ?? "").trim().toLowerCase()) ? "api" : "pipeline";

/** Best guess for rows saved before `origin` existed. */
export function inferOrigin(job: Record<string, unknown>): string {
  const stored = normalizeOrigin(job.origin);
  if (stored === "pipeline") return foundOrigin(job.source);
  if (stored) return stored;
  if (job.from_unmatched || job.from_timeout) return foundOrigin(job.source);
  if (job.created_at) return normalizeRecommendedBy(job.recommended_by) ? "agent" : "manual";
  return foundOrigin(job.source);
}

/** True when the card likely has no scraped JD yet. */
export function jobMissingDetails(job: Record<string, unknown>): boolean {
  const hasDescription = String(job.description ?? "").trim() !== "";
  if (job.details_fetched_at && hasDescription) return false;
  if (String(job.title ?? "").trim().startsWith(LINK_ONLY_TITLE_PREFIX)) return true;
  if (job.details_fetched_at) return false;
  if ("description" in job) return !hasDescription;
  if (job.ai_pending) return true;
  return String(job.summary ?? "").trim() === "";
}

function linkNeedsRefetch(job: Record<string, unknown>): boolean {
  const replaced = toInstant(job.link_replaced_at);
  if (!replaced) return false;
  const fetched = toInstant(job.details_fetched_at);
  return !fetched || replaced > fetched;
}

export function canFetchDetails(job: Record<string, unknown>): boolean {
  return jobMissingDetails(job) || normalizeRecommendedBy(job.recommended_by) !== "" || linkNeedsRefetch(job);
}

/** Canonical LinkedIn URL from the job id; anything else as stored. */
export function normalizeLink(job: Record<string, unknown>): string {
  const link = String(job.link ?? "");
  if (job.source === "linkedin") {
    if (link.startsWith("http") && !link.toLowerCase().includes("linkedin.com")) return link;
    const jobId = String(job.job_id ?? "");
    if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}/`;
    if (link && !link.startsWith("http")) return `https://www.linkedin.com${link}`;
  }
  return link;
}

/** "I was applicant #N": a whole number 1..100000, else null. */
export function parseApplicantPosition(raw: unknown): { value: number | null; error: string | null } {
  if (raw == null || (typeof raw === "string" && !raw.trim())) return { value: null, error: null };
  if (typeof raw === "boolean") return { value: null, error: "applicant_position must be a whole number" };
  const text = String(raw).trim().replace(/^#+/, "");
  if (!/^[+-]?\d+$/.test(text)) return { value: null, error: "applicant_position must be a whole number" };
  const value = Number.parseInt(text, 10);
  if (value < 1 || value > 100000) return { value: null, error: "applicant_position must be between 1 and 100000" };
  return { value, error: null };
}

const fmt = (v: unknown) => formatBerlin(toInstant(v)) || null;

/** The JSON for one Tracker card (list item, detail, deep link). */
export function serializeJob(job: TrackerJob & Record<string, any>): Record<string, unknown> {
  const timeline = hydrateTimeline(job)
    .filter((e) => e.step in TIMELINE_STEPS)
    .map((e) => ({ step: e.step, label: TIMELINE_STEPS[e.step]!, at: formatBerlin(toInstant(e.at)) }));
  const stored = job.status || "pending";
  const status = !SIDE_STATUSES.includes(stored) && timeline.length
    ? statusFromTimeline(timeline, stored)
    : stored;
  const country = jobCountry(job.location, job.country);
  const qa = Array.isArray(job.application_qa) ? job.application_qa : [];
  return {
    _id: job._id,
    title: job.title ?? "",
    company: job.company ?? "",
    location: job.location ?? "",
    link: normalizeLink(job),
    job_id: job.job_id ?? "",
    source: job.source ?? "",
    status,
    origin: inferOrigin(job),
    applicants: job.applicants ?? "",
    match_score: job.match_score ?? null,
    recommendation: job.recommendation ?? null,
    summary: job.summary ?? null,
    disqualification_reason: job.disqualification_reason ?? null,
    match_gate: job.match_gate ?? null,
    match_reasons: job.match_reasons ?? null,
    missing_requirements: job.missing_requirements ?? null,
    red_flags: job.red_flags ?? null,
    what_youll_do: job.what_youll_do ?? null,
    what_theyre_looking_for: job.what_theyre_looking_for ?? null,
    job_labels: job.job_labels ?? null,
    company_profile: job.company_profile ?? null,
    matched_at: fmt(job.matched_at),
    applied_at: fmt(job.applied_at),
    details_fetched_at: fmt(job.details_fetched_at),
    posted_at: formatBerlinDate(toInstant(job.posted_at)) || null,
    notes: job.notes ?? "",
    ai_pending: !!job.ai_pending,
    highlights: (Array.isArray(job.highlights) ? job.highlights : [])
      .map((h: unknown) => String(h).trim()).filter(Boolean),
    application_qa: qa.filter((x: unknown) => x && typeof x === "object")
      .map((x: any) => ({ question: String(x.question ?? ""), answer: String(x.answer ?? "") })),
    applicant_position: parseApplicantPosition(job.applicant_position).value,
    recommended_by: normalizeRecommendedBy(job.recommended_by),
    recommend_reason: String(job.recommend_reason ?? ""),
    agent_recommended_by: normalizeRecommendedBy(job.agent_recommended_by),
    agent_recommend_reason: String(job.agent_recommend_reason ?? ""),
    user_status: job.user_status ?? null,
    details_missing: jobMissingDetails(job),
    can_fetch_details: canFetchDetails(job),
    country,
    country_label: COUNTRY_LABELS[country] ?? "",
    application_timeline: timeline,
  };
}

/** One row under "Seen this company before". */
export function companyHistoryItem(job: TrackerJob & Record<string, any>): Record<string, unknown> {
  const timeline = hydrateTimeline(job);
  const day = (v: unknown) => formatBerlinDate(toInstant(v));
  return {
    _id: job._id,
    title: job.title ?? "",
    status: job.status || "pending",
    progress: applicationProgress(job) ?? "",
    applied_at: day(job.applied_at),
    matched_at: day(job.matched_at),
    last_step_at: timeline.length ? day(timeline[timeline.length - 1]!.at) : "",
    source: job.source ?? "",
    applicant_position: job.applicant_position ?? null,
  };
}

/** Company grouping key: whitespace collapsed, case-folded like Python's str.casefold(). */
export function companyGroupKey(company: unknown): string {
  return String(company ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/ß/g, "ss");
}

/**
 * What a link-only save shows until Run AI has a result (manual_log.py
 * stub_ai_pending_analysis). There is no job_analyses row for it.
 */
export const LINK_ONLY_ANALYSIS = Object.freeze({
  match_score: null,
  recommendation: "",
  special_match: false,
  special_match_reasons: [] as string[],
  disqualification_reason: "",
  match_reasons: ["Link-only save — AI pending"],
  missing_requirements: [] as string[],
  red_flags: [] as string[],
  nice_to_have_matches: [] as string[],
  summary: "Link saved without scrape/AI. Use Run AI on Tracker when Chrome is available.",
  what_youll_do: { matched: [] as string[], unmatched: [] as string[] },
  what_theyre_looking_for: { matched: [] as string[], unmatched: [] as string[] },
  match_gate: "",
  job_labels: {},
  company_profile: {},
});

/** What a card added from the Timeouts page shows until it is scraped (timeouts.py). */
export const TIMEOUT_STUB_ANALYSIS = Object.freeze({
  match_score: null,
  recommendation: "",
  special_match: false,
  special_match_reasons: [] as string[],
  disqualification_reason: "",
  match_reasons: ["Manually added after scrape timeout"],
  missing_requirements: [] as string[],
  red_flags: [] as string[],
  nice_to_have_matches: [] as string[],
  summary: "",
  what_youll_do: { matched: [] as string[], unmatched: [] as string[] },
  what_theyre_looking_for: { matched: [] as string[], unmatched: [] as string[] },
});

/** "(Link only) LinkedIn 4100…": the title of a card saved from a URL alone. */
export function linkOnlyTitle(url: string, source: string, jobId: string): string {
  if (source === "linkedin" && jobId) return `(Link only) LinkedIn ${jobId}`;
  if (source === "indeed" && jobId) return `(Link only) Indeed ${jobId}`;
  let short = (url ?? "").trim();
  if (short.length > 72) short = `${short.slice(0, 69)}…`;
  return `(Link only) ${short || "job"}`;
}

const IDENTITY_MAX_LEN: Record<string, number> = { title: 200, company: 160, location: 200 };

/** User-typed title / company / location for Log Job: whitespace collapsed, capped; empty ones dropped. */
export function normalizeManualIdentity(title?: unknown, company?: unknown, location?: unknown) {
  const values: Record<string, string> = {};
  for (const [field, raw] of [["title", title], ["company", company], ["location", location]] as const) {
    let text = String(raw ?? "").split(/\s+/).filter(Boolean).join(" ");
    if (text.length > IDENTITY_MAX_LEN[field]!) text = text.slice(0, IDENTITY_MAX_LEN[field]).trimEnd();
    if (text) values[field] = text;
  }
  return { values, manualFields: Object.keys(values) };
}

/** Agent's "why this job fits": trimmed, max 1000 characters. */
export function normalizeRecommendReason(value: unknown): string {
  const text = String(value ?? "").trim();
  return text.length > 1000 ? text.slice(0, 1000).trimEnd() : text;
}
