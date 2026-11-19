/**
 * Labels -> score -> the stored analysis. Port of score_job, _gate and
 * to_analysis in src/matching/evaluator.py: the model classifies, code scores.
 */
import { pyRound1, pySigned1, pyStr, pyStrip } from "./py.js";
import { MATCH_WEIGHTS, isBlockedMatchCompany } from "./weights.js";

export type Labels = Record<string, unknown>;
export type Company = Record<string, unknown>;
export interface ScoreResult { score: number | null; parts: string[] }
export interface EvaluateResult extends ScoreResult { labels: Labels | null; company: Company | null }

const PREFERRED_CITIES = /(?<![\p{L}\p{N}_])(leipzig|halle|berlin)(?![\p{L}\p{N}_])/iu;
const REMOTE = /(?<![\p{L}\p{N}_])remote(?![\p{L}\p{N}_])/iu;

/** Python truthiness for the label values (empty dict / list / string are false). */
export const truthy = (v: unknown) =>
  !(v === null || v === undefined || v === false || v === 0 || v === ""
    || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length));

/** labels.get("description_usable", True): only a missing key defaults to usable (an explicit null does not). */
export const descriptionUsable = (labels: Labels) =>
  !Object.hasOwn(labels, "description_usable") || truthy(labels.description_usable);

const weight = (table: Record<string, number>, key: unknown) =>
  typeof key === "string" && Object.hasOwn(table, key) ? table[key]! : 0;

export function scoreJob(
  job: { company?: string | null; location?: string | null },
  labels: Labels | null | undefined,
  company?: Company | null,
): ScoreResult {
  const w = MATCH_WEIGHTS;
  if (!labels || !truthy(labels)) return { score: null, parts: ["classification failed"] };
  if (isBlockedMatchCompany(job.company)) return { score: w.hard_fail_score, parts: ["hard fail: blocked company"] };
  if (!descriptionUsable(labels)) return { score: 0, parts: ["description unusable"] };
  const backendAsk = labels.backend_language_ask;
  if (truthy(labels.german_required)) return { score: w.hard_fail_score, parts: ["hard fail: german_required"] };
  if (backendAsk === "required_non_js") return { score: w.hard_fail_score, parts: ["hard fail: non_js_backend_required"] };
  const kind = labels.hard_fail_kind;
  // The backend-language effect is decided by backend_language_ask above, so a
  // model-side non_js_backend_required hard fail with a softer ask is ignored
  if (truthy(labels.hard_fail) && kind !== "non_js_backend_required") {
    return { score: w.hard_fail_score, parts: [`hard fail: ${pyStr(kind)}`] };
  }

  const parts: string[] = [];
  let score = weight(w.role_type, labels.role_type);
  parts.push(`role ${pyStr(labels.role_type)} ${pySigned1(score)}`);
  for (const field of ["stack_fit", "seniority"] as const) {
    const delta = weight(w[field], labels[field]);
    if (delta) {
      score += delta;
      parts.push(`${field} ${pyStr(labels[field])} ${pySigned1(delta)}`);
    }
  }
  const backendDelta = weight(w.backend_language_ask, backendAsk);
  if (backendDelta) {
    score += backendDelta;
    parts.push(`backend ${pyStr(backendAsk)} ${pySigned1(backendDelta)}`);
  }
  if (truthy(labels.ai_product_work)) {
    score += w.ai_product_work;
    parts.push(`AI product ${pySigned1(w.ai_product_work)}`);
  }
  const location = job.location || "";
  if (PREFERRED_CITIES.test(location) || REMOTE.test(location)) {
    score += w.preferred_location;
    parts.push(`location ${pySigned1(w.preferred_location)}`);
  }
  if (company && truthy(company)) {
    const productDelta = weight(w.product_type, company.product_type);
    if (productDelta) {
      score += productDelta;
      parts.push(`${pyStr(company.product_type)} ${pySigned1(productDelta)}`);
    }
    if (truthy(company.is_recruiter_for_other_company)) {
      score += w.recruiter_posting;
      parts.push(`recruiter posting ${pySigned1(w.recruiter_posting)}`);
    }
    const marketDelta = weight(w.markets, company.markets);
    if (marketDelta) {
      score += marketDelta;
      parts.push(`markets ${pyStr(company.markets)} ${pySigned1(marketDelta)}`);
    }
  }
  return { score: Math.max(0, Math.min(10, pyRound1(score))), parts };
}

