/**
 * Replace every table's contents with `rows`, in one transaction.
 *
 * Full reload, not an incremental sync: the data is small (a few thousand
 * rows) and Mongo stays the source of truth until the cutover, so the
 * simplest correct sync is "make Postgres equal to Mongo again". If any
 * insert fails, the transaction rolls back and the old contents stay.
 */
import type { PrismaClient } from "@prisma/client";
import type { Rows } from "./transform.js";

const CHUNK = 500;

const TABLES = [
  "application_events", "applications", "job_analyses", "jobs", "company_profiles",
  "scrape_timeouts", "scraper_daily_stats", "scraper_totals", "stats_cache",
];

async function inChunks<T>(items: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += CHUNK) await insert(items.slice(i, i + CHUNK));
}

export async function replaceAll(prisma: PrismaClient, rows: Rows): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);

    await inChunks(rows.companyProfiles, (data) => tx.companyProfile.createMany({ data }));
    await inChunks(rows.jobs, (data) => tx.job.createMany({ data }));
    await inChunks(rows.jobAnalyses, (data) => tx.jobAnalysis.createMany({ data }));
    if (rows.currentAnalysis.length) {
      // jobs <-> job_analyses reference each other: link them once both exist.
      await tx.$executeRawUnsafe(
        `UPDATE jobs AS j SET current_analysis_id = v.analysis_id
           FROM jsonb_to_recordset($1::jsonb) AS v(job_id text, analysis_id bigint)
          WHERE j.id = v.job_id`,
        JSON.stringify(rows.currentAnalysis.map((c) => ({ job_id: c.jobId, analysis_id: c.analysisId.toString() }))),
      );
    }
    await inChunks(rows.applications, (data) => tx.application.createMany({ data }));
    await inChunks(rows.applicationEvents, (data) => tx.applicationEvent.createMany({ data }));
    await inChunks(rows.scrapeTimeouts, (data) => tx.scrapeTimeout.createMany({ data }));
    await inChunks(rows.scraperDailyStats, (data) => tx.scraperDailyStat.createMany({ data }));
    await inChunks(rows.scraperTotals, (data) => tx.scraperTotals.createMany({ data }));
    await inChunks(rows.statsCache, (data) => tx.statsCache.createMany({ data }));

    // Explicit ids were inserted: move the identity sequences past them.
    await tx.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('job_analyses', 'id'), COALESCE((SELECT max(id) FROM job_analyses), 0) + 1, false)`,
    );
  }, { timeout: 120_000, maxWait: 10_000 });
}
