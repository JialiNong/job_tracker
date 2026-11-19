/**
 * Company ATS boards: official public job feeds, no key needed, one company
 * each, from the watchlist config/ats_companies.json (src/sources/ats.py).
 * Every run lists all open roles of every watched company; already-saved
 * ones are skipped by job id, so only new openings reach the funnel.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { berlinWallToInstant } from "@tracker/core";
import { decodeHTML } from "entities";
import { XMLParser } from "fast-xml-parser";
import { config } from "../config.js";
import { getJson, getText } from "../http.js";
import type { Log, SourceJob } from "./types.js";

const C = config.ATS_CONFIG;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface AtsEntry { company?: string; provider: string; slug: string; host?: string; enabled?: boolean }

/**
 * Epoch ms (Lever), ISO with Z / an offset, "… UTC" (Recruitee), or a date
 * without a zone, read as Berlin wall time.
 */
export function parseAtsDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return new Date(value);
  let text = String(value).trim();
  if (text.endsWith(" UTC")) text = `${text.slice(0, -4).replace(" ", "T")}Z`;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return berlinWallToInstant(text.replace(/\.\d+$/, ""));
}

/** Non-empty parts, case-insensitively deduplicated, joined with " · ". */
export function joinParts(...parts: unknown[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const s = String(p ?? "").trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out.join(" · ");
}

const job = (entry: AtsEntry, provider: string, rawId: unknown, fields: Omit<SourceJob, "source" | "jobId" | "company">): SourceJob => ({
  source: C.source,
  jobId: `${provider}:${entry.slug}:${rawId}`,
  company: entry.company || entry.slug,
  extra: { atsProvider: provider, atsSlug: entry.slug },
  locationPolicy: "strict", // global boards: keep only DE / unscoped remote
  ...fields,
});

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

async function greenhouse(entry: AtsEntry): Promise<SourceJob[]> {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs`, { params: { content: "true" } });
  return (data.jobs ?? []).map((j: any) => job(entry, "greenhouse", j.id, {
    title: j.title ?? "", location: j.location?.name ?? "", link: j.absolute_url ?? "",
    description: decodeHTML(j.content ?? ""), postedAt: parseAtsDate(j.first_published || j.updated_at),
  }));
}

async function lever(entry: AtsEntry, host: string, provider: string): Promise<SourceJob[]> {
  const data = await getJson(`https://${host}/v0/postings/${entry.slug}`, { params: { mode: "json" } });
  return (Array.isArray(data) ? data : []).map((j: any) => {
    const cats = j.categories ?? {};
    const locs = cats.allLocations ?? [cats.location];
    const remote = String(j.workplaceType ?? "").toLowerCase() === "remote";
    const lists = (j.lists ?? []).map((li: any) => `${li.text ?? ""}\n${li.content ?? ""}`).join("\n");
    const body = [j.descriptionPlain || j.description, lists, j.additionalPlain || j.additional].filter(Boolean).join("\n\n");
    return job(entry, provider, j.id, {
      title: j.text ?? "", location: joinParts(...locs, remote ? "Remote" : "", j.country), link: j.hostedUrl ?? "",
      description: body, postedAt: parseAtsDate(j.createdAt), remote,
    });
  });
}

async function ashby(entry: AtsEntry): Promise<SourceJob[]> {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${entry.slug}`);
  return (data.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => {
    const country = j.address?.postalAddress?.addressCountry ?? "";
    const secondary = (j.secondaryLocations ?? []).map((s: any) => s.location);
    const remote = Boolean(j.isRemote) || String(j.workplaceType ?? "").toLowerCase() === "remote";
    return job(entry, "ashby", j.id, {
      title: j.title ?? "", location: joinParts(j.location, ...secondary, country, remote ? "Remote" : ""),
      link: j.jobUrl ?? "", description: j.descriptionHtml || j.descriptionPlain || "", postedAt: parseAtsDate(j.publishedAt), remote,
    });
  });
}

const asList = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? String((v as any)["#text"] ?? "") : String(v));

async function personio(entry: AtsEntry): Promise<SourceJob[]> {
  const host = entry.host || "jobs.personio.de";
  const base = `https://${entry.slug}.${host}`;
  const xml = await getText(`${base}/xml`, { params: { language: "en" }, headers: { Accept: "application/xml" } });
  const doc = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: false }).parse(xml);
  // root.findall("position"): the <position> children of the document element, whatever it is called
  const root = Object.entries(doc ?? {}).find(([k, v]) => !k.startsWith("?") && v && typeof v === "object")?.[1] as any;
  const positions = asList<any>(root?.position);
  return positions.map((pos: any) => {
    const pid = text(pos.id).trim();
    const offices = [text(pos.office), ...asList(pos.additionalOffices?.office).map(text)];
    const sections = asList(pos.jobDescriptions?.jobDescription).map((d: any) => {
      const name = text(d.name).trim();
      const value = text(d.value);
      return name ? `<h3>${escapeHtml(name)}</h3>${value}` : value;
    });
    return job(entry, "personio", pid, {
      title: text(pos.name).trim(), location: joinParts(...offices), link: `${base}/job/${pid}?language=en`,
      description: sections.join("\n"), postedAt: parseAtsDate(text(pos.createdAt)),
    });
  });
}

