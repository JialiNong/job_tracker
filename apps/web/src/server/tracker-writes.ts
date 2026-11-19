/**
 * Tracker card writes: status, timeline, notes, highlights, Q&A, applicant
 * position, title/company/location, posting link, delete. Replaces the
 * PATCH / DELETE routes in src/web/routes/jobs.py.
 *
 * Every write that touches more than one row (timeline + status + applied
 * date) runs in one transaction, so a failure cannot leave the timeline and
 * the status disagreeing.
 */
import {
  STATUS_MAP, TIMELINE_STEPS, canFetchDetails, formatBerlin, indeedJobIdVariants, normalizeTimeline,
  now as clockNow, parseApplicantPosition, replacementLinkFields, statusUpdate, timelineUpdate,
  unknownTimelineSteps, type DatedEvent, type StatusUpdate, type TrackerJob,
} from "@tracker/core";
import { Prisma, type PrismaClient } from "@tracker/db/client";

/** A result the route turns into JSON + an HTTP status. */
export type WriteResult = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown> = {}): WriteResult => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): WriteResult =>
  ({ status, body: { ...extra, error } });
const NOT_FOUND = fail(404, "Job not found");

const MAX_HIGHLIGHTS = 8;
const MAX_HIGHLIGHT_LENGTH = 40;
const BATCH_MAX = 80;

// ── Loading a card for the rules ────────────────────────────────────────────

async function loadCard(prisma: PrismaClient | Prisma.TransactionClient, id: string) {
  return prisma.application.findUnique({
    where: { id },
    include: {
      events: { orderBy: [{ at: "asc" }, { id: "asc" }] },
      job: {
        select: {
          id: true, source: true, externalId: true, link: true, title: true, company: true,
          description: true, detailsFetchedAt: true, linkReplacedAt: true, manualFields: true,
          analysisState: true, currentAnalysis: { select: { summary: true } },
        },
      },
    },
  });
}

type Card = NonNullable<Awaited<ReturnType<typeof loadCard>>>;

function asTrackerJob(card: Card): TrackerJob {
  return {
    status: card.status,
    applied_at: card.appliedAt,
    updated_at: card.updatedAt,
    matched_at: card.addedAt,
    application_timeline: card.events.map((e) => ({ step: e.step, at: e.at })),
  };
}

/** Apply a status / timeline update in one transaction. */
async function writeUpdate(prisma: PrismaClient, id: string, update: StatusUpdate, now: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id },
      data: {
        status: update.status as Prisma.ApplicationUpdateInput["status"],
        updatedAt: now,
        ...(update.appliedAt !== undefined ? { appliedAt: update.appliedAt } : {}),
        ...(update.applicantPosition === null ? { applicantPosition: null } : {}),
      },
    });
    if (update.events !== undefined) {
      await tx.applicationEvent.deleteMany({ where: { applicationId: id } });
      if (update.events.length) {
        await tx.applicationEvent.createMany({
          data: update.events.map((e: DatedEvent) => ({
            applicationId: id, step: e.step as Prisma.ApplicationEventCreateManyInput["step"], at: e.at,
          })),
        });
      }
    }
  });
}

// ── Status and timeline ─────────────────────────────────────────────────────

export async function setStatus(prisma: PrismaClient, id: string, body: Record<string, unknown>): Promise<WriteResult> {
  const status = body.status;
  if (typeof status !== "string" || !(status in STATUS_MAP)) {
    return fail(400, `Invalid status. Allowed: ${pyList(Object.keys(STATUS_MAP))}`);
  }
  const card = await loadCard(prisma, id);
  if (!card) return NOT_FOUND;
  const now = clockNow();
  await writeUpdate(prisma, id, statusUpdate(asTrackerJob(card), status, now), now);
  return ok({ status });
}

export async function setTimeline(prisma: PrismaClient, id: string, body: Record<string, unknown>): Promise<WriteResult> {
  const raw = body.timeline ?? [];
  const unknown = unknownTimelineSteps(raw);
  if (unknown.length) {
    // Never drop a step silently and still report success
    return fail(400, `Unknown progress step: ${unknown.join(", ")}. If you just updated the app, restart the web server.`);
  }
  const now = clockNow();
  const card = await loadCard(prisma, id);
  if (!card) return NOT_FOUND;
  const update = timelineUpdate(asTrackerJob(card), normalizeTimeline(raw, now));
  await writeUpdate(prisma, id, update, now);
  const appliedAt = update.appliedAt !== undefined ? update.appliedAt : card.appliedAt;
  return ok({
    status: update.status,
    applied_at: appliedAt ? formatBerlin(appliedAt) : null,
    application_timeline: update.events.map((e) => ({ step: e.step, label: TIMELINE_STEPS[e.step], at: formatBerlin(e.at) })),
  });
}

