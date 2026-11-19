/**
 * Bundesagentur für Arbeit Jobsuche API (free, public client key).
 * Search has no description; the full JD comes from the detail route,
 * fetched only for listings that pass the free filters. veroeffentlichtseit
 * only honours 0 / 1 / 7 / 14 / 28, so the window is rounded up and also
 * checked locally. pav=false drops recruiting agencies, zeitarbeit=false
 * temp staffing.
 */
import { berlinWallToInstant } from "@tracker/core";
import { DEFAULT_KEYWORDS, config } from "../config.js";
import { getJson } from "../http.js";
import type { Log, SourceJob } from "./types.js";

const C = config.ARBEITSAGENTUR_CONFIG;
const HEADERS = { "X-API-Key": C.api_key };

/** Smallest supported veroeffentlichtseit value that covers `days`. */
export function publishedSinceParam(days: number): number {
  return C.published_since_choices.find((c) => c >= days) ?? C.published_since_choices.at(-1)!;
}

/** API dates are Berlin wall-clock ("2026-11-18" or "2026-11-18T09:30:00"). */
function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const text = value.includes("T") ? value.slice(0, 19).replace("T", " ") : `${value.slice(0, 10)} 00:00`;
  return berlinWallToInstant(text);
}

const inGermany = (item: Record<string, any>) => {
  const lands: string[] = (item.stellenlokationen ?? []).map((l: any) => String(l?.adresse?.land ?? ""));
  return !lands.length || lands.some((l) => ["DEUTSCHLAND", ""].includes(l.toUpperCase()));
};

const placeOf = (item: Record<string, any>) =>
  (item.stellenlokationen ?? []).map((l: any) => l?.adresse?.ort).find((o: unknown) => o) ?? "";

export async function fetchDescription(refnr: string): Promise<string> {
  const b64 = Buffer.from(refnr).toString("base64");
  const data = await getJson(C.detail_url.replace("{b64}", b64), { headers: HEADERS });
  return data.stellenangebotsBeschreibung ?? "";
}

export function toSourceJob(item: Record<string, any>): SourceJob {
  const refnr = String(item.referenznummer ?? "");
  const remote = Boolean(item.homeofficemoeglich);
  let location = String(placeOf(item));
  if (remote) location = location ? `${location} (home office possible)` : "Remote";
  return {
    source: C.source,
    jobId: refnr,
    title: String(item.stellenangebotsTitel ?? "").trim(),
    company: String(item.firma ?? "").trim(),
    location,
    link: C.job_url.replace("{refnr}", refnr),
    postedAt: parseDate(item.datumErsteVeroeffentlichung),
    remote,
    extra: item.externeURL ? { externalUrl: item.externeURL } : {},
    fetchDescription: () => fetchDescription(refnr),
    locationPolicy: "none", // filtered on adresse.land in fetch
  };
}

function isFresh(item: Record<string, any>, cutoff: Date): boolean {
  const dates = [parseDate(item.datumErsteVeroeffentlichung), parseDate(item.aenderungsdatum)].filter((d): d is Date => !!d);
  return !dates.length || Math.max(...dates.map((d) => d.getTime())) >= cutoff.getTime();
}

export async function fetchArbeitsagentur(
  days = 1, log: Log = console.log, keywords = DEFAULT_KEYWORDS, maxPages = C.max_pages_per_keyword,
): Promise<SourceJob[]> {
  const size = C.page_size;
  const since = publishedSinceParam(days);
  // Start of the Berlin day `days` ago (API dates are day-granular)
  const day = new Date(Date.now() - days * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const cutoff = berlinWallToInstant(`${day} 00:00`)!;
  const out: SourceJob[] = [];
  for (const keyword of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      const data = await getJson(C.search_url, {
        params: { was: keyword, angebotsart: 1, veroeffentlichtseit: since, pav: "false", zeitarbeit: "false", size, page },
        headers: HEADERS,
      });
      const items: Record<string, any>[] = data.ergebnisliste ?? [];
      const fresh = items.filter((i) => isFresh(i, cutoff) && inGermany(i));
      out.push(...fresh.map(toSourceJob));
      const total = data.maxErgebnisse ?? 0;
      log(`Arbeitsagentur '${keyword}' page ${page}: ${items.length}/${total}, ${fresh.length} within ${days}d`);
      if (page * size >= total || items.length < size) break;
    }
  }
  return out;
}
