/**
 * Is a scraped job description complete enough to match on? Port of
 * src/core/jd_quality.py: pure text checks, no AI, no language model.
 */
import { pyRegex } from "@tracker/core";
import { pyIndex, pyLen, pySplit, pySplitLines, pyStrip } from "./py.js";
import { stripHtml } from "./text.js";

export const MIN_JOB_DESCRIPTION_CHARS = 40;
export const MIN_COMPLETE_JOB_DESCRIPTION_CHARS = 280;

const CHROME_LINE = new RegExp(
  "^(?:about the job|see more|show more|see less|show less|mehr anzeigen|weniger anzeigen|"
  + "similar jobs|people also viewed|easy apply|apply(?: now)?|promoted|be an early applicant|"
  + "ähnliche jobs|jetzt bewerben|bewerben)\\.?$",
  "iu",
);
const SIDEBAR_HEADING = pyRegex("\\b(?:similar jobs|people also viewed|mehr ähnliche jobs|ähnliche jobs)\\b", true);
const IDENTITY_STOPWORDS = new Set([
  "the", "and", "und", "der", "die", "das", "von", "für", "gmbh", "ag", "inc", "ltd", "llc", "se", "ug", "co",
  "group", "holding", "senior", "junior", "staff", "principal", "engineer", "software", "developer", "manager",
  "lead", "remote", "hybrid", "onsite", "full", "stack", "frontend", "backend", "fullstack", "job", "jobs",
]);

export type QualityKind = "ok" | "empty" | "incomplete";
export interface Assessment { ok: boolean; kind: QualityKind; reason: string }

const identityTokens = (value: string) =>
  (value.match(/[A-Za-zÄÖÜäöüß]{3,}/g) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => !IDENTITY_STOPWORDS.has(t) && pyLen(t) >= 4);

function chromeStripped(plain: string): string {
  const kept: string[] = [];
  for (const line of pySplitLines(plain)) {
    const compact = pySplit(pyStrip(line)).join(" ");
    if (!compact || CHROME_LINE.test(compact)) continue;
    kept.push(compact);
  }
  return pyStrip(kept.join("\n"));
}

export function assessJobDescription(text: string, title = "", company = ""): Assessment {
  const plain = pyStrip(stripHtml(text ?? ""));
  const length = pyLen(plain);
  if (length < MIN_JOB_DESCRIPTION_CHARS) {
    return { ok: false, kind: "empty", reason: "Missing or too-short job description" };
  }
  const body = chromeStripped(plain);
  if (pyLen(body) < MIN_JOB_DESCRIPTION_CHARS) {
    return { ok: false, kind: "incomplete", reason: "Description looks like page chrome, not a job posting" };
  }
  const sidebar = SIDEBAR_HEADING.exec(plain);
  if (sidebar && pyIndex(plain, sidebar.index) < MIN_COMPLETE_JOB_DESCRIPTION_CHARS) {
    return { ok: false, kind: "incomplete", reason: "Description looks like a similar-jobs sidebar, not the posting" };
  }
  if (length < MIN_COMPLETE_JOB_DESCRIPTION_CHARS) {
    return { ok: false, kind: "incomplete", reason: `Description too short (${length} chars) to match on` };
  }
  const lowered = body.toLowerCase();
  const companyTokens = identityTokens(company);
  const titleTokens = identityTokens(title);
  const companyHit = companyTokens.some((t) => lowered.includes(t));
  const titleHit = titleTokens.some((t) => lowered.includes(t));
  // Only an identity mismatch when neither appears and the text is short or a sidebar:
  // long JDs often name a product instead of the parent company
  if ((companyTokens.length || titleTokens.length) && !companyHit && !titleHit && (length < 600 || sidebar)) {
    return { ok: false, kind: "incomplete", reason: "Description does not match the job title/company" };
  }
  return { ok: true, kind: "ok", reason: "" };
}
