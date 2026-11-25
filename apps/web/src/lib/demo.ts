/**
 * Public interactive demo mode (TRACKER_DEMO=1).
 *
 * Separate Vercel project + Neon *_demo database. Soft writes are allowed
 * (status, notes, Log Job link-only); a nightly Action reseeds the DB.
 * Agent ingest and scrape/AI paths that need secrets or a Mac are blocked.
 *
 * TRACKER_DEMO alone is not enough: DATABASE_URL (and DIRECT_DATABASE_URL
 * when set) must end in `_demo`, or the app refuses to start the open mode.
 */

export function dbNameFromUrl(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, "").split("?")[0] ?? "";
  } catch {
    return "";
  }
}

/** True when every provided URL names a `*_demo` database. */
export function demoDatabaseConfigured(): boolean {
  const urls = [process.env.DATABASE_URL, process.env.DIRECT_DATABASE_URL]
    .map((u) => (u ?? "").trim())
    .filter(Boolean);
  if (!urls.length) return false;
  return urls.every((u) => {
    const name = dbNameFromUrl(u);
    return name.length > 0 && name.endsWith("_demo");
  });
}

export function isDemoMode(): boolean {
  return process.env.TRACKER_DEMO === "1";
}

/** Login-free demo only when the flag is on and the DB name is safe. */
export function isDemoModeSafe(): boolean {
  return isDemoMode() && demoDatabaseConfigured();
}

/** API prefixes refused in demo mode (middleware). */
export const DEMO_BLOCKED_API_PREFIXES = [
  "/api/agent",
  "/api/fetch-details",
] as const;

/** Path patterns for per-job scrape / AI routes. Log Job (link-only) stays open. */
export function isDemoBlockedApiPath(pathname: string): boolean {
  if (DEMO_BLOCKED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  if (/^\/api\/jobs\/[^/]+\/(run-ai|fetch-details)(\/|$)/.test(pathname)) return true;
  return false;
}

export const DEMO_BLOCKED_MESSAGE =
  "Not available in the public demo. Soft edits (status, notes, Log Job link-only) work; this database resets daily.";

export const DEMO_MISCONFIGURED_MESSAGE =
  "TRACKER_DEMO=1 requires DATABASE_URL (and DIRECT_DATABASE_URL when set) to end with _demo";
