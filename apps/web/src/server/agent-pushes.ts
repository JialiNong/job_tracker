/**
 * Today's agent pushes (Berlin calendar day) for the Tracker banner: how many
 * jobs each agent sent, saved, skipped and failed, every failed URL with its
 * reason, and saved cards that still need their link fixed. Rows from earlier
 * days are ignored, so the banner clears itself at midnight.
 */
import { berlinDayBounds, formatBerlin, formatBerlinDate, now as clockNow } from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";
import type { NeedsLinkJob, PushFailure } from "./agent";

export interface AgentPushSummary {
  agent: string;
  runs: number;
  received: number;
  saved: number;
  skipped: number;
  failed: number;
  last_at: string;
}

export interface AgentPushesToday {
  day: string;
  agents: AgentPushSummary[];
  failures: (PushFailure & { agent: string; at: string })[];
  needs_link: (NeedsLinkJob & { agent: string })[];
}

const SHORT_LINK_HOST = "to.indeed.com";

export async function agentPushesToday(prisma: PrismaClient): Promise<AgentPushesToday> {
  const day = formatBerlinDate(clockNow());
  const bounds = berlinDayBounds(day)!;
  const runs = await prisma.agentPushRun.findMany({
    where: { at: { gte: bounds.start, lte: bounds.end } },
    orderBy: { at: "asc" },
  });

  const agents = new Map<string, AgentPushSummary>();
  const failures: AgentPushesToday["failures"] = [];
  const needsLink = new Map<string, NeedsLinkJob & { agent: string }>();
  for (const run of runs) {
    const at = formatBerlin(run.at);
    const row = agents.get(run.agent) ?? { agent: run.agent, runs: 0, received: 0, saved: 0, skipped: 0, failed: 0, last_at: "" };
    row.runs += 1;
    row.received += run.received;
    row.saved += run.saved;
    row.skipped += run.skipped;
    row.failed += run.failed;
    row.last_at = at;
    agents.set(run.agent, row);
    for (const f of (run.failures as PushFailure[] | null) ?? []) failures.push({ ...f, agent: run.agent, at });
    for (const j of (run.needsLinkJobs as NeedsLinkJob[] | null) ?? []) needsLink.set(j.card_id, { ...j, agent: run.agent });
  }

  // Drop cards whose link was fixed (or that were deleted) since the push
  const ids = [...needsLink.keys()];
  const stillShort = new Set(
    ids.length
      ? (await prisma.application.findMany({
        where: { id: { in: ids }, job: { link: { contains: SHORT_LINK_HOST } } }, select: { id: true },
      })).map((a) => a.id)
      : [],
  );
  return {
    day,
    agents: [...agents.values()],
    failures,
    needs_link: [...needsLink.values()].filter((j) => stillShort.has(j.card_id)),
  };
}
