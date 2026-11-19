/**
 * Parse and normalise job URLs (Log Job, link replacement, dedup). Port of
 * src/core/job_url.py; checked against Python answers in rule_cases.json.
 * job_id and posting_key must match Python byte for byte: they are stored
 * ids, and the pipeline dedups on them.
 */
import { createHash } from "node:crypto";
import { hostnameOf, parseQsl, unquote, urlencode, urljoin, urlparse, urlunparse } from "./pyurl.js";

const INDEED_JK_RE = /[?&]jk=([a-zA-Z0-9]+)/;
const INDEED_VJK_RE = /[?&]vjk=([a-zA-Z0-9]+)/;
const INDEED_ID_PREFIXES = ["job_", "sj_"];

export function normalizeIndeedJobId(raw: string): string {
  if (!raw) return "";
  const value = String(raw).trim();
  for (const prefix of INDEED_ID_PREFIXES) if (value.startsWith(prefix)) return value.slice(prefix.length);
  return value;
}

/** Bare jk plus legacy prefixed forms for lookups / dedup. */
export function indeedJobIdVariants(jobId: string): string[] {
  const bare = normalizeIndeedJobId(jobId);
  return bare ? [bare, `job_${bare}`, `sj_${bare}`] : [];
}

export function extractIndeedJkFromUrl(url: string): string {
  if (!url) return "";
  const text = unquote(String(url).trim());
  return INDEED_JK_RE.exec(text)?.[1] ?? INDEED_VJK_RE.exec(text)?.[1] ?? "";
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const TRAILING_JUNK_RE = /[.,;:)\]"']+$/;
const LINKEDIN_VIEW_RE = /\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?=[/?#]|$)/;
const LINKEDIN_CURRENT_RE = /[?&]currentJobId=(\d+)/;

/** Strip quotes / trailing punctuation, add https:// when the scheme is missing. */
export function normalizePastedJobUrl(url: string): string {
  let text = (url ?? "").trim();
  if (!text || text.startsWith("#")) return "";
  text = text.replace(/^[<> \t]+|[<> \t]+$/g, "");
  text = text.replace(TRAILING_JUNK_RE, "");
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  } else if (text.slice(0, 1) === '"' || text.slice(0, 1) === "'") {
    text = text.slice(1).trim().replace(TRAILING_JUNK_RE, "");
  }
  if (!text) return "";
  if (text.startsWith("//")) text = `https:${text}`;
  else if (!SCHEME_RE.test(text)) text = `https://${text}`;
  return text;
}

const SHORT_LINK_HOSTS = new Set(["to.indeed.com"]);
const SHORT_LINK_MAX_HOPS = 4;
const SHORT_LINK_TIMEOUT_MS = 8000;

export function isShortJobUrl(url: string): boolean {
  return SHORT_LINK_HOSTS.has(hostnameOf(urlparse(normalizePastedJobUrl(url)).netloc));
}

/**
 * Follow an Indeed short link until a URL with a job key appears. Redirects
 * are followed by hand and stop at the first jk=, so the Cloudflare-protected
 * job page itself is never requested. Any other URL comes back normalised.
 */
export async function expandShortJobUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const start = normalizePastedJobUrl(url);
  if (!start || !isShortJobUrl(start)) return start;
  let current = start;
  for (let hop = 0; hop < SHORT_LINK_MAX_HOPS; hop++) {
    let location: string | null = null;
    try {
      const res = await fetchImpl(current, {
        method: "GET", redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS),
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) location = res.headers.get("location");
    } catch {
      break; // network error: keep the short URL, like the Python version
    }
    if (!location) break;
    current = urljoin(current, location);
    if (extractIndeedJkFromUrl(current)) return current;
  }
  return start;
}

/** http(s) with a host: a stored link is a clickable href, never javascript: / data:. */
export function isHttpUrl(url: string): boolean {
  const p = urlparse(normalizePastedJobUrl(url));
  return (p.scheme === "http" || p.scheme === "https") && hostnameOf(p.netloc) !== "";
}

export function detectSource(url: string): string {
  const lower = normalizePastedJobUrl(url).toLowerCase();
  if (lower.includes("linkedin.com")) return "linkedin";
  if (lower.includes("indeed.com")) return "indeed";
  return "manual";
}

export function canonicalizeUrl(url: string): string {
  const p = urlparse(normalizePastedJobUrl(url));
  const path = p.path.replace(/\/+$/, "") || "/";
  return urlunparse({ scheme: p.scheme, netloc: p.netloc.toLowerCase(), path, params: "", query: p.query, fragment: "" });
}

/** sha1(canonical URL)[:16]: the job_id of non-LinkedIn/Indeed links. */
export function jobIdFromUrl(url: string): string {
  return createHash("sha1").update(canonicalizeUrl(url), "utf8").digest("hex").slice(0, 16);
}

