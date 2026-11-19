/**
 * Overview tab data: daily activity heatmap, applied locations, flow charts,
 * Application Journey. Replaces /api/stats/daily, /api/stats/locations,
 * /api/stats/flow and /api/journey of the Flask app.
 *
 * Calendar days are Berlin days: timestamps are bucketed with
 * AT TIME ZONE 'Europe/Berlin' (docs/pg-schema.md, D10).
 */
import {
  buildJourney, buildSankey, buildWeeklyByPlatform, formatBerlinDate, isApplication, isGermanyOrRemote,
  normalizeAppliedLocation, now as clockNow, reappliedCount, type JourneyJob,
} from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";
import { matchThreshold } from "./stats";

// ── Application cards for the charts ────────────────────────────────────────

const CARD_SELECT = {
  id: true, status: true, appliedAt: true, updatedAt: true, addedAt: true,
  events: { select: { step: true, at: true }, orderBy: [{ at: "asc" as const }, { id: "asc" as const }] },
  job: { select: { title: true, company: true, location: true, source: true } },
};

export interface ChartCard extends JourneyJob {
  location: string;
  source: string;
}

/**
 * Every card that counts as an application (applied date, applied-like
 * status, or a timeline), oldest first like Mongo's natural order, so the
 * Sankey's link order matches the old charts.
 */
export async function loadApplicationCards(prisma: PrismaClient): Promise<ChartCard[]> {
  const rows = await prisma.application.findMany({ select: CARD_SELECT, orderBy: { id: "asc" } });
  return rows
    .map((r) => ({
      _id: r.id,
      status: r.status,
      applied_at: r.appliedAt,
      updated_at: r.updatedAt,
      matched_at: r.addedAt,
      application_timeline: r.events.map((e) => ({ step: e.step, at: e.at })),
      title: r.job.title,
      company: r.job.company,
      location: r.job.location,
      source: r.job.source,
    }))
    .filter(isApplication);
}

// ── Heatmap ─────────────────────────────────────────────────────────────────

interface DayRow { day: string; n: bigint }

/**
 * Per-day counts for the last `days` Berlin days (including today):
 * detail pages opened and non-English JDs skipped (scraper counters, or jobs
 * scraped that day when the counter is missing), AI matches, applications
 * (first apply + Reapplied steps), and agent pushes that stayed Unmatched.
 */
export async function dailyActivity(prisma: PrismaClient, days: number) {
  const span = Math.max(1, Math.min(days, 366));
  const today = formatBerlinDate(clockNow());
  const startDay = new Date(`${today}T00:00:00Z`);
  startDay.setUTCDate(startDay.getUTCDate() - (span - 1));
  const start = startDay.toISOString().slice(0, 10);
  const threshold = matchThreshold();

  // [start, today] as Berlin days; `d` is a timestamptz column
  const byDay = (rows: DayRow[]) => new Map(rows.map((r) => [r.day, Number(r.n)]));
  const [daily, scraped, matched, applied, reapplied, agent] = await Promise.all([
    prisma.$queryRaw<{ day: string; clicked: number; german: number }[]>`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, title_passed_clicked AS clicked, german_filtered AS german
        FROM scraper_daily_stats WHERE day BETWEEN ${start}::date AND ${today}::date`,
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(scraped_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day, count(*) AS n
        FROM jobs WHERE (scraped_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN ${start}::date AND ${today}::date
       GROUP BY 1`,
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(added_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day, count(*) AS n
        FROM applications WHERE (added_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN ${start}::date AND ${today}::date
       GROUP BY 1`,
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(applied_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day, count(*) AS n
        FROM applications WHERE (applied_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN ${start}::date AND ${today}::date
       GROUP BY 1`,
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day, count(*) AS n
        FROM application_events
       WHERE step = 'reapplied' AND (at AT TIME ZONE 'Europe/Berlin')::date BETWEEN ${start}::date AND ${today}::date
       GROUP BY 1`,
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(j.agent_recommended_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day, count(*) AS n
        FROM jobs j JOIN job_analyses a ON a.id = j.current_analysis_id
       WHERE a.match_score < ${threshold}
         AND (j.agent_recommended_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN ${start}::date AND ${today}::date
       GROUP BY 1`,
  ]);
  const counters = new Map(daily.map((r) => [r.day, r]));
  const [scrapedBy, matchedBy, appliedBy, reappliedBy, agentBy] = [scraped, matched, applied, reapplied, agent].map(byDay);

  const out = [];
  for (const cursor = new Date(startDay); cursor.toISOString().slice(0, 10) <= today; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const counter = counters.get(date);
    out.push({
      date,
      // Days before the scraper kept daily counters: jobs scraped that day ≈ pages opened
      title_clicked: counter ? Number(counter.clicked) : scrapedBy.get(date) ?? 0,
      german_filtered: counter ? Number(counter.german) : 0,
      ai_matched: matchedBy.get(date) ?? 0,
      applied: (appliedBy.get(date) ?? 0) + (reappliedBy.get(date) ?? 0),
      agent_unmatched: agentBy.get(date) ?? 0,
    });
  }
  return out;
}

// ── Locations, flow, journey ────────────────────────────────────────────────

/** Applications by normalized place (Germany + Remote only); `total` counts every application. */
export function appliedLocations(cards: ChartCard[]) {
  const counts = new Map<string, number>(); // insertion order breaks ties, like Counter.most_common
  let total = 0;
  for (const card of cards) {
    const n = 1 + reappliedCount(card);
    total += n;
    const name = normalizeAppliedLocation(card.location);
    if (isGermanyOrRemote(card.location, name)) counts.set(name, (counts.get(name) ?? 0) + n);
  }
  const locations = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { total, locations };
}

export function flowCharts(cards: ChartCard[]) {
  return { sankey: buildSankey(cards), weekly: buildWeeklyByPlatform(cards) };
}

export const journey = (cards: ChartCard[]) => buildJourney(cards);
