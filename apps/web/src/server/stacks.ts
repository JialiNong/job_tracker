/**
 * Stacks tab numbers, cached in stats_cache (key "stacks"). Building them
 * reads every applied job's full JD and runs ~60 regexes over each, so the
 * tab reads the stored result. Replaces src/web/stacks_cache.py.
 *
 * - no stored copy: compute now
 * - stored copy older than MAX_AGE: serve it, refresh after the response
 *   (Next.js after(), which also works on serverless)
 * - ?refresh=1 (Recompute button): compute now
 */
import { buildStackStats, isApplication, now as clockNow } from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
import { after } from "next/server";

const CACHE_KEY = "stacks";
const MAX_AGE_MS = 26 * 60 * 60 * 1000; // the nightly refresh plus slack

let running: Promise<unknown> | null = null; // one recompute per instance at a time

async function compute(prisma: PrismaClient) {
  const rows = await prisma.application.findMany({
    select: {
      status: true, appliedAt: true, updatedAt: true, addedAt: true,
      events: { select: { step: true, at: true }, orderBy: [{ at: "asc" }, { id: "asc" }] },
      job: { select: { title: true, description: true } },
    },
  });
  const jobs = rows.map((r) => ({
    status: r.status, applied_at: r.appliedAt, updated_at: r.updatedAt, matched_at: r.addedAt,
    application_timeline: r.events.map((e) => ({ step: e.step, at: e.at })),
    title: r.job.title, description: r.job.description,
  })).filter(isApplication);
  return buildStackStats(jobs);
}

export async function refreshStackStats(prisma: PrismaClient) {
  if (running) {
    await running;
    return readCached(prisma);
  }
  const work = (async () => {
    const data = await compute(prisma);
    const computedAt = clockNow();
    const json = data as unknown as Prisma.InputJsonValue;
    await prisma.statsCache.upsert({
      where: { key: CACHE_KEY },
      create: { key: CACHE_KEY, data: json, computedAt },
      update: { data: json, computedAt },
    });
    return { ...data, computed_at: computedAt.toISOString().replace(/\.\d{3}Z$/, "Z") };
  })();
  running = work;
  try {
    return await work;
  } finally {
    running = null;
  }
}

async function readCached(prisma: PrismaClient) {
  const row = await prisma.statsCache.findUnique({ where: { key: CACHE_KEY } });
  if (!row) return null;
  return { row, payload: { ...(row.data as object), computed_at: row.computedAt.toISOString().replace(/\.\d{3}Z$/, "Z") } };
}

export async function getStackStats(prisma: PrismaClient) {
  const cached = await readCached(prisma);
  if (!cached) return refreshStackStats(prisma);
  if (clockNow().getTime() - cached.row.computedAt.getTime() > MAX_AGE_MS && !running) {
    // Serve the stale copy now; replace it for the next load
    after(() => refreshStackStats(prisma).catch((err) => console.error("[stacks] background refresh failed", err)));
  }
  return cached.payload;
}
