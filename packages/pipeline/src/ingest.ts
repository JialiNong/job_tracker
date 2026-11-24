/**
 * API listings -> filters -> jobs table (port of ingest in src/sources/base.py).
 * Cheapest checks first; the full JD is fetched and the AI title check paid
 * for only after the free filters pass:
 *
 *   too old -> outside Germany -> excluded title -> off-topic (feeds) ->
 *   already stored (id / posting key) -> same company + title (this run, then
 *   stored) -> same role from another board -> AI title check ->
 *   fetch JD -> English only -> save
 */
import { postingKey } from "@tracker/core";
import type { PrismaClient } from "@tracker/db/client";
import { type LlmClient, assessJobDescription, isNonEnglishJobDetail, stripHtml } from "@tracker/matching";
import { API_MAX_POSTING_AGE_DAYS } from "./config.js";
import { dedupKey, findCrossSourceDuplicate } from "./dedup.js";
import { newRecordId } from "./ids.js";
import { lookupKnownJob } from "./known-jobs.js";
import { germanyScopeOk } from "./location.js";
import { type ScraperStat, incrementScraperStat } from "./scraper-stats.js";
import type { Log, SourceJob } from "./sources/types.js";
import { isApiTitleExcluded, isOnTopicTitle, isTitleRelevantByAi, titleMatchesAutoPass } from "./title-gate.js";

export interface IngestOptions {
  /** Keyword-less feeds (Arbeitnow, ATS boards): the title must look like a dev role. */
  requireOnTopicTitle?: boolean;
  dryRun?: boolean;
  /** For the AI title check; null skips it (fails open, like Python without a key). */
  client: LlmClient | null;
  titleModel: string;
  runId?: string | null;
  log?: Log;
  now?: Date;
}

export type IngestStats = Record<string, number>;

/** HTML -> text when it looks like HTML, else trimmed (_plain in base.py). */
const plain = (text: string | undefined) => {
  if (!text) return "";
  return text.includes("<") && text.includes(">") ? stripHtml(text) : text.trim();
};

export const isTooOld = (job: SourceJob, now = new Date(), maxDays = API_MAX_POSTING_AGE_DAYS) =>
  !!job.postedAt && !!maxDays && job.postedAt.getTime() < now.getTime() - maxDays * 86_400_000;

export async function ingest(prisma: PrismaClient, jobs: Iterable<SourceJob>, opts: IngestOptions): Promise<IngestStats> {
  const log = opts.log ?? console.log;
  const stats: IngestStats = {};
  const bump = (key: string) => { stats[key] = (stats[key] ?? 0) + 1; };
  const stat = async (key: ScraperStat) => { if (!opts.dryRun) await incrementScraperStat(prisma, key); };
  const seen = new Set<string>();
  const seenKeys = new Set<string>(); // company + title: one role posted per city

  for (const job of jobs) {
    bump("listed");
    const label = `[${job.source}] ${job.title.slice(0, 70)} | ${job.company.slice(0, 40)}`;
    if (!job.title || !job.link || !job.jobId) { bump("invalid"); continue; }
    const idKey = `${job.source}\u0000${job.jobId}`;
    if (seen.has(idKey)) { bump("repeat_in_run"); continue; }
    seen.add(idKey);

    if (isTooOld(job, opts.now)) { bump("too_old"); continue; }
    if (!germanyScopeOk(job)) { bump("not_germany"); continue; }
    if (isApiTitleExcluded(job.title)) { bump("title_excluded"); continue; }
    if (opts.requireOnTopicTitle && !isOnTopicTitle(job.title)) { bump("off_topic"); continue; }
    // Also by link: the same ad saved by hand or from another URL (?language=en ...)
    if (await lookupKnownJob(prisma, job.jobId, job.source, job.link)) { bump("known"); continue; }
    const key = dedupKey(job.title, job.company);
    if (seenKeys.has(key)) { bump("repeat_in_run"); continue; }
    seenKeys.add(key);
    if (await prisma.job.findFirst({ where: { dedupKey: key }, select: { id: true } })) {
      bump("known"); // same company + title saved earlier (another city / reposted)
      continue;
    }
    const dup = await findCrossSourceDuplicate(prisma, job.title, job.company, job.source);
    if (dup) {
      bump("cross_source_duplicate");
      log(`  = ${label} — already saved from ${dup.source}`);
      continue;
    }
    if (!titleMatchesAutoPass(job.title) && !(await isTitleRelevantByAi(opts.client, job.title, opts.titleModel, log))) {
      bump("ai_title_filtered");
      await stat("aiTitleFiltered");
      log(`  ✗ ${label} — AI title check: unrelated`);
      continue;
    }

    let description = plain(job.description);
    if (!description && job.fetchDescription) {
      try {
        description = plain(await job.fetchDescription());
      } catch (err) {
        log(`  ⚠ ${label} — description fetch failed: ${(err as Error).message}`); // saved with an empty JD
        description = "";
      }
    }
    await stat("titlePassedClicked");

    const quality = assessJobDescription(description, job.title, job.company);
    const [skip, lang] = isNonEnglishJobDetail(description);
    if (skip) {
      bump("german_filtered");
      await stat("germanFiltered");
      log(`  ✗ ${label} — JD language ${lang}`);
      continue;
    }
    if (opts.dryRun) {
      bump("would_save");
      log(`  ✓ ${label} — would save (${quality.kind} JD, ${description.length} chars)`);
      continue;
    }
    const now = new Date();
    const saved = await prisma.job.createMany({
      skipDuplicates: true, // same id or posting key saved meanwhile: a duplicate, like the Mongo unique index
      data: [{
        id: newRecordId(), source: job.source, externalId: job.jobId, link: job.link,
        title: job.title.trim(), company: job.company.trim(), location: job.location.trim(), description,
        applicants: "", remote: !!job.remote, dedupKey: key, postedAt: job.postedAt ?? null,
        externalUrl: job.extra?.externalUrl || null, atsProvider: job.extra?.atsProvider ?? null, atsSlug: job.extra?.atsSlug ?? null,
        tags: job.extra?.tags ?? [], jobTypes: job.extra?.jobTypes ?? [], runId: opts.runId ?? null,
        postingKey: postingKey(job.link) ?? null,
        descriptionQuality: quality.kind, descriptionQualityReason: quality.reason,
        descriptionEmpty: quality.kind === "empty", descriptionIncomplete: quality.kind !== "ok",
        scrapedAt: now, updatedAt: now,
      }],
    });
    bump(saved.count ? "saved" : "save_failed_or_duplicate");
  }
  return stats;
}