// ── Simple fields ───────────────────────────────────────────────────────────

/** update() on a missing row throws P2025; turn that into "not found". */
async function updateCard(prisma: PrismaClient, id: string, data: Prisma.ApplicationUpdateInput): Promise<boolean> {
  try {
    await prisma.application.update({ where: { id }, data: { ...data, updatedAt: clockNow() } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return false;
    throw err;
  }
}

export async function setNotes(prisma: PrismaClient, id: string, body: Record<string, unknown>): Promise<WriteResult> {
  const notes = body.notes == null ? "" : String(body.notes);
  return (await updateCard(prisma, id, { notes })) ? ok() : NOT_FOUND;
}

export async function setHighlights(prisma: PrismaClient, id: string, body: Record<string, unknown>): Promise<WriteResult> {
  const raw = body.highlights ?? [];
  if (!Array.isArray(raw)) return fail(400, "highlights must be a list");
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = String(item).trim().slice(0, MAX_HIGHLIGHT_LENGTH); // short tags stay readable on cards
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    cleaned.push(tag);
    if (cleaned.length >= MAX_HIGHLIGHTS) break;
  }
  return (await updateCard(prisma, id, { highlights: cleaned })) ? ok({ highlights: cleaned }) : NOT_FOUND;
}

export async function setApplicationQa(prisma: PrismaClient, id: string, body: Record<string, unknown>): Promise<WriteResult> {
  const raw = body.application_qa ?? [];
  if (!Array.isArray(raw)) return fail(400, "application_qa must be a list");
  const cleaned = raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({ question: String(item.question ?? "").trim(), answer: String(item.answer ?? "").trim() }))
    .filter((qa) => qa.question || qa.answer);
  return (await updateCard(prisma, id, { applicationQa: cleaned })) ? ok({ application_qa: cleaned }) : NOT_FOUND;
}

export async function setApplicantPosition(prisma: PrismaClient, id: string, body: Record<string, unknown>): Promise<WriteResult> {
  const { value, error } = parseApplicantPosition(body.applicant_position);
  if (error) return fail(400, error);
  return (await updateCard(prisma, id, { applicantPosition: value })) ? ok({ applicant_position: value }) : NOT_FOUND;
}

/**
 * Title / company / location are edited by hand to clean them up (e.g. drop
 * "GmbH" so a company's postings group together). They live on the posting,
 * and are added to manual_fields so a later re-scrape keeps them (D1).
 */
export async function setInfo(prisma: PrismaClient, id: string, body: Record<string, unknown>): Promise<WriteResult> {
  const fields: Record<string, string> = {};
  for (const f of ["title", "company", "location"] as const) {
    if (typeof body[f] === "string") fields[f] = (body[f] as string).trim();
  }
  if (!Object.keys(fields).length) return fail(400, "No fields to update");
  const now = clockNow();
  const done = await prisma.$transaction(async (tx) => {
    const card = await tx.application.findUnique({ where: { id }, select: { jobId: true, job: { select: { manualFields: true } } } });
    if (!card) return false;
    const manual = [...new Set([...card.job.manualFields, ...Object.keys(fields)])];
    await tx.job.update({ where: { id: card.jobId }, data: { ...fields, manualFields: manual, updatedAt: now } });
    await tx.application.update({ where: { id }, data: { updatedAt: now } });
    return true;
  });
  return done ? ok() : NOT_FOUND;
}

// ── Posting link ────────────────────────────────────────────────────────────

/**
 * Another posting (or a pending timeout) already uses this URL? Same order
 * as Flask's lookup_known_job: by source + job id first, then by posting key.
 */
async function conflictFor(
  prisma: PrismaClient, fields: { source: string; job_id: string; posting_key?: string }, ownJobId: string,
): Promise<string | null> {
  const ids = fields.source === "indeed" ? indeedJobIdVariants(fields.job_id) : [fields.job_id];
  const message = (title: string, onTracker: boolean) => {
    const name = title.trim() || "another job";
    return onTracker ? `Already on Tracker as ${name}` : `This URL is already stored as another job (${name})`;
  };
  const select = { id: true, title: true, application: { select: { id: true } } } as const;

  const byId = await prisma.job.findFirst({ where: { source: fields.source, externalId: { in: ids } }, select });
  if (byId) return byId.id === ownJobId ? null : message(byId.title, !!byId.application);
  const timeout = await prisma.scrapeTimeout.findFirst({
    where: { source: fields.source, externalId: { in: ids }, reviewStatus: "open" }, select: { title: true },
  });
  if (timeout) return message(timeout.title, false);
  if (fields.posting_key) {
    const byKey = await prisma.job.findFirst({ where: { postingKey: fields.posting_key }, select });
    if (byKey) return byKey.id === ownJobId ? null : message(byKey.title, !!byKey.application);
  }
  return null;
}

