/**
 * Keep only stack tags the posting really names. The model sometimes copies
 * the CV's frameworks when a posting only says "JavaScript"; the Tracker
 * must never show a technology the JD lacks. Port of evaluator.py.
 */
import { PY_WS, pyStrip } from "./py.js";

// Spellings a posting may use for the same technology (all lowercase)
const STACK_ALIASES: Record<string, string[]> = {
  postgresql: ["postgres"],
  postgres: ["postgresql"],
  kubernetes: ["k8s"],
  golang: ["go"],
  javascript: ["js"],
  "amazon web services": ["aws"],
  aws: ["amazon web services"],
  "google cloud": ["gcp"],
  gcp: ["google cloud"],
  "ci/cd": ["ci / cd", "cicd", "continuous integration"],
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SEPARATORS = new RegExp(`[${PY_WS}.\\-]+`);
const OPTIONAL_SEPARATOR = `[${PY_WS}.\\-]?`;

/** Spellings to look for: the term, its /-parts, without .js, plus aliases. */
function stackVariants(term: string): Set<string> {
  const base = pyStrip(term.toLowerCase().replace(/\(.*?\)/g, " "));
  const parts = base ? new Set([base, ...base.split("/").map(pyStrip).filter(Boolean)]) : new Set<string>();
  const out = new Set<string>();
  for (const part of parts) {
    out.add(part);
    const stem = pyStrip(part.replace(/\.?js$/, ""));
    if (stem && stem !== part) out.add(stem);
    for (const alias of STACK_ALIASES[part] ?? []) out.add(alias);
  }
  out.delete("");
  return out;
}

/**
 * True when the posting names this technology. Boundaries keep "Java" out of
 * "JavaScript" and "Go" out of "good"; a .js suffix and spaces / dots /
 * dashes inside the name are optional.
 */
export function stackTermInText(term: string, text: string): boolean {
  const haystack = (text || "").toLowerCase();
  for (const variant of stackVariants(term)) {
    const body = variant.split(SEPARATORS).filter(Boolean).map(escapeRegex).join(OPTIONAL_SEPARATOR);
    if (!body) continue;
    if (new RegExp(`(?<![a-z0-9+#])${body}(?:\\.?js)?(?![a-z0-9+#])`).test(haystack)) return true;
  }
  return false;
}

/** Drop stack_matched / stack_missing entries the posting does not name (in place). */
export function groundStackLabels(labels: Record<string, unknown>, text: string, log?: (line: string) => void): void {
  for (const key of ["stack_matched", "stack_missing"]) {
    const items = labels[key];
    if (!Array.isArray(items)) continue;
    const kept = items.filter((t): t is string => typeof t === "string" && stackTermInText(t, text));
    const dropped = items.filter((t) => !kept.includes(t as string));
    if (dropped.length) log?.(`Dropped ${key} not in the posting: ${dropped.map(String).join(", ")}`);
    labels[key] = kept;
  }
}
