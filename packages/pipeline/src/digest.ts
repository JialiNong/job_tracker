/**
 * The matched-jobs digest sent to Telegram after a run (port of
 * src/tg/digest.py): one card per job, packed into as few messages as fit.
 * Python found "this run's" cards by run_id; here the matcher returns the
 * cards it created, and the digest gets their ids.
 */
import { now as clockNow, berlinDayBounds, formatBerlinDate } from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";
import { pyRound1 } from "@tracker/matching";
import { sendTelegramMessage } from "./telegram.js";

const TELEGRAM_MSG_LIMIT = 3500; // hard limit 4096; room for UTF-16 emoji expansion

const STATUS_LABELS: Record<string, string> = {
  pending: "Not Applied", applied: "Applied", screening: "Screening", rejected: "Rejected", interview: "Interview",
  offer: "Offer", unsuitable: "Unsuitable", closed: "Closed", closed_no_reply: "Closed · No Reply",
  prev_rejected: "Prev. Rejected", too_many_questions: "Skipped · Long Form", repost: "Repost", duplicate: "Duplicate",
};
// API sources get a display name and a company line; LinkedIn / Indeed keep their old card
export const SOURCE_LABELS: Record<string, string> = {
  arbeitnow: "Arbeitnow API", arbeitsagentur: "Bundesagentur", adzuna: "Adzuna API", ats: "ATS",
};

export interface DigestJob {
  title: string;
  location: string;
  match_score: number | null;
  source: string;
  link: string;
  job_id: string;
  company: string;
  status: string;
  special_match: boolean;
}

/** html.escape(s) with quote=True. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const len = (s: string) => [...s].length;
const titleCase = (s: string) => s.replace(/\p{L}+/gu, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());

/** An absolute job URL (LinkedIn / Indeed relative hrefs -> https). */
export function normalizeJobLink(job: Pick<DigestJob, "link" | "source" | "job_id">): string {
  const link = (job.link || "").trim();
  const source = (job.source || "").toLowerCase();
  const jobId = String(job.job_id || "").trim();
  if (source === "linkedin") {
    if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}/`;
    if (link && !link.startsWith("http")) return `https://www.linkedin.com${link}`;
  }
  if (link && !link.startsWith("http") && source === "indeed") return `https://www.indeed.com${link}`;
  return link;
}

export function formatJobBlock(index: number, job: DigestJob): string {
  const sourceKey = (job.source || "unknown").toLowerCase();
  const source = esc(SOURCE_LABELS[sourceKey] ?? titleCase(sourceKey));
  const company = sourceKey in SOURCE_LABELS ? esc(job.company || "") : "";
  const statusKey = job.status || "pending";
  // f"{score:.1f}": ties round to even (9.25 -> 9.2)
  const scoreText = pyRound1(job.match_score ?? 0).toFixed(1);
  const lines = [
    `<b>${index}. ${esc(job.title || "Untitled")}</b>`,
    ...(company ? [`🏢 ${company}`] : []),
    `📍 ${esc(job.location || "N/A")}`,
    `⭐ ${scoreText}/10 · ${source}`,
    `🏷 ${esc(STATUS_LABELS[statusKey] ?? statusKey)}`,
  ];
  if (job.special_match) lines.splice(lines.length - 1, 0, "★ Special Match");
  const link = normalizeJobLink(job);
  if (link.startsWith("http")) lines.push(`🔗 <a href="${esc(link)}">Open job</a>`);
  return lines.join("\n");
}

/** All jobs in as few messages as possible, each under the limit. */
export function buildMatchMessages(jobs: DigestJob[], label = "Today's matches"): string[] {
  const header = `📋 ${label}: <b>${jobs.length}</b>\n`;
  const messages: string[] = [];
  let current = header;
  jobs.forEach((job, i) => {
    const block = formatJobBlock(i + 1, job);
    const candidate = current !== header ? `${current}\n\n${block}` : `${header}\n${block}`;
    if (len(candidate) <= TELEGRAM_MSG_LIMIT) {
      current = candidate;
      return;
    }
    if (current !== header) messages.push(current);
    const alone = `${header}\n${block}`;
    if (len(alone) > TELEGRAM_MSG_LIMIT) {
      messages.push([...alone].slice(0, TELEGRAM_MSG_LIMIT).join(""));
      current = header;
    } else {
      current = alone;
    }
  });
  if (current !== header) messages.push(current);
  return messages;
}

/** Cards by id (this run), or every card added today (Berlin), highest score first. */
export async function loadDigestJobs(prisma: PrismaClient, cardIds?: string[]): Promise<DigestJob[]> {
  const today = berlinDayBounds(formatBerlinDate(clockNow()))!;
  const rows = await prisma.application.findMany({
    where: cardIds ? { id: { in: cardIds } } : { addedAt: { gte: today.start } },
    select: {
      status: true,
      job: {
        select: {
          title: true, location: true, source: true, link: true, externalId: true, company: true,
          currentAnalysis: { select: { matchScore: true, details: true } },
        },
      },
    },
  });
  return rows
    .map((r) => ({
      title: r.job.title, location: r.job.location, source: r.job.source, link: r.job.link, job_id: r.job.externalId,
      company: r.job.company, status: r.status, match_score: r.job.currentAnalysis?.matchScore ?? null,
      special_match: (r.job.currentAnalysis?.details as { special_match?: unknown } | undefined)?.special_match === true,
    }))
    .sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
}

/** Send the digest. Returns how many jobs it listed and how many messages Telegram accepted. */
export async function pushMatchDigest(
  prisma: PrismaClient, cardIds?: string[], log: (l: string) => void = console.log,
): Promise<{ jobs: number; sent: number }> {
  let jobs: DigestJob[];
  try {
    jobs = await loadDigestJobs(prisma, cardIds);
  } catch (err) {
    const ok = await sendTelegramMessage(`⚠️ Failed to load matches: ${(err as Error).message}`, { log });
    return { jobs: 0, sent: ok ? 1 : 0 };
  }
  if (!jobs.length) {
    const ok = await sendTelegramMessage(cardIds ? "📭 No new matches from this run." : "📭 No matched jobs for today.", { log });
    return { jobs: 0, sent: ok ? 1 : 0 };
  }
  let sent = 0;
  for (const message of buildMatchMessages(jobs, cardIds ? "This run's matches" : "Today's matches")) {
    if (await sendTelegramMessage(message, { parseMode: "HTML", disableWebPagePreview: true, log })) sent += 1;
    await new Promise((r) => setTimeout(r, 250));
  }
  log(`Telegram match digest: ${jobs.length} jobs in ${sent} message(s)`);
  return { jobs: jobs.length, sent };
}