export async function replaceLink(prisma: PrismaClient, id: string, body: Record<string, unknown>): Promise<WriteResult> {
  const { fields, error } = await replacementLinkFields(String(body.link || body.url || ""));
  if (error || !fields) return fail(400, error ?? "Paste a job URL");
  const card = await loadCard(prisma, id);
  if (!card) return NOT_FOUND;
  const { job } = card;

  if (job.link.trim() === fields.link && job.externalId === fields.job_id && job.source === fields.source) {
    return ok({ unchanged: true, link: fields.link, source: fields.source, job_id: fields.job_id });
  }
  const conflict = await conflictFor(prisma, fields, job.id);
  if (conflict) return fail(409, conflict);

  const now = clockNow();
  try {
    await prisma.$transaction([
      prisma.job.update({
        where: { id: job.id },
        data: {
          link: fields.link, source: fields.source, externalId: fields.job_id,
          postingKey: fields.posting_key ?? null, linkReplacedAt: now, updatedAt: now,
        },
      }),
      prisma.application.update({ where: { id }, data: { updatedAt: now } }),
    ]);
  } catch (err) {
    // Unique (source, external_id) / posting_key: another row took it meanwhile
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return fail(409, "This URL is already stored as another job");
    }
    throw err;
  }
  const merged = {
    title: job.title, description: job.description, recommended_by: card.recommendedBy,
    ai_pending: job.analysisState === "pending", summary: job.currentAnalysis?.summary ?? "",
    details_fetched_at: job.detailsFetchedAt, link_replaced_at: now,
  };
  return ok({
    unchanged: false, link: fields.link, source: fields.source, job_id: fields.job_id,
    can_fetch_details: canFetchDetails(merged),
  });
}

// ── Delete ──────────────────────────────────────────────────────────────────

/**
 * Delete a card and its posting (analyses and events go with it, by FK
 * cascade), so it shows neither on the Tracker nor on Unmatched. Indeed
 * postings also drop leftover rows stored under the old jk prefixes.
 */
async function deleteCard(prisma: PrismaClient, id: string) {
  return prisma.$transaction(async (tx) => {
    const card = await tx.application.findUnique({
      where: { id }, select: { job: { select: { id: true, source: true, externalId: true, title: true, company: true } } },
    });
    if (!card) return null;
    const { job } = card;
    let deletedJobs = (await tx.job.deleteMany({ where: { id: job.id } })).count;
    if (job.source === "indeed") {
      deletedJobs += (await tx.job.deleteMany({
        where: { source: "indeed", externalId: { in: indeedJobIdVariants(job.externalId) }, application: null },
      })).count;
    }
    return { deletedJobs, title: job.title, company: job.company };
  });
}

export async function deleteTrackerJob(prisma: PrismaClient, id: string): Promise<WriteResult> {
  const deleted = await deleteCard(prisma, id);
  if (!deleted) return NOT_FOUND;
  return ok({ deleted_matched: 1, deleted_jobs: deleted.deletedJobs, title: deleted.title, company: deleted.company });
}

export async function batchDelete(prisma: PrismaClient, body: Record<string, unknown>): Promise<WriteResult> {
  const raw = body.ids;
  const ids: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const text = String(item ?? "").trim();
      if (!text || ids.includes(text)) continue;
      if (!/^[0-9a-f]{24}$/.test(text)) return fail(400, `Invalid id: ${text}`, { ok: false });
      ids.push(text);
      if (ids.length >= BATCH_MAX) break;
    }
  }
  if (!ids.length) return fail(400, "Select at least one job", { ok: false });
  const deleted: string[] = [];
  let missing = 0;
  for (const id of ids) {
    if (await deleteCard(prisma, id)) deleted.push(id);
    else missing += 1;
  }
  return ok({ deleted: deleted.length, missing, ids: deleted });
}

/** Python's repr() of a list of strings, as Flask put it in the error text. */
function pyList(items: string[]): string {
  return `[${items.map((s) => `'${s}'`).join(", ")}]`;
}
