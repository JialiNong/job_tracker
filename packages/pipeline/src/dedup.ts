/**
 * Same role on several boards (port of src/core/dedup.py). job_id dedup
 * only works inside one source; this compares a normalised company + title.
 */
import type { PrismaClient } from "@tracker/db/client";

const GENDER_TAG = /[([]?\s*(?:[mwfdx]\s*\/\s*[mwfdx](?:\s*\/\s*[mwfdx]{1,3})?|all\s+genders?|gn\*?|mensch\*?|m\s*\|\s*w\s*\|\s*d|[mwfd]\s*\*)\s*[)\]]?/giu;
const NON_WORD = /[^a-z0-9äöüß+#]+/gu;
const LEGAL_SUFFIXES = new Set([
  "gmbh", "ag", "se", "kg", "co", "kgaa", "mbh", "ug", "ohg", "gbr", "ev",
  "inc", "llc", "ltd", "limited", "plc", "bv", "b", "v", "sa", "sas", "srl",
  "corp", "corporation", "company", "group", "holding", "technologies",
  "technology", "tech", "gmbh&co", "haftungsbeschränkt",
]);

const words = (text: string) => text.replace(NON_WORD, " ").split(" ").filter(Boolean);

export function normalizeTitle(title: string | null | undefined): string {
  let text = String(title ?? "").toLowerCase().replace(GENDER_TAG, " ");
  text = text.replaceAll("full stack", "fullstack").replaceAll("full-stack", "fullstack");
  text = text.replaceAll("front end", "frontend").replaceAll("front-end", "frontend");
  return words(text).join(" ");
}

export function normalizeCompany(company: string | null | undefined): string {
  const text = String(company ?? "").toLowerCase().replace(/\(.*?\)/gu, " ");
  return words(text).filter((w) => !LEGAL_SUFFIXES.has(w)).join(" ");
}

export const dedupKey = (title: string, company: string) => `${normalizeCompany(company)}|${normalizeTitle(title)}`;

/**
 * A recent row with the same normalised company + title from another source:
 * Tracker cards first, then other postings (300 newest each, like Python).
 */
export async function findCrossSourceDuplicate(
  prisma: PrismaClient, title: string, company: string, source: string,
): Promise<{ collection: string; source: string; title: string } | null> {
  const core = normalizeCompany(company);
  const want = normalizeTitle(title);
  if (!core || !want) return null;
  const first = core.split(" ")[0]!;
  if (first.length < 2) return null;
  const where = { company: { startsWith: first, mode: "insensitive" as const }, source: { not: source } };
  const select = { title: true, company: true, source: true };
  const onTracker = await prisma.job.findMany({
    where: { ...where, application: { isNot: null } }, select,
    orderBy: { application: { addedAt: "desc" } }, take: 300,
  });
  const scraped = await prisma.job.findMany({
    where: { ...where, application: null }, select, orderBy: { scrapedAt: "desc" }, take: 300,
  });
  for (const [collection, rows] of [["matched_jobs", onTracker], ["jobs", scraped]] as const) {
    for (const row of rows) {
      if (normalizeCompany(row.company) === core && normalizeTitle(row.title) === want) {
        return { collection, source: row.source, title: row.title };
      }
    }
  }
  return null;
}
