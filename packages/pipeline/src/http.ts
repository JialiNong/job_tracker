/** Small HTTP client for the API sources: retries 429 / 5xx / network errors (src/sources/http_client.py). */
export const USER_AGENT = "job-scraper/1.0 (personal job search; API client)";
const TIMEOUT_MS = 25_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string, readonly body = "") {
    super(`HTTP ${status} for ${url}`);
  }
}

/** base + query, dropping null / undefined / "" values (urlencode with doseq). */
export function buildUrl(base: string, params?: Record<string, unknown>): string {
  if (!params) return base;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    for (const item of Array.isArray(v) ? v : [v]) q.append(k, String(item));
  }
  const qs = q.toString();
  return qs ? base + (base.includes("?") ? "&" : "?") + qs : base;
}

export interface GetOptions {
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const full = buildUrl(url, opts.params);
  const retries = opts.retries ?? 2;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(full, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json, */*", ...opts.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await res.text();
      const body = (await res.text().catch(() => "")).slice(0, 500);
      last = new HttpError(res.status, full, body);
      if (!RETRY_STATUS.has(res.status)) throw last;
    } catch (err) {
      if (err instanceof HttpError && !RETRY_STATUS.has(err.status)) throw err;
      last = err;
    }
    if (attempt < retries) await sleep(2000 * (attempt + 1));
  }
  throw last;
}

export const getJson = async <T = any>(url: string, opts: GetOptions = {}): Promise<T> => JSON.parse(await getText(url, opts));
