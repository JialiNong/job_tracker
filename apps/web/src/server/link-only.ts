/**
 * Save job URLs to the Tracker without a browser or AI ("Save link only"
 * on Log Job, and the agent push). Port of save_link_only_urls and the
 * helpers it uses in src/core/manual_log.py.
 *
 * For each URL:
 *   - already on the Tracker: with status=applied mark it applied (never
 *     re-stamping an earlier application), otherwise skip; either way fill
 *     a user-typed title / company / location and an agent tag the card
 *     does not have yet
 *   - otherwise: one transaction that creates the posting (or reuses a
 *     stored one) and its card, AI pending
 */
import {
  APPLIED_STATUSES, canonicalJobLink, detectSource, linkOnlyTitle, normalizeCountry, normalizePastedJobUrl,
  normalizeRecommendReason, normalizeRecommendedBy, now as clockNow, postingKey, resolveJobId,
} from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
import { newRecordId } from "./ids";
import { lookupKnownJob } from "./known-jobs";

export interface Identity {
  values: Record<string, string>;
  manualFields: string[];
}

export interface LinkOnlyOptions {
  status: "pending" | "applied";
  appliedAt?: Date | null;
  recommendedBy?: string;
  identity?: Identity;
  recommendReason?: string;
  country?: string;
  /**
   * Use this source / job id instead of reading one from the URL, and store the
   * URL as given. For links that carry no job id (an Indeed short link whose
   * redirect is blocked); the card is fixed later with Replace posting link.
   */
  pinnedId?: { source: string; jobId: string };
}

export interface LinkOnlyResult {
  ok: string[];
  skipped: string[];
  failed: string[];
  log: string[];
}

const hadApplication = (card: { appliedAt: Date | null; status: string; _count: { events: number } }) =>
  !!card.appliedAt || (APPLIED_STATUSES as readonly string[]).includes(card.status) || card._count.events > 0;

/** Fill user-typed identity fields on an existing posting; they become manual (kept on re-scrape). */
async function stampIdentity(tx: Prisma.TransactionClient, jobId: string, identity: Identity | undefined, now: Date) {
  if (!identity || !Object.keys(identity.values).length) return;
  const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { manualFields: true } });
  await tx.job.update({
    where: { id: jobId },
    data: { ...identity.values, manualFields: [...new Set([...job.manualFields, ...identity.manualFields])], updatedAt: now },
  });
}

/** An existing card: mark applied (status=applied) or leave it; returns applied | already | skip. */
async function handleExistingCard(
  prisma: PrismaClient, cardId: string, jobId: string, opts: LinkOnlyOptions, rec: string, now: Date,
): Promise<"applied" | "already" | "skip"> {
  return prisma.$transaction(async (tx) => {
    const card = await tx.application.findUniqueOrThrow({
      where: { id: cardId }, select: { appliedAt: true, status: true, recommendedBy: true, _count: { select: { events: true } } },
    });
    const applied = hadApplication(card);
    if (opts.status === "applied") {
      if (applied && (APPLIED_STATUSES as readonly string[]).includes(card.status)) {
        await stampIdentity(tx, jobId, opts.identity, now);
        return "already"; // applied before this Log Job: an agent tag would mislead
      }
      await tx.application.update({
        where: { id: cardId },
        data: {
          status: "applied", manuallyApplied: true, manuallyLogged: true, updatedAt: now,
          ...(card.appliedAt ? {} : { appliedAt: opts.appliedAt ?? now }),
          ...(rec && !applied && !normalizeRecommendedBy(card.recommendedBy) ? { recommendedBy: rec } : {}),
        },
      });
      await stampIdentity(tx, jobId, opts.identity, now);
      return "applied";
    }
    // Not applying: tag a never-applied, untagged card with the agent; never touch progress
    if (rec && !applied && !normalizeRecommendedBy(card.recommendedBy)) {
      await tx.application.update({ where: { id: cardId }, data: { recommendedBy: rec, updatedAt: now } });
    }
    await stampIdentity(tx, jobId, opts.identity, now);
    return "skip";
  });
}

