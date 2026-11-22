/**
 * Pure display helpers for Tracker cards. Ported from static/js/shared/
 * job_list.js and static/js/tracker/cards.js; no DOM, no React.
 */
import type { CompanyProfile, HistoryItem, Job } from "./types";

export const STATUS_LABEL: Record<string, string> = {
  pending: "Not applied",
  applied: "Applied",
  screening: "Screening",
  rejected: "Rejected",
  interview: "Interview",
  interview_cancelled: "Cancelled",
  offer: "Offer",
  unsuitable: "Unsuitable",
  closed: "Closed",
  closed_no_reply: "Closed, no reply",
  prev_rejected: "Rejected before",
  too_many_questions: "Skipped, long form",
  repost: "Repost",
  duplicate: "Duplicate",
};

export const SOURCE_BADGE: Record<string, { label: string; title: string }> = {
  ats: { label: "ATS", title: "Company careers page (ATS board)" },
  arbeitsagentur: { label: "Bundesagentur", title: "Bundesagentur für Arbeit Jobsuche API" },
  arbeitnow: { label: "Arbeitnow API", title: "Arbeitnow job board API" },
  adzuna: { label: "Adzuna API", title: "Adzuna job search API" },
};
export const BOARD_LABEL: Record<string, string> = { linkedin: "LinkedIn", indeed: "Indeed" };
export const RECOMMENDED_BY_LABEL: Record<string, string> = {
  claude: "Claude", cursor: "Cursor", gemini: "Gemini", gpt: "GPT",
};
export const ORIGIN_PILL: Record<string, { label: string; title: string }> = {
  pipeline: { label: "Scraper", title: "Found by the LinkedIn / Indeed scraper" },
  manual: { label: "Log job", title: "Logged by hand via Log Job" },
};
/** Why Run AI stopped before scoring (match_gate). */
export const GATE_LABELS: Record<string, string> = {
  german: "German required",
  stack: "Non-JS backend required",
  leadership: "Leadership role",
  not_web_dev: "Not web development",
  backend_heavy: "Backend-heavy",
  too_many_years: "Too many years required",
  contract_or_location: "Contract type / location",
  blocked_company: "Blocked company",
  empty_desc: "Empty JD",
  incomplete_desc: "Unusable JD",
  non_english: "Not English",
  ai_ml: "AI/ML role",
};
export const HIGHLIGHT_PRESETS = ["Leipzig", "Chinese+"];
export const MAX_HIGHLIGHTS = 8;

/** Job links come from scrapers, APIs and agents: only http(s) or same-site paths reach an href. */
export function safeUrl(raw: string | null | undefined, fallback = "#"): string {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  if (text.startsWith("/") && !text.startsWith("//")) return text;
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : fallback;
  } catch {
    return fallback;
  }
}

/** An Indeed short link with no job id: the card needs the real viewjob link pasted. */
export function needsLinkFix(link: string | null | undefined): boolean {
  return hostOf(link) === "to.indeed.com";
}

