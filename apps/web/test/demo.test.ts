import { afterEach, describe, expect, it } from "vitest";
import {
  dbNameFromUrl,
  demoDatabaseConfigured,
  isDemoBlockedApiPath,
  isDemoModeSafe,
} from "@/lib/demo";
import { startManualLog } from "@/server/manual-log";
import type { PrismaClient } from "@tracker/db/client";

describe("isDemoBlockedApiPath", () => {
  it("blocks agent, fetch-details, and run-ai", () => {
    expect(isDemoBlockedApiPath("/api/agent/jobs")).toBe(true);
    expect(isDemoBlockedApiPath("/api/fetch-details/ids")).toBe(true);
    expect(isDemoBlockedApiPath("/api/jobs/abcdef0123456789abcdef01/run-ai")).toBe(true);
    expect(isDemoBlockedApiPath("/api/jobs/abcdef0123456789abcdef01/run-ai/status")).toBe(true);
    expect(isDemoBlockedApiPath("/api/jobs/abcdef0123456789abcdef01/fetch-details")).toBe(true);
  });

  it("allows soft tracker writes, reads, and Log Job", () => {
    expect(isDemoBlockedApiPath("/api/jobs")).toBe(false);
    expect(isDemoBlockedApiPath("/api/jobs/abcdef0123456789abcdef01/status")).toBe(false);
    expect(isDemoBlockedApiPath("/api/jobs/abcdef0123456789abcdef01/notes")).toBe(false);
    expect(isDemoBlockedApiPath("/api/jobs/batch-delete")).toBe(false);
    expect(isDemoBlockedApiPath("/api/stats")).toBe(false);
    expect(isDemoBlockedApiPath("/api/unmatched-jobs")).toBe(false);
    expect(isDemoBlockedApiPath("/api/manual-apply")).toBe(false);
    expect(isDemoBlockedApiPath("/api/manual-apply/lookup")).toBe(false);
  });
});

describe("demoDatabaseConfigured / isDemoModeSafe", () => {
  const prev = {
    TRACKER_DEMO: process.env.TRACKER_DEMO,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("reads the database name from the URL path", () => {
    expect(dbNameFromUrl("postgresql://u:p@h/tracker_demo?sslmode=require")).toBe("tracker_demo");
  });

  it("requires every set URL to end in _demo", () => {
    process.env.DATABASE_URL = "postgresql://u:p@h/tracker_demo";
    delete process.env.DIRECT_DATABASE_URL;
    expect(demoDatabaseConfigured()).toBe(true);

    process.env.DIRECT_DATABASE_URL = "postgresql://u:p@h/tracker_dev";
    expect(demoDatabaseConfigured()).toBe(false);

    process.env.DIRECT_DATABASE_URL = "postgresql://u:p@h/tracker_demo";
    expect(demoDatabaseConfigured()).toBe(true);
  });

  it("opens demo mode only when the flag and *_demo URLs are set", () => {
    process.env.TRACKER_DEMO = "1";
    process.env.DATABASE_URL = "postgresql://u:p@h/tracker_dev";
    delete process.env.DIRECT_DATABASE_URL;
    expect(isDemoModeSafe()).toBe(false);

    process.env.DATABASE_URL = "postgresql://u:p@h/tracker_demo";
    expect(isDemoModeSafe()).toBe(true);

    delete process.env.TRACKER_DEMO;
    expect(isDemoModeSafe()).toBe(false);
  });

  it("refuses scrape Log Job in demo mode before touching the DB", async () => {
    process.env.TRACKER_DEMO = "1";
    const result = await startManualLog({} as PrismaClient, {
      urls: ["https://www.linkedin.com/jobs/view/1234567890/"],
      mode: "scrape",
    });
    expect(result.status).toBe(503);
    expect(String(result.body.error)).toMatch(/Save Link Only/i);
  });
});
