/**
 * Timeouts page: title-qualified cards whose job description timed out
 * during scraping. Replaces src/web/routes/timeouts.py.
 */
import { formatBerlin, normalizeLink, now as clockNow } from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";
import { newRecordId } from "./ids";

const PAGE_SIZE = 50;

export async function listTimeouts(prisma: PrismaClient, params: URLSearchParams) {
  const requested = Math.max(1, Number.parseInt(params.get("page") ?? "", 10) || 1);
  const source = params.get("source") || "all";
  const reviewStatus = params.get("review_status") || "open";
  const where = {
    ...(reviewStatus !== "all" ? { reviewStatus } : {}),
    ...(source !== "all" ? { source } : {}),
  };
  const total = await prisma.scrapeTimeout.count({ where });
  const pages = total ? Math.ceil(total / PAGE_SIZE) : 1;
  const page = Math.min(requested, pages);
  const rows = await prisma.scrapeTimeout.findMany({
    where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
  });
  return {
    jobs: rows.map((t) => ({
      _id: t.id, job_id: t.externalId, source: t.source, title: t.title, company: t.company, location: t.location,
      keyword: t.keyword ?? "", reason: t.reason, review_status: t.reviewStatus, timeout_count: t.timeoutCount,
      link: normalizeLink({ link: t.link, source: t.source, job_id: t.externalId }),
      created_at: formatBerlin(t.createdAt), updated_at: formatBerlin(t.updatedAt),
      ...(t.addedToTrackerAt ? { added_to_matched_at: formatBerlin(t.addedToTrackerAt) } : {}),
    })),
    total, page, pages,
  };
}

/**
 * "Add as Not Applied": put the posting on the Tracker (creating the posting
 * row if the scraper never stored it) and mark the timeout added. Until it
 * is scraped the card shows the "added after scrape timeout" placeholder.
 */
export async function addTimeoutToTracker(prisma: PrismaClient, id: string) {
  const now = clockNow();
  return prisma.$transaction(async (tx) => {
    const t = await tx.scrapeTimeout.findUnique({ where: { id } });
    if (!t) return { status: 404, body: { error: "Timeout job not found" } };
    const existing = await tx.job.findUnique({
      where: { source_externalId: { source: t.source, externalId: t.externalId } },
      select: { id: true, application: { select: { id: true } } },
    });
    if (!existing?.application) {
      const jobId = existing?.id ?? newRecordId();
      if (!existing) {
        await tx.job.create({
          data: {
            id: jobId, source: t.source, externalId: t.externalId, title: t.title, company: t.company,
            location: t.location, link: normalizeLink({ link: t.link, source: t.source, job_id: t.externalId }),
            keyword: t.keyword, descriptionEmpty: true, scrapedAt: now, updatedAt: now,
          },
        });
      }
      await tx.application.create({
        data: { id: newRecordId(), jobId, status: "pending", origin: "pipeline", addedAt: now, updatedAt: now },
      });
    }
    await tx.scrapeTimeout.update({ where: { id }, data: { reviewStatus: "added", addedToTrackerAt: now, updatedAt: now } });
    return { status: 200, body: { ok: true, already: !!existing?.application } };
  });
}

export async function dismissTimeout(prisma: PrismaClient, id: string) {
  const updated = await prisma.scrapeTimeout.updateMany({ where: { id }, data: { reviewStatus: "dismissed", updatedAt: clockNow() } });
  return updated.count ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "Timeout job not found" } };
}