export function hostOf(link: string | null | undefined): string {
  try {
    return new URL(link ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ── Score ───────────────────────────────────────────────────────────────────

export const hasAiScore = (job: Pick<Job, "match_score">) =>
  job.match_score !== null && job.match_score !== undefined;

export function scoreClass(score: number | null): string {
  if (score === null) return "score-pending";
  if (score >= 8) return "score-hi";
  if (score >= 6) return "score-mid";
  return "score-lo";
}

export const scoreLabel = (score: number | null) =>
  score === null ? "—" : score % 1 === 0 ? String(score) : score.toFixed(1);

export const scorePercent = (score: number | null) =>
  score === null || !Number.isFinite(score) ? 0 : Math.max(0, Math.min(100, score * 10));

/** Run AI still needed: no result, no score, or no summary. */
export const needsAi = (job: Job) => job.ai_pending || !hasAiScore(job) || !job.summary;

// ── Applicants / dates ──────────────────────────────────────────────────────

/** "Be among the first 25 applicants" -> "first 25", "Over 200 applicants" -> "200+ applicants". */
export function formatApplicants(raw: string | null | undefined): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const first = text.match(
    /be among the first\s+([\d,]+)\s+applicants?|sei unter den ersten\s+([\d,]+)|geh[öo]ren sie zu den ersten\s+([\d,]+)/i,
  );
  if (first) return `first ${first[1] || first[2] || first[3]}`;
  if (/be an early applicant/i.test(text)) return "early applicant";
  const over = text.match(/(?:over|über)\s+([\d,]+)\+?\s+(?:applicants?|bewerber(?:innen)?)/i);
  if (over) return `${over[1]}+ applicants`;
  const n = text.match(/([\d,]+)\+?\s+(?:applicants?|bewerber(?:innen)?)/i);
  if (n) return `${n[1]} applicants`;
  if (/applicant|bewerber/i.test(text) && text.length <= 48) return text;
  return "";
}

/** Row label: your position at apply time if saved, else the scraped count. */
export function applicantsRow(job: Pick<Job, "applicant_position" | "applicants">) {
  const pos = job.applicant_position;
  const scraped = formatApplicants(job.applicants);
  return {
    label: pos ? `#${pos} at apply` : scraped,
    title: pos ? `You were roughly applicant #${pos} when you applied`
      : scraped ? "Applicant count when the job was scraped" : "",
  };
}

/** "Posted 3d ago" from the employer's publish date, or null. */
export function postedAgo(postedAt: string | null, today = new Date()): { label: string; date: string } | null {
  const raw = String(postedAt ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number) as [number, number, number];
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const days = Math.round((start.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000);
  const rel = days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days}d ago`
    : days < 365 ? `${Math.floor(days / 30)}mo ago` : `${Math.floor(days / 365)}y ago`;
  return { label: `Posted ${rel}`, date: raw };
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Date group heading: "Today · 2026-11-19", "Yesterday · …", or the date. */
export function groupHeading(day: string, now = new Date()): string {
  if (!day || day === "Unknown Date") return "Unknown Date";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === localDay(now)) return `Today · ${day}`;
  if (day === localDay(yesterday)) return `Yesterday · ${day}`;
  return day;
}

/** Jobs grouped by the day they were matched, in list order. */
export function groupByDay(jobs: Job[]): [string, Job[]][] {
  const groups = new Map<string, Job[]>();
  for (const job of jobs) {
    const day = (job.matched_at ?? "").split(" ")[0] || "Unknown Date";
    groups.set(day, [...(groups.get(day) ?? []), job]);
  }
  return [...groups.entries()];
}

/** "From / to" dates for the Matched time preset (local calendar days). */
export function presetRange(preset: string, customFrom: string, customTo: string, now = new Date()) {
  if (preset === "all") return { from: "", to: "" };
  if (preset === "custom") return { from: customFrom, to: customTo };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (preset === "today") return { from: localDay(today), to: localDay(today) };
  const from = new Date(today);
  from.setDate(today.getDate() - (Number(preset) - 1));
  return { from: localDay(from), to: localDay(today) };
}

// ── Channel / via ───────────────────────────────────────────────────────────

export interface Channel {
  cls: string;
  label: string;
  title: string;
}

/** Where the card came from: agent, API source, Log Job, or the scraper. */
export function jobChannel(job: Pick<Job, "recommended_by" | "source" | "origin">): Channel | null {
  const rec = RECOMMENDED_BY_LABEL[(job.recommended_by || "").toLowerCase()];
  if (rec) return { cls: "ch-ai", label: rec, title: `Recommended by ${rec}` };
  const src = (job.source || "").toLowerCase();
  const api = SOURCE_BADGE[src];
  if (api) return { cls: `ch-api ch-${src}`, label: api.label.replace(/ API$/, ""), title: api.title };
  if (job.origin === "manual" || (src === "manual" && !job.origin)) {
    return { cls: "ch-manual", label: ORIGIN_PILL.manual!.label, title: ORIGIN_PILL.manual!.title };
  }
  if (job.origin === "pipeline" || BOARD_LABEL[src]) {
    return { cls: "ch-scraper", label: ORIGIN_PILL.pipeline!.label, title: ORIGIN_PILL.pipeline!.title };
  }
  return src ? { cls: "ch-other", label: src, title: "" } : null;
}

/** "via LinkedIn", "via Arbeitnow", or the job site's domain for agent / manual links. */
export function viaText(job: Pick<Job, "recommended_by" | "source" | "origin" | "link">): string {
  const src = (job.source || "").toLowerCase();
  if (BOARD_LABEL[src]) return BOARD_LABEL[src]!;
  const api = SOURCE_BADGE[src];
  if (api) return api.label.replace(/ API$/, "");
  const ch = jobChannel(job);
  if (ch && (ch.cls === "ch-ai" || ch.cls === "ch-manual")) return hostOf(job.link);
  return "";
}

// ── Highlights ──────────────────────────────────────────────────────────────

/** Trimmed, max 40 chars, case-insensitively unique, at most 8 (same rules as the API). */
export function normalizeHighlights(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const tag = String(item ?? "").trim().slice(0, 40);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

// ── Company history ─────────────────────────────────────────────────────────

export function historyStatus(item: Pick<HistoryItem, "progress" | "status">): { label: string; cls: string } {
  switch (item.progress) {
    case "rejected": return { label: "Rejected", cls: "st-rejected" };
    case "screening": return { label: "Screening", cls: "st-screening" };
    case "interview": return { label: "Interview", cls: "st-interview" };
    case "interview_cancelled": return { label: "Interview cancelled", cls: "st-cancelled" };
    case "offer": return { label: "Offer", cls: "st-offer" };
    case "applied":
      return item.status === "closed_no_reply"
        ? { label: "Applied · closed, no reply", cls: "st-applied" }
        : { label: "Applied · no reply yet", cls: "st-applied" };
    default:
      return { label: STATUS_LABEL[item.status] || "Not applied", cls: "" };
  }
}

/** "2 Rejected · 1 Applied (no reply)" */
export function historySummary(history: HistoryItem[]): string {
  const counts = new Map<string, number>();
  for (const item of history) {
    const { label } = historyStatus(item);
    const key = label.startsWith("Applied") ? "Applied (no reply)" : label;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(" · ");
}

export function historyFlags(history: HistoryItem[]) {
  return {
    applied: history.some((h) => !!h.progress),
    rejected: history.some((h) => h.progress === "rejected" || h.status === "prev_rejected"),
  };
}

export const companyPageUrl = (name: string) => `/?company=${encodeURIComponent(name.trim())}`;

// ── Fit tags ────────────────────────────────────────────────────────────────

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  b2b_saas: "B2B SaaS",
  b2c_ecommerce_marketplace: "E-commerce / marketplace",
  consumer_app: "Consumer app",
  fintech: "Fintech",
  other_software_product: "Software product",
  agency_consulting_outsourcing: "Agency / consulting",
  staffing_recruiter: "Staffing / recruiter",
  hardware_industrial_automotive: "Hardware / industrial",
  public_sector_research: "Public sector / research",
};
const MARKETS_LABEL: Record<string, string> = {
  global: "Global customers",
  europe: "European customers",
  dach: "DACH customers",
  germany_only: "Germany-only customers",
};

export interface FitTag {
  text: string;
  title?: string;
  warn?: boolean;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map((v) => String(v ?? "").trim())
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}

/** Business tags from the AI company lookup. */
export function businessTags(profile: CompanyProfile | null | undefined): FitTag[] {
  const p = profile ?? {};
  const tags: FitTag[] = [];
  const vertical = (p.vertical ?? "").trim();
  if (vertical && vertical.toLowerCase() !== "unclear") tags.push({ text: vertical, title: p.business });
  if (p.product_type && PRODUCT_TYPE_LABEL[p.product_type]) tags.push({ text: PRODUCT_TYPE_LABEL[p.product_type]! });
  if (p.markets && MARKETS_LABEL[p.markets]) tags.push({ text: MARKETS_LABEL[p.markets]!, title: p.markets_detail });
  if (p.is_recruiter_for_other_company) tags.push({ text: "Via recruiter", warn: true });
  return tags;
}

/** Stack the CV covers / lacks, plus business tags; null when there is nothing to show. */
export function fitTags(job: Pick<Job, "job_labels" | "company_profile">) {
  const labels = (job.job_labels && typeof job.job_labels === "object" ? job.job_labels : {}) as Record<string, unknown>;
  const hasStackLists = Array.isArray(labels.stack_matched) || Array.isArray(labels.stack_missing);
  const matched = cleanList(labels.stack_matched);
  const missing = cleanList(labels.stack_missing);
  const business = businessTags(job.company_profile);
  const scored = Object.keys(labels).length > 0;
  const showStack = matched.length > 0 || missing.length > 0;
  const rerunHint = !showStack && scored && !hasStackLists;
  if (!showStack && !rerunHint && !business.length) return null;
  return { matched, missing, business, rerunHint };
}

/** One term of the matcher's score ("role frontend +7.0" → Frontend role, +7). */
export interface ScorePart {
  label: string;
  /** null for a term without a number (hard fail, classification failed) */
  delta: number | null;
  /** the role's base score, shown neutral rather than as a plus */
  base: boolean;
  raw: string;
}

const SCORE_TERM_LABELS: Record<string, string> = {
  "role frontend": "Frontend role",
  "role fullstack_frontend_leaning": "Fullstack, frontend-leaning",
  "role fullstack_balanced": "Fullstack, balanced",
  "role fullstack_backend_leaning": "Fullstack, backend-leaning",
  "role backend": "Backend role",
  "role not_web_dev": "Not web dev",
  "backend implied_non_js": "Non-JS backend listed",
  location: "Preferred location",
  b2b_saas: "B2B SaaS",
  b2c_ecommerce_marketplace: "B2C e-commerce",
  consumer_app: "Consumer app",
  fintech: "Fintech",
  other_software_product: "Other software",
  agency_consulting_outsourcing: "Agency / consulting",
  staffing_recruiter: "Staffing / recruiter",
  hardware_industrial_automotive: "Hardware / industrial",
  public_sector_research: "Public sector / research",
  other: "Other business",
  "recruiter posting": "Recruiter posting",
  "markets germany_only": "Germany-only market",
};

function scoreTermLabel(term: string): string {
  const known = SCORE_TERM_LABELS[term];
  if (known) return known;
  const field = term.match(/^(stack_fit|seniority|markets) (.+)$/);
  if (field) {
    const name = { stack_fit: "Stack fit", seniority: "Seniority", markets: "Markets" }[field[1]!]!;
    return `${name}: ${field[2]!.replace(/_/g, " ")}`;
  }
  const text = term.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The "Score: …" line of match_reasons, split into its terms. Empty when there is none. */
export function scoreParts(reasons: string[] | null | undefined): ScorePart[] {
  const line = (reasons ?? []).find((r) => typeof r === "string" && r.startsWith("Score: "));
  if (!line) return [];
  return line.slice("Score: ".length).split(", ").map((raw) => raw.trim()).filter(Boolean).map((raw) => {
    const m = raw.match(/^(.*) ([+-]\d+(?:\.\d+)?)$/);
    if (!m) return { label: scoreTermLabel(raw), delta: null, base: false, raw };
    return { label: scoreTermLabel(m[1]!), delta: Number(m[2]), base: m[1]!.startsWith("role "), raw };
  });
}

/** match_reasons without the score line (shown as ScoreParts instead). */
export function reasonsWithoutScore(reasons: string[] | null | undefined): string[] {
  return (reasons ?? []).filter((r) => !(typeof r === "string" && r.startsWith("Score: ")));
}

/** +7.0 / −2.5 with a real minus sign. */
export function formatScoreDelta(delta: number): string {
  return `${delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(1)}`;
}
