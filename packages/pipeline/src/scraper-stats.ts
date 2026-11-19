/**
 * Funnel counters for the Overview (scraper_totals + scraper_daily_stats by
 * Berlin day), as increment_scraper_stat in src/core/mongo/jobs.py.
 */
import { now as clockNow } from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";

export type ScraperStat = "titlePassedClicked" | "germanFiltered" | "aiTitleFiltered" | "detailTimeout";

export async function incrementScraperStat(prisma: PrismaClient, key: ScraperStat, amount = 1): Promise<void> {
  const now = clockNow();
  const day = new Date(`${now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" })}T00:00:00Z`);
  await prisma.scraperTotals.upsert({
    where: { id: 1 }, create: { id: 1, [key]: amount, updatedAt: now }, update: { [key]: { increment: amount }, updatedAt: now },
  });
  await prisma.scraperDailyStat.upsert({
    where: { day }, create: { day, [key]: amount, updatedAt: now }, update: { [key]: { increment: amount }, updatedAt: now },
  });
}
