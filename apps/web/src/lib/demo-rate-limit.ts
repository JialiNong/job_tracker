/**
 * Best-effort write rate limit for the public demo (Edge-safe, in-memory).
 *
 * Per client IP + normalized route: default 10 mutating calls / rolling hour.
 * On Vercel each isolate has its own map, so this brakes casual abuse; the
 * nightly reseed is still the recovery for a wiped board.
 */

export const DEMO_WRITE_LIMIT_PER_HOUR_DEFAULT = 10;
export const DEMO_WRITE_WINDOW_MS = 60 * 60 * 1000;

type Bucket = { count: number; resetAt: number };

/** Module map survives warm isolates; cold starts begin empty. */
const buckets = new Map<string, Bucket>();

export function demoWriteLimitPerHour(): number {
  const raw = Number.parseInt(process.env.DEMO_WRITE_LIMIT_PER_HOUR ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEMO_WRITE_LIMIT_PER_HOUR_DEFAULT;
}

/** Collapse record ids so /api/jobs/<id>/status shares one budget. */
export function normalizeDemoWriteRoute(method: string, pathname: string): string {
  const path = pathname
    .replace(/\/[a-f0-9]{24}(?=\/|$)/gi, "/*")
    .replace(/\/\d{6,}(?=\/|$)/g, "/*");
  return `${method.toUpperCase()}:${path}`;
}

export function clientIpFromHeaders(headers: Headers): string {
  // Prefer platform-set headers (harder to spoof) before client-controlled XFF.
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 128);
  const vercel = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  return "unknown";
}

/** POST lookup is a read used while typing on Log Job — do not burn the write budget. */
export function isDemoWriteRateLimitedPath(pathname: string): boolean {
  if (pathname === "/api/manual-apply/lookup") return false;
  if (pathname === "/api/manual-apply/status") return false;
  return pathname.startsWith("/api/");
}

export type DemoRateLimitResult =
  | { ok: true; remaining: number; limit: number; resetAt: number }
  | { ok: false; remaining: 0; limit: number; resetAt: number; retryAfterSec: number };

/**
 * Record one write attempt. Pure except for the module Map (injectable for tests).
 */
export function checkDemoWriteRateLimit(
  ip: string,
  method: string,
  pathname: string,
  opts: { limit?: number; now?: number; store?: Map<string, Bucket> } = {},
): DemoRateLimitResult {
  const limit = opts.limit ?? demoWriteLimitPerHour();
  const now = opts.now ?? Date.now();
  const store = opts.store ?? buckets;
  const route = normalizeDemoWriteRoute(method, pathname);
  const key = `${ip}\u0000${route}`;

  let bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + DEMO_WRITE_WINDOW_MS };
    store.set(key, bucket);
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      limit,
      resetAt: bucket.resetAt,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.count),
    limit,
    resetAt: bucket.resetAt,
  };
}

export const DEMO_RATE_LIMIT_MESSAGE =
  "Demo write limit reached for this action. Try again later — the board also resets every night.";