// match_gate values (Unmatched page filter + pills)
const GATE_BY_HARD_FAIL: Record<string, string> = {
  german_required: "german",
  non_js_backend_required: "stack",
  "blocked company": "blocked_company",
};

export function gateOf(parts: string[]): string {
  for (const part of parts) {
    if (part === "empty description") return "empty_desc";
    if (part === "description unusable") return "incomplete_desc";
    if (part === "non-english description") return "non_english";
    if (part.startsWith("hard fail: ")) {
      const kind = part.slice("hard fail: ".length);
      return GATE_BY_HARD_FAIL[kind] ?? kind;
    }
  }
  return "scored";
}

/** The label / profile fields that are stored (keys starting with "_" are run metadata). */
export const cleanMeta = (meta: Record<string, unknown> | null | undefined) =>
  Object.fromEntries(Object.entries(meta ?? {}).filter(([k]) => !k.startsWith("_")));

/** str.strip(": ") */
const stripColonSpace = (s: string) => s.replace(/^[: ]+|[: ]+$/g, "");

export interface Analysis {
  match_score: number;
  recommendation: string;
  special_match: boolean;
  special_match_reasons: string[];
  disqualification_reason: string;
  match_reasons: string[];
  missing_requirements: string[];
  red_flags: string[];
  nice_to_have_matches: string[];
  summary: string;
  what_youll_do: { matched: string[]; unmatched: string[] };
  what_theyre_looking_for: { matched: string[]; unmatched: string[] };
  match_gate: string;
  needs_refetch: boolean;
  job_labels: Record<string, unknown>;
  company_profile: Record<string, unknown>;
}

const GATE_SUMMARY: Record<string, string> = {
  empty_desc: "No usable job description scraped; not sent to AI.",
  incomplete_desc: "Job description is incomplete or looks like page chrome; not sent to AI.",
  non_english: "Job description is not English; not sent to AI.",
};

/** An evaluate() result as the analysis the Tracker / Unmatched pages store (null if it failed). */
export function toAnalysis(result: Partial<EvaluateResult>, threshold = 7.0): Analysis | null {
  const score = result.score;
  if (score === null || score === undefined) return null;
  const labels = (result.labels ?? {}) as Labels;
  const company = (result.company ?? {}) as Company;
  const parts = result.parts ?? [];
  const gate = gateOf(parts);

  const reasons: string[] = [];
  if (truthy(company.business)) reasons.push(`Business: ${pyStr(company.business)}`);
  if (truthy(company.markets)) {
    const detail = truthy(company.markets_detail) ? pyStr(company.markets_detail) : "";
    reasons.push(`Customers/markets: ${pyStr(company.markets)}${detail ? ` — ${detail}` : ""}`);
  }
  if (truthy(labels.stack)) reasons.push(`Stack: ${pyStr(labels.stack)}`);
  reasons.push(`Score: ${parts.join(", ")}`);

  const watch = pyStrip(truthy(labels.watch_outs) ? String(labels.watch_outs) : "");
  const redFlags = watch && watch.toLowerCase() !== "none" ? [watch] : [];
  let disqualification = "";
  if (gate === "german") {
    disqualification = pyStrip(`Mandatory German: ${truthy(labels.german_evidence) ? pyStr(labels.german_evidence) : ""}`);
  } else if (gate === "non_english") {
    disqualification = "Job description is not English";
  } else if (gate !== "scored") {
    const evidence = truthy(labels.hard_fail_evidence) ? pyStr(labels.hard_fail_evidence) : "";
    disqualification = evidence ? stripColonSpace(`${gate}: ${evidence}`) : gate;
  }
  const recommendation = score >= threshold ? "Yes" : score >= threshold - 1 ? "Maybe" : "No";

  return {
    match_score: score,
    recommendation,
    special_match: false,
    special_match_reasons: [],
    disqualification_reason: disqualification,
    match_reasons: reasons,
    missing_requirements: [],
    red_flags: redFlags,
    nice_to_have_matches: [],
    summary: truthy(labels.summary) ? pyStr(labels.summary) : GATE_SUMMARY[gate] ?? "",
    what_youll_do: { matched: [], unmatched: [] },
    what_theyre_looking_for: { matched: [], unmatched: [] },
    match_gate: gate,
    needs_refetch: gate === "empty_desc" || gate === "incomplete_desc",
    job_labels: cleanMeta(labels),
    company_profile: cleanMeta(company),
  };
}