async function recruitee(entry: AtsEntry): Promise<SourceJob[]> {
  const data = await getJson(`https://${entry.slug}.recruitee.com/api/offers/`);
  return (data.offers ?? []).filter((j: any) => !j.status || j.status === "published").map((j: any) => {
    const remote = Boolean(j.remote);
    return job(entry, "recruitee", j.id, {
      title: j.title ?? "", location: joinParts(j.location, j.city, j.country, remote ? "Remote" : ""),
      link: j.careers_url || j.url || "", description: `${j.description ?? ""}\n${j.requirements ?? ""}`,
      postedAt: parseAtsDate(j.published_at || j.created_at), remote,
    });
  });
}

async function workable(entry: AtsEntry): Promise<SourceJob[]> {
  const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${entry.slug}`, { params: { details: "true" } });
  return (data.jobs ?? []).map((j: any) => {
    const remote = Boolean(j.telecommuting);
    const locs = (j.locations ?? []).map((l: any) => joinParts(l.city, l.country));
    return job(entry, "workable", j.shortcode || j.id, {
      title: j.title ?? "", location: joinParts(...(locs.length ? locs : [joinParts(j.city, j.country)]), remote ? "Remote" : ""),
      link: j.url || j.shortlink || "", description: j.description ?? "", postedAt: parseAtsDate(j.published_on || j.created_at), remote,
    });
  });
}

export const PROVIDERS: Record<string, (entry: AtsEntry) => Promise<SourceJob[]>> = {
  greenhouse,
  lever: (e) => lever(e, "api.lever.co", "lever"),
  lever_eu: (e) => lever(e, "api.eu.lever.co", "lever_eu"),
  ashby,
  personio,
  recruitee,
  workable,
};

export const watchlistPath = () => (isAbsolute(C.watchlist_path) ? C.watchlist_path : join(ROOT, C.watchlist_path));

export async function loadWatchlist(path = watchlistPath()): Promise<AtsEntry[]> {
  if (!existsSync(path)) return [];
  const data = JSON.parse(await readFile(path, "utf8"));
  const entries: AtsEntry[] = Array.isArray(data) ? data : data.companies ?? [];
  return entries.filter((e) => e.slug && e.provider in PROVIDERS && e.enabled !== false);
}

/** All open roles of every watched company, C.max_workers boards at a time (`days` is not used: boards list open roles). */
export async function fetchAts(_days = 1, log: Log = console.log, watchlist?: AtsEntry[]): Promise<SourceJob[]> {
  const entries = watchlist ?? (await loadWatchlist());
  if (!entries.length) {
    log(`ATS: watchlist empty (${watchlistPath()}) — skipped`);
    return [];
  }
  const results: SourceJob[][] = new Array(entries.length);
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const entry = entries[i]!;
      try {
        results[i] = await PROVIDERS[entry.provider]!(entry);
      } catch (err) {
        failed += 1;
        results[i] = [];
        log(`ATS ${entry.company} (${entry.provider}:${entry.slug}): failed — ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(C.max_workers, entries.length) }, worker));
  const out = results.flat().filter((j) => j.title && j.link);
  log(`ATS: ${entries.length} companies, ${out.length} open roles, ${failed} board(s) failed`);
  return out;
}
