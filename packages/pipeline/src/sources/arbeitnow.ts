/**
 * Arbeitnow job board API: free, no key. 300 jobs per page, newest first,
 * full HTML description included; no server-side search, so pages are read
 * until listings are older than the window. The mixed feed includes DE
 * (arbeitnow.com) plus .fr / .ch / .co.uk / .nl / … — ingest keeps only the
 * .com host (see germanyScopeOk).
 */
import { config } from "../config.js";
import { getJson } from "../http.js";
import type { Log, SourceJob } from "./types.js";

const C = config.ARBEITNOW_CONFIG;

export function toSourceJob(item: Record<string, any>): SourceJob {
  const created = item.created_at;
  const remote = Boolean(item.remote);
  let location = String(item.location ?? "").trim();
  if (remote && !location) location = "Remote";
  return {
    source: C.source,
    jobId: String(item.slug ?? ""),
    title: String(item.title ?? "").trim(),
    company: String(item.company_name ?? "").trim(),
    location,
    link: item.url ?? "",
    description: item.description ?? "",
    postedAt: created ? new Date(Number.parseInt(String(created), 10) * 1000) : null,
    remote,
    // Host gate in germanyScopeOk; location string is not used for DE scope.
    locationPolicy: "none",
    extra: { tags: item.tags ?? [], jobTypes: item.job_types ?? [] },
  };
}

export async function fetchArbeitnow(days = 1, log: Log = console.log, maxPages = C.max_pages): Promise<SourceJob[]> {
  const cutoff = Date.now() - days * 86_400_000;
  const out: SourceJob[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await getJson(C.feed_url, { params: { page } });
    const items: Record<string, any>[] = data.data ?? [];
    if (!items.length) break;
    const jobs = items.map(toSourceJob);
    const fresh = jobs.filter((j) => !j.postedAt || j.postedAt.getTime() >= cutoff);
    out.push(...fresh);
    log(`Arbeitnow page ${page}: ${items.length} listed, ${fresh.length} within ${days}d`);
    if (fresh.length < jobs.length || !data.links?.next) break;
  }
  return out;
}