export async function saveLinkOnly(prisma: PrismaClient, urls: string[], opts: LinkOnlyOptions): Promise<LinkOnlyResult> {
  const result: LinkOnlyResult = { ok: [], skipped: [], failed: [], log: [] };
  const log = (line: string) => result.log.push(line);
  const rec = normalizeRecommendedBy(opts.recommendedBy);
  const reason = normalizeRecommendReason(opts.recommendReason);
  const country = normalizeCountry(opts.country);
  log(`Link-only save: ${urls.length} URL(s) as ${opts.status === "applied" ? "applied" : "Not Applied"} (no scrape, no AI)`);

  for (const [i, raw] of urls.entries()) {
    const url = normalizePastedJobUrl(raw);
    if (!url) continue;
    log(`[${i + 1}/${urls.length}] ${url}`);
    let source = opts.pinnedId?.source ?? detectSource(url);
    let jobId = opts.pinnedId?.jobId ?? resolveJobId(url, source);
    if (!jobId) {
      log("  Failed: cannot read a job id from this URL");
      result.failed.push(url);
      continue;
    }
    const now = clockNow();
    let hit = await lookupKnownJob(prisma, jobId, source, url);
    // Same ad stored under another id / source (careers page vs ATS board): log it under that row
    if (hit?.matched_by === "posting_key" && postingKey(url)) {
      log(`  Same posting already saved as ${hit.source}/${hit.job_id}: ${hit.title}`);
      source = hit.source;
      jobId = hit.job_id;
    }
    if (hit && hit.collection === "timeout_jobs") hit = null; // a timeout is not a posting row yet

    if (hit?.on_tracker) {
      const outcome = await handleExistingCard(prisma, hit._id, hit.jobId, opts, rec, now);
      if (outcome === "applied") {
        log("  Marked the existing Tracker card as applied");
        result.ok.push(url);
      } else {
        log(outcome === "already" ? "  Already on the Tracker as an application: skipped" : "  Already on the Tracker: skipped");
        result.skipped.push(url);
      }
      continue;
    }

    const link = opts.pinnedId ? url : canonicalJobLink(url, source, jobId);
    const title = opts.identity?.values.title ?? linkOnlyTitle(link, source, jobId);
    const applied = opts.status === "applied";
    try {
      await prisma.$transaction(async (tx) => {
        // Reuse a stored posting (e.g. one on Unmatched); it keeps its AI result
        const postingId = hit?.jobId || newRecordId();
        if (!hit) {
          await tx.job.create({
            data: {
              id: postingId, source, externalId: jobId, link, title,
              company: opts.identity?.values.company ?? "", location: opts.identity?.values.location ?? "",
              postingKey: postingKey(link), manualFields: opts.identity?.manualFields ?? [],
              analysisState: "pending", scrapedAt: now, updatedAt: now,
            },
          });
        } else {
          await stampIdentity(tx, postingId, opts.identity, now);
        }
        await tx.application.create({
          data: {
            id: newRecordId(), jobId: postingId, status: opts.status,
            origin: rec ? "agent" : "manual", manuallyLogged: true, manuallyApplied: applied,
            appliedAt: applied ? opts.appliedAt ?? now : null,
            recommendedBy: rec || null, recommendReason: reason || null, country: country || null,
            // A backdated application sorts and shows under its applied day
            addedAt: applied ? opts.appliedAt ?? now : now, updatedAt: now,
            ...(applied ? { events: { create: { step: "applied", at: opts.appliedAt ?? now } } } : {}),
          },
        });
      });
      log(`  Saved to the Tracker (${applied ? "applied" : "Not Applied"}, AI pending)`);
      result.ok.push(url);
    } catch (err) {
      log(`  Failed to save: ${(err as Error).message}`);
      result.failed.push(url);
    }
  }
  log(`Saved ${result.ok.length}, skipped ${result.skipped.length}, failed ${result.failed.length}`);
  return result;
}
