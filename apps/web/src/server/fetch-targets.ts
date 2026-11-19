/**
 * GET /api/fetch-details/ids: Tracker cards that can Fetch details / Run AI,
 * for the current list filters, newest first (collect_fetch_detail_targets
 * in src/web/chrome_tasks.py). Used by "Select missing details / missing
 * AI result" to select across pages.
 */
import { jobMissingDetails, normalizeRecommendedBy } from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";
import { filtersFromParams, loadLightCards, matchesFilters, sortNewestFirst } from "./tracker-jobs";

export const FETCH_DETAILS_BATCH_MAX = 80;
const truthy = (v: string | null) => ["1", "true", "yes"].includes((v ?? "").trim().toLowerCase());

export async function fetchDetailTargets(prisma: PrismaClient, params: URLSearchParams) {
  const missingOnly = truthy(params.get("missing"));
  const missingAi = truthy(params.get("missing_ai"));
  const filters = filtersFromParams(params);
  const ids = sortNewestFirst((await loadLightCards(prisma)).filter((c) => matchesFilters(c, filters))).map((c) => c._id);

  const rows = await prisma.application.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, recommendedBy: true,
      job: {
        select: {
          title: true, analysisState: true, detailsFetchedAt: true,
          currentAnalysis: { select: { matchScore: true, summary: true } },
        },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const jobs: { id: string; title: string; details_missing: boolean }[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const summary = r.job.currentAnalysis?.summary ?? "";
    const aiPending = r.job.analysisState === "pending";
    // The card as the list serializes it (no description: same rule as the card's badge)
    const detailsMissing = jobMissingDetails({
      title: r.job.title, details_fetched_at: r.job.detailsFetchedAt, ai_pending: aiPending, summary,
    });
    const missingAiResult = aiPending || r.job.currentAnalysis?.matchScore == null || !summary;
    const wanted = missingAi ? missingAiResult : missingOnly ? detailsMissing
      : detailsMissing || normalizeRecommendedBy(r.recommendedBy) !== "";
    if (!wanted) continue;
    jobs.push({ id, title: r.job.title, details_missing: detailsMissing });
    if (jobs.length >= FETCH_DETAILS_BATCH_MAX) break;
  }
  return { ids: jobs.map((j) => j.id), jobs, total: jobs.length, missing_only: missingOnly, limit: FETCH_DETAILS_BATCH_MAX };
}
