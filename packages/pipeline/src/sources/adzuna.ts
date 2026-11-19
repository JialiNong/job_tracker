/**
 * Adzuna job search API: opt-in, needs ADZUNA_APP_ID / ADZUNA_APP_KEY (paid
 * beyond 25 trial calls). Its description is a ~500-char teaser: the Python
 * version followed redirect_url and extracted the page text with
 * trafilatura; this port keeps the teaser, so such jobs are saved as
 * incomplete and the matcher skips them without an AI call.
 */
import { DEFAULT_KEYWORDS, config } from "../config.js";
import { getJson } from "../http.js";
import type { Log, SourceJob } from "./types.js";

const C = config.ADZUNA_CONFIG;

export function adzunaCredentials(env: NodeJS.ProcessEnv = process.env): [string, string] | null {
  const id = (env.ADZUNA_APP_ID ?? "").trim();
  const key = (env.ADZUNA_APP_KEY ?? "").trim();
  return id && key ? [id, key] : null;
}

export function toSourceJob(item: Record<string, any>): SourceJob {
  const created = item.created ? new Date(item.created) : null;
  return {
    source: C.source,
    jobId: String(item.id ?? ""),
    title: String(item.title ?? "").trim(),
    company: String(item.company?.display_name ?? "").trim(),
    location: String(item.location?.display_name ?? "").trim(),
    link: item.redirect_url ?? "",
    description: item.description ?? "",
    postedAt: created && !Number.isNaN(created.getTime()) ? created : null,
    locationPolicy: "none", // /jobs/de/ endpoint: Germany only
  };
}

export async function fetchAdzuna(
  days = 1, log: Log = console.log, keywords = DEFAULT_KEYWORDS, maxPages = C.max_pages_per_keyword,
): Promise<SourceJob[]> {
  const creds = adzunaCredentials();
  if (!creds) {
    log("Adzuna: ADZUNA_APP_ID / ADZUNA_APP_KEY not set — skipped (paid key: developer.adzuna.com)");
    return [];
  }
  const [appId, appKey] = creds;
  const perPage = C.results_per_page;
  const out: SourceJob[] = [];
  for (const keyword of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      const data = await getJson(C.search_url.replace("{page}", String(page)), {
        params: { app_id: appId, app_key: appKey, what_phrase: keyword, max_days_old: days, results_per_page: perPage, sort_by: "date" },
      });
      const items: Record<string, any>[] = data.results ?? [];
      out.push(...items.map(toSourceJob));
      const total = data.count ?? 0;
      log(`Adzuna '${keyword}' page ${page}: ${items.length}/${total}`);
      if (page * perPage >= total || items.length < perPage) break;
    }
  }
  return out;
}
