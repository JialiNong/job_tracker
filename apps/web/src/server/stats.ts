/**
 * GET /api/stats: sidebar chip counts and the Overview pipeline rail.
 * Replaces api_stats() in src/web/routes/stats.py.
 *
 * Chip counts reuse the list rules (@tracker/core chipStatusCounts) on the
 * same light rows the list loads. The plain counts are SQL.
 */
import { GOT_INTERVIEW_FILTER, chipStatusCounts } from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";
import { loadLightCards } from "./tracker-jobs";

export const matchThreshold = () => Number.parseFloat(process.env.MATCH_THRESHOLD ?? "7.0") || 7.0;

/**
 * Applications for the funnel / Journey / Locations: one per card that has an
 * application record (applied date, an applied-like status, or any timeline
 * step), plus one per Reapplied step. Same as Flask's count_applied_applications.
 */
async function countApplications(prisma: PrismaClient): Promise<number> {
  const [row] = await prisma.$queryRaw<{ cards: bigint; reapplied: bigint }[]>`
    WITH applied AS (
      SELECT a.id
        FROM applications a
       WHERE a.applied_at IS NOT NULL
          OR a.status IN ('applied', 'screening', 'rejected', 'interview', 'interview_cancelled', 'offer')
          OR EXISTS (SELECT 1 FROM application_events e WHERE e.application_id = a.id)
    )
    SELECT (SELECT count(*) FROM applied) AS cards,
           (SELECT count(*) FROM application_events e
              JOIN applied ON applied.id = e.application_id
             WHERE e.step = 'reapplied') AS reapplied`;
  return Number(row?.cards ?? 0) + Number(row?.reapplied ?? 0);
}

/** Jobs whose latest AI run scored below the threshold (the Unmatched page). */
async function countUnmatched(prisma: PrismaClient, threshold: number): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n
      FROM jobs j
      JOIN job_analyses a ON a.id = j.current_analysis_id
     WHERE a.match_score < ${threshold}`;
  return Number(row?.n ?? 0);
}

export async function trackerStats(prisma: PrismaClient) {
  const threshold = matchThreshold();
  const [cards, applied, unmatched, timeouts, totals] = await Promise.all([
    loadLightCards(prisma),
    countApplications(prisma),
    countUnmatched(prisma, threshold),
    prisma.scrapeTimeout.count({ where: { reviewStatus: "open" } }),
    prisma.scraperTotals.findUnique({ where: { id: 1 } }),
  ]);
  const byStatus = chipStatusCounts(cards);
  return {
    total: cards.length,
    by_status: byStatus,
    unmatched,
    timeouts,
    funnel: {
      title_clicked: totals?.titlePassedClicked ?? 0,
      german_filtered: totals?.germanFiltered ?? 0,
      ai_matched: cards.length,
      ai_unmatched: unmatched,
      applied,
      interviewed: byStatus[GOT_INTERVIEW_FILTER] ?? 0,
      offer: byStatus.offer ?? 0,
    },
  };
}