// [provider, host regex, path regex, keep company slug]
const ATS_KEY_PATTERNS: [string, RegExp, RegExp, boolean][] = [
  ["greenhouse", /(?:^|\.)greenhouse\.io$/, /\/jobs\/(\d+)/, false],
  ["lever", /^jobs\.(?:eu\.)?lever\.co$/, /^\/[^/]+\/([0-9a-f-]{36})/, false],
  ["ashby", /^jobs\.ashbyhq\.com$/, /^\/[^/]+\/([0-9a-f-]{36})/, false],
  ["personio", /^([^.]+)\.jobs\.personio\.(?:de|com)$/, /^\/job\/(\d+)/, true],
  ["workable", /^apply\.workable\.com$/, /^\/[^/]+\/j\/([0-9A-Za-z]+)/, false],
  ["workable", /^[^.]+\.workable\.com$/, /^\/j\/([0-9A-Za-z]+)/, false],
  ["recruitee", /^([^.]+)\.recruitee\.com$/, /^\/o\/([^/]+)/, true],
  ["smartrecruiters", /^(?:jobs|careers)\.smartrecruiters\.com$/, /^\/[^/]+\/(\d+)/, false],
  ["join", /^join\.com$/, /^\/companies\/[^/]+\/(\d+)/, false],
  ["teamtailor", /^([^.]+)\.teamtailor\.com$/, /\/jobs\/(\d+)/, true],
  ["bamboohr", /^([^.]+)\.bamboohr\.com$/, /\/careers\/(\d+)/, true],
  ["workday", /^([^.]+)\.wd\d+\.myworkdayjobs\.com$/, /\/job\/.*_([A-Za-z0-9-]+)$/, true],
];
const ATS_QUERY_KEYS: Record<string, string> = { gh_jid: "greenhouse", ashby_jid: "ashby" };
const NOISE_PARAMS = new Set([
  "language", "lang", "locale", "hl", "em", "ref", "referrer", "referer",
  "source", "src", "trk", "trackingid", "gh_src", "lever-source", "lever-origin",
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mode",
  "from", "via", "channel", "medium", "campaign",
]);

/** Python's str.strip() whitespace. */
const pyStrip = (s: string) => s.replace(/^[\s\u001c-\u001f\u0085]+|[\s\u001c-\u001f\u0085]+$/g, "");

/**
 * Stable id of the job ad behind a URL, or null for LinkedIn / Indeed.
 * Known ATS boards -> "personio:bookboost:2811207"; any other site ->
 * "url:host/path?kept=params" without language / tracking params.
 */
export function postingKey(url: string): string | null {
  const text = normalizePastedJobUrl(url);
  if (!text) return null;
  const p = urlparse(text);
  let host = hostnameOf(p.netloc);
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || host.includes("linkedin.com") || host.includes("indeed.com")) return null;
  const path = p.path.replace(/\/+$/, "");
  const query = parseQsl(p.query);

  for (const [param, value] of query) {
    const provider = ATS_QUERY_KEYS[param.toLowerCase()];
    if (provider && pyStrip(value)) return `${provider}:${pyStrip(value).toLowerCase()}`;
  }
  for (const [provider, hostRe, pathRe, withSlug] of ATS_KEY_PATTERNS) {
    const hm = hostRe.exec(host);
    if (!hm) continue;
    const pm = pathRe.exec(path);
    if (!pm) continue;
    const job = pm[1]!.toLowerCase();
    if (!withSlug) return `${provider}:${job}`;
    return `${provider}:${(hm[1] ?? "").toLowerCase()}:${job}`;
  }
  const kept = query
    .filter(([k]) => !NOISE_PARAMS.has(k.toLowerCase()) && !k.toLowerCase().startsWith("utm_"))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return `url:${host}${path || "/"}` + (kept.length ? `?${urlencode(kept)}` : "");
}

export function extractLinkedinJobId(url: string): string | null {
  const text = normalizePastedJobUrl(url);
  return LINKEDIN_VIEW_RE.exec(text)?.[1] ?? LINKEDIN_CURRENT_RE.exec(text)?.[1] ?? null;
}

export function extractIndeedJobId(url: string): string | null {
  return extractIndeedJkFromUrl(normalizePastedJobUrl(url) || "") || null;
}

/** The job_id the scrapers persist for this URL. */
export function resolveJobId(url: string, source?: string): string | null {
  const u = normalizePastedJobUrl(url);
  const src = source || detectSource(u);
  if (src === "linkedin") return extractLinkedinJobId(u);
  if (src === "indeed") return extractIndeedJobId(u);
  return u ? jobIdFromUrl(u) : null;
}

/** The URL stored on the Tracker card. */
export function canonicalJobLink(url: string, source = "", jobId = ""): string {
  const src = source || detectSource(url);
  const id = jobId || resolveJobId(url, src) || "";
  if (src === "linkedin" && id) return `https://www.linkedin.com/jobs/view/${id}/`;
  if (src === "indeed" && id) return `https://de.indeed.com/viewjob?jk=${id}`;
  return url ? canonicalizeUrl(url) : "";
}

export interface ReplacementLink {
  link: string;
  source: string;
  job_id: string;
  posting_key?: string;
}

/** A pasted replacement URL -> Tracker identity fields, or an error message. */
export async function replacementLinkFields(
  rawUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<{ fields: ReplacementLink | null; error: string | null }> {
  const url = await expandShortJobUrl(normalizePastedJobUrl(rawUrl), fetchImpl);
  if (!url) return { fields: null, error: "Paste a job URL" };
  const p = urlparse(url);
  if ((p.scheme !== "http" && p.scheme !== "https") || !hostnameOf(p.netloc).trim()) {
    return { fields: null, error: "Paste a full job URL (https://…)" };
  }
  const source = detectSource(url);
  const jobId = resolveJobId(url, source);
  if (!jobId) return { fields: null, error: "Could not parse a job id from this URL" };
  const link = canonicalJobLink(url, source, jobId);
  const fields: ReplacementLink = { link, source, job_id: jobId };
  const key = postingKey(link);
  if (key) fields.posting_key = key;
  return { fields, error: null };
}
