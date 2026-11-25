import { describe, expect, it } from "vitest";
import {
  DEMO_WRITE_WINDOW_MS,
  checkDemoWriteRateLimit,
  clientIpFromHeaders,
  isDemoWriteRateLimitedPath,
  normalizeDemoWriteRoute,
} from "@/lib/demo-rate-limit";

describe("normalizeDemoWriteRoute", () => {
  it("collapses 24-hex ids so status edits share one budget", () => {
    expect(normalizeDemoWriteRoute("POST", "/api/jobs/abcdef0123456789abcdef01/status")).toBe(
      "POST:/api/jobs/*/status",
    );
    expect(normalizeDemoWriteRoute("patch", "/api/jobs/abcdef0123456789abcdef01/notes")).toBe(
      "PATCH:/api/jobs/*/notes",
    );
  });
});

describe("checkDemoWriteRateLimit", () => {
  it("allows up to the limit then returns 429-shaped failure", () => {
    const store = new Map();
    const now = 1_000_000;
    const ip = "203.0.113.10";
    for (let i = 0; i < 10; i++) {
      const r = checkDemoWriteRateLimit(ip, "POST", "/api/jobs/abcdef0123456789abcdef01/status", {
        limit: 10, now, store,
      });
      expect(r.ok).toBe(true);
    }
    const blocked = checkDemoWriteRateLimit(ip, "POST", "/api/jobs/aaaaaaaaaaaaaaaaaaaaaaaa/status", {
      limit: 10, now, store,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);

    // A different route still has its own budget
    const other = checkDemoWriteRateLimit(ip, "POST", "/api/manual-apply", { limit: 10, now, store });
    expect(other.ok).toBe(true);

    // Window expiry resets the bucket
    const after = checkDemoWriteRateLimit(ip, "POST", "/api/jobs/bbbbbbbbbbbbbbbbbbbbbbbb/status", {
      limit: 10, now: now + DEMO_WRITE_WINDOW_MS, store,
    });
    expect(after.ok).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers x-real-ip over x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "203.0.113.9",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.9");
  });
});

describe("isDemoWriteRateLimitedPath", () => {
  it("excludes Log Job lookup/status reads", () => {
    expect(isDemoWriteRateLimitedPath("/api/manual-apply/lookup")).toBe(false);
    expect(isDemoWriteRateLimitedPath("/api/manual-apply/status")).toBe(false);
    expect(isDemoWriteRateLimitedPath("/api/manual-apply")).toBe(true);
    expect(isDemoWriteRateLimitedPath("/api/jobs/batch-delete")).toBe(true);
  });
});
