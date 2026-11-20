/**
 * Mongo documents -> Postgres rows. Pure: no database access, so the same
 * code migrates the live data (cli/from-mongo.ts) and seeds the contract
 * fixture (cli/seed-fixture.ts), and is unit-tested on its own.
 *
 * Every rule here is explained in docs/pg-schema.md (D1-D13); every case
 * where data is merged, dropped or guessed lands in the report.
 */
import type { Prisma } from "@prisma/client";
import { companyKey } from "./company-key.js";
import { toDateOnly, toInstant } from "./time.js";

type Doc = Record<string, any>;

export interface MongoSource {
  jobs: Doc[];
  matched_jobs: Doc[];
  timeout_jobs: Doc[];
  scraper_stats: Doc[];
  company_profiles: Doc[];
  stats_cache: Doc[];
}

export interface Rows {
  companyProfiles: Prisma.CompanyProfileCreateManyInput[];
  jobs: Prisma.JobCreateManyInput[];
  jobAnalyses: Prisma.JobAnalysisCreateManyInput[];
  applications: Prisma.ApplicationCreateManyInput[];
  applicationEvents: Prisma.ApplicationEventCreateManyInput[];
  scrapeTimeouts: Prisma.ScrapeTimeoutCreateManyInput[];
  scraperDailyStats: Prisma.ScraperDailyStatCreateManyInput[];
  scraperTotals: Prisma.ScraperTotalsCreateManyInput[];
  statsCache: Prisma.StatsCacheCreateManyInput[];
  /** jobs.current_analysis_id, set after both tables exist (the FKs are circular). */
  currentAnalysis: { jobId: string; analysisId: bigint }[];
}

export interface Report {
  source: Record<string, number>;
  rows: Record<string, number>;
  duplicateKeysMerged: { key: string; kept: string; dropped: string[] }[];
  postingKeyMerged: { postingKey: string; kept: string; dropped: { job: string; application?: string; status?: string; notes?: string; events: number }[] }[];
  postingKeyCleared: { postingKey: string; job: string; reason: string }[];
  twinConflicts: { application: string; field: string; tracker: unknown; scraped: unknown }[];
  matchedWithoutJob: string[];
  unknownValues: { where: string; id: string; value: unknown }[];
  appliedAtMismatch: { application: string; appliedAt: string | null; firstAppliedEvent: string | null }[];
  profilesRecreated: { key: string; from: string }[];
  analysesWithoutProfile: { job: string; company: string }[];
  scrapedCompanyLooksWrong: { job: string; scrapedCompany: string; trackerCompany: string }[];
  extraAnalysisRuns: { job: string; shown: number | null; alsoKept: number | null; keptAt: string | null }[];
}

// ── Vocabularies (schema enums) ─────────────────────────────────────────────

const STATUSES = new Set([
  "pending", "applied", "screening", "interview", "interview_cancelled", "offer", "rejected",
  "unsuitable", "closed", "closed_no_reply", "prev_rejected", "too_many_questions", "repost", "duplicate",
]);
const STEPS = new Set([
  "applied", "reapplied", "screening", "screening_done", "interview_invite", "interview_1",
  "interview_2", "interview_3", "interview_final", "interview_cancelled", "rejected", "offer",
]);
const ORIGINS = new Set(["pipeline", "api", "manual", "agent"]);
/** Side statuses a posting_key duplicate may be dropped with (the user already marked it). */
const DROPPABLE_DUPLICATE_STATUSES = new Set(["duplicate", "repost"]);

/** Written with datetime.utcnow() in the Python app; every other naive time is Berlin (D10). */
const UTC_FIELDS = new Set(["link_replaced_at", "details_fetched_at"]);

const POSTING_FIELDS = ["title", "company", "location", "link", "description", "applicants"] as const;
const IDENTITY_FIELDS = new Set(["title", "company", "location"]);

/** AI output that is only displayed: goes to job_analyses.details (D4). */
const ANALYSIS_DETAIL_FIELDS = [
  "match_reasons", "missing_requirements", "red_flags", "nice_to_have_matches",
  "what_youll_do", "what_theyre_looking_for", "special_match", "special_match_reasons",
  "requirement_extract", "job_labels", "low_confidence", "grounded_in_description",
] as const;

// ── Small helpers ───────────────────────────────────────────────────────────

export function idOf(doc: Doc): string {
  const id = doc._id;
  if (id && typeof id === "object" && typeof id.toHexString === "function") return id.toHexString();
  if (id && typeof id === "object" && typeof id.$oid === "string") return id.$oid;
  return String(id);
}

const keyOf = (doc: Doc) => `${doc.source ?? ""}\u0000${doc.job_id ?? ""}`;
const str = (v: unknown, fallback = ""): string => (v == null ? fallback : String(v));
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
/** AI text fields: "" is a real value the UI shows (Flask returned it); only a missing field is null. */
const textOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const at = (doc: Doc, field: string) => toInstant(doc[field], { utc: UTC_FIELDS.has(field) });
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "") : [];
const intOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const isEmptyObject = (v: unknown) =>
  v == null || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

function emptyReport(source: MongoSource): Report {
  return {
    source: Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v.length])),
    rows: {},
    duplicateKeysMerged: [],
    postingKeyMerged: [],
    postingKeyCleared: [],
    twinConflicts: [],
    matchedWithoutJob: [],
    unknownValues: [],
    appliedAtMismatch: [],
    profilesRecreated: [],
    analysesWithoutProfile: [],
    scrapedCompanyLooksWrong: [],
    extraAnalysisRuns: [],
  };
}

// ── Transform ───────────────────────────────────────────────────────────────

export function transform(source: MongoSource): { rows: Rows; report: Report } {
  const report = emptyReport(source);

  // 1. One jobs document per (source, job_id): keep the analysed one, else the oldest (D8).
  const jobsByKey = new Map<string, Doc>();
  const dupGroups = new Map<string, Doc[]>();
  for (const doc of source.jobs) {
    const k = keyOf(doc);
    dupGroups.set(k, [...(dupGroups.get(k) ?? []), doc]);
  }
  for (const [k, group] of dupGroups) {
    const sorted = [...group].sort((a, b) =>
      Number(!!b.matched_at) - Number(!!a.matched_at)
      || (a.created_at?.getTime?.() ?? 0) - (b.created_at?.getTime?.() ?? 0));
    jobsByKey.set(k, sorted[0]!);
    if (group.length > 1) {
      report.duplicateKeysMerged.push({
        key: k.replace("\u0000", ":"), kept: idOf(sorted[0]!), dropped: sorted.slice(1).map(idOf),
      });
    }
  }

  const matchedByKey = new Map<string, Doc>();
  for (const m of source.matched_jobs) {
    if (jobsByKey.has(keyOf(m))) matchedByKey.set(keyOf(m), m);
    else report.matchedWithoutJob.push(idOf(m));
  }
  // A Tracker card without a scraped twin still needs a posting row.
  for (const id of report.matchedWithoutJob) {
    const m = source.matched_jobs.find((x) => idOf(x) === id)!;
    jobsByKey.set(keyOf(m), { ...m, _id: { $oid: syntheticJobId(id) } });
    matchedByKey.set(keyOf(m), m);
  }

  // 2. posting_key is unique: same posting through two sources is one job (D8).
  //    Prefer the posting the user kept: a card that is not a duplicate / repost.
  const byPostingKey = new Map<string, string[]>();
  for (const [k, doc] of jobsByKey) {
    const pk = strOrNull(matchedByKey.get(k)?.posting_key ?? doc.posting_key);
    if (pk) byPostingKey.set(pk, [...(byPostingKey.get(pk) ?? []), k]);
  }
  const clearedPostingKey = new Set<string>();
  for (const [pk, keys] of byPostingKey) {
    if (keys.length < 2) continue;
    const rank = (k: string) => {
      const m = matchedByKey.get(k);
      if (!m) return 2;
      return DROPPABLE_DUPLICATE_STATUSES.has(m.status) ? 1 : 0;
    };
    const ordered = [...keys].sort((a, b) => rank(a) - rank(b)
      || (jobsByKey.get(a)!.created_at?.getTime?.() ?? 0) - (jobsByKey.get(b)!.created_at?.getTime?.() ?? 0));
    const keep = ordered[0]!;
    const dropped: Report["postingKeyMerged"][number]["dropped"] = [];
    for (const k of ordered.slice(1)) {
      const m = matchedByKey.get(k);
      const job = jobsByKey.get(k)!;
      if (m && !DROPPABLE_DUPLICATE_STATUSES.has(m.status)) {
        // A real application: never drop it, just give up the shared key.
        clearedPostingKey.add(k);
        report.postingKeyCleared.push({ postingKey: pk, job: idOf(job), reason: `application ${idOf(m)} is ${m.status}` });
        continue;
      }
      dropped.push({
        job: idOf(job),
        application: m ? idOf(m) : undefined,
        status: m?.status,
        notes: m?.notes || undefined,
        events: Array.isArray(m?.application_timeline) ? m.application_timeline.length : 0,
      });
      jobsByKey.delete(k);
      matchedByKey.delete(k);
    }
    if (dropped.length) report.postingKeyMerged.push({ postingKey: pk, kept: idOf(jobsByKey.get(keep)!), dropped });
  }

  // 3. Company profiles, then the rest.
  const profiles = new Map<string, Prisma.CompanyProfileCreateManyInput>();
  for (const p of source.company_profiles) {
    profiles.set(idOf(p), {
      key: idOf(p),
      business: str(p.business),
      productType: str(p.product_type),
      vertical: str(p.vertical),
      markets: str(p.markets),
      marketsDetail: str(p.markets_detail),
      isRecruiterForOtherCompany: !!p.is_recruiter_for_other_company,
      sources: (p.sources ?? []) as Prisma.InputJsonValue,
      model: strOrNull(p._model ?? p.model),
      usage: (p._usage ?? p.usage ?? undefined) as Prisma.InputJsonValue | undefined,
      cachedAt: at(p, "cached_at") ?? new Date(0),
    });
  }

  const rows: Rows = {
    companyProfiles: [], jobs: [], jobAnalyses: [], applications: [], applicationEvents: [],
    scrapeTimeouts: [], scraperDailyStats: [], scraperTotals: [], statsCache: [], currentAnalysis: [],
  };
  let analysisId = 0n;

  for (const [k, scraped] of jobsByKey) {
    const m = matchedByKey.get(k);
    const jobId = idOf(scraped);

    // Posting fields: the Tracker copy wins where it differs (D1).
    const posting: Record<string, string> = {};
    const manual = new Set(strList(scraped.manual_fields).concat(strList(m?.manual_fields)));
    for (const f of POSTING_FIELDS) {
      const raw = str(scraped[f]);
      const tracked = m ? str(m[f]) : "";
      if (m && tracked !== "" && tracked !== raw) {
        posting[f] = tracked;
        if (f !== "description") {
          report.twinConflicts.push({ application: idOf(m), field: f, tracker: tracked, scraped: raw });
        }
        if (IDENTITY_FIELDS.has(f)) manual.add(f);
      } else {
        posting[f] = raw;
      }
    }
    if (m && /karriere bei|jobs bei|indeed/i.test(str(scraped.company)) && str(m.company) !== str(scraped.company)) {
      report.scrapedCompanyLooksWrong.push({ job: jobId, scrapedCompany: str(scraped.company), trackerCompany: str(m.company) });
    }

    const pick = (f: string) => (m && m[f] != null ? m[f] : scraped[f]);
    // What the Tracker / Unmatched page shows. A card made by "Can Apply" on
    // the Unmatched page copied only some AI fields (no labels, gate or
    // company profile); for the same run, fill those gaps from the posting,
    // which now shares the card's analysis.
    const analysisDoc = m ? withPostingGaps(m, scraped) : scraped;
    const aiPending = !!(m?.ai_pending ?? scraped.ai_pending);
    const analysed = !aiPending && analysisDoc.matched_at != null
      && (analysisDoc.match_score != null || analysisDoc.summary);

    const hasAnalysis = (doc: Doc) =>
      doc.matched_at != null && !doc.ai_pending && (doc.match_score != null || doc.summary);
    const analysisRow = (doc: Doc): Prisma.JobAnalysisCreateManyInput => {
      analysisId += 1n;
      const details: Record<string, unknown> = {};
      for (const f of ANALYSIS_DETAIL_FIELDS) if (doc[f] !== undefined) details[f] = doc[f];
      return {
        id: analysisId,
        jobId,
        analyzedAt: at(doc, "matched_at")!,
        trigger: "migration",
        matchScore: numOrNull(doc.match_score),
        matchGate: textOrNull(doc.match_gate),
        recommendation: textOrNull(doc.recommendation),
        summary: textOrNull(doc.summary),
        disqualificationReason: textOrNull(doc.disqualification_reason),
        details: details as Prisma.InputJsonValue,
        companyKey: resolveProfile(doc, scraped, posting.company!, jobId, profiles, report),
      };
    };

    let currentAnalysisId: bigint | null = null;
    if (analysed) {
      const current = analysisRow(analysisDoc);
      currentAnalysisId = current.id as bigint;
      rows.jobAnalyses.push(current);
      // The pipeline can re-run AI on a posting and update only the scraped
      // copy. Keep that run too (D2); the card keeps showing its own result.
      if (m && hasAnalysis(scraped) && differentRun(m, scraped)) {
        const other = analysisRow(scraped);
        rows.jobAnalyses.push(other);
        report.extraAnalysisRuns.push({
          job: jobId, shown: numOrNull(m.match_score), alsoKept: numOrNull(scraped.match_score),
          keptAt: iso(at(scraped, "matched_at")),
        });
      }
    }

    const userStatus = strOrNull(scraped.user_status);
    rows.jobs.push({
      id: jobId,
      source: str(scraped.source),
      externalId: str(scraped.job_id),
      link: posting.link!,
      externalUrl: strOrNull(pick("external_url")),
      title: posting.title!,
      company: posting.company!,
      location: posting.location!,
      description: posting.description!,
      applicants: posting.applicants!,
      postingKey: clearedPostingKey.has(k) ? null : strOrNull(pick("posting_key")),
      dedupKey: strOrNull(scraped.dedup_key),
      atsProvider: strOrNull(pick("ats_provider")),
      atsSlug: strOrNull(pick("ats_slug")),
      remote: typeof scraped.remote === "boolean" ? scraped.remote : null,
      tags: strList(scraped.tags),
      jobTypes: strList(scraped.job_types),
      keyword: strOrNull(scraped.keyword),
      runId: strOrNull(pick("run_id")),
      manualFields: [...manual].filter((f) => IDENTITY_FIELDS.has(f)),
      descriptionQuality: strOrNull(pick("description_quality")),
      descriptionQualityReason: strOrNull(pick("description_quality_reason")),
      descriptionEmpty: !!pick("description_empty"),
      descriptionIncomplete: !!pick("description_incomplete"),
      descriptionClearedAt: at(scraped, "description_cleared_at"),
      needsRefetch: !!pick("needs_refetch"),
      detailsFetchedAt: m?.details_fetched_at ? at(m, "details_fetched_at") : at(scraped, "details_fetched_at"),
      linkReplacedAt: m?.link_replaced_at ? at(m, "link_replaced_at") : at(scraped, "link_replaced_at"),
      postedAt: m?.posted_at ? at(m, "posted_at") : at(scraped, "posted_at"),
      scrapedAt: at(scraped, "created_at") ?? at(scraped, "matched_at") ?? new Date(0),
      updatedAt: at(scraped, "updated_at") ?? at(scraped, "created_at") ?? new Date(0),
      analysisState: aiPending ? "pending" : analysed ? "done" : "none",
      currentAnalysisId: null, // see rows.currentAnalysis
      userStatus,
      agentRecommendedBy: strOrNull(scraped.agent_recommended_by),
      agentRecommendedAt: at(scraped, "agent_recommended_at"),
      agentRecommendReason: strOrNull(scraped.agent_recommend_reason),
    });
    if (currentAnalysisId !== null) rows.currentAnalysis.push({ jobId, analysisId: currentAnalysisId });

    if (m) addApplication(m, jobId, rows, report);
  }

  // 4. Profiles (including any recreated from snapshots).
  rows.companyProfiles = [...profiles.values()];

  // 5. Pipeline bookkeeping.
  for (const t of source.timeout_jobs) {
    rows.scrapeTimeouts.push({
      id: idOf(t),
      source: str(t.source),
      externalId: str(t.job_id),
      link: str(t.link),
      title: str(t.title),
      company: str(t.company),
      location: str(t.location),
      keyword: strOrNull(t.keyword),
      reason: str(t.reason, "detail_timeout"),
      reviewStatus: str(t.review_status, "open"),
      timeoutCount: intOrNull(t.timeout_count) ?? 1,
      addedToTrackerAt: at(t, "added_to_matched_at"),
      createdAt: at(t, "created_at") ?? new Date(0),
      updatedAt: at(t, "updated_at") ?? at(t, "created_at") ?? new Date(0),
    });
  }
  for (const s of source.scraper_stats) {
    const id = idOf(s);
    const counters = {
      titlePassedClicked: intOrNull(s.title_passed_clicked) ?? 0,
      germanFiltered: intOrNull(s.german_filtered) ?? 0,
      aiTitleFiltered: intOrNull(s.ai_title_filtered) ?? 0,
      detailTimeout: intOrNull(s.detail_timeout) ?? 0,
      updatedAt: at(s, "updated_at") ?? new Date(0),
    };
    if (id === "global") {
      rows.scraperTotals.push({ id: 1, ...counters });
    } else if (id.startsWith("daily_")) {
      const day = toDateOnly(str(s.date ?? id.slice(6)));
      if (day) rows.scraperDailyStats.push({ day, ...counters });
      else report.unknownValues.push({ where: "scraper_stats.date", id, value: s.date });
    }
  }
  for (const c of source.stats_cache) {
    rows.statsCache.push({
      key: idOf(c),
      data: (c.data ?? {}) as Prisma.InputJsonValue,
      computedAt: at(c, "computed_at") ?? new Date(0),
    });
  }

  report.rows = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
  return { rows, report };
}

function addApplication(m: Doc, jobId: string, rows: Rows, report: Report) {
  const appId = idOf(m);
  let status = str(m.status, "pending");
  if (!STATUSES.has(status)) {
    report.unknownValues.push({ where: "matched_jobs.status", id: appId, value: status });
    status = "pending";
  }
  let origin = str(m.origin, "pipeline");
  if (!ORIGINS.has(origin)) {
    report.unknownValues.push({ where: "matched_jobs.origin", id: appId, value: origin });
    origin = "pipeline";
  }
  const appliedAt = at(m, "applied_at");
  rows.applications.push({
    id: appId,
    jobId,
    status: status as Prisma.ApplicationCreateManyInput["status"],
    origin: origin as Prisma.ApplicationCreateManyInput["origin"],
    appliedAt,
    notes: str(m.notes),
    highlights: strList(m.highlights),
    applicationQa: (Array.isArray(m.application_qa) ? m.application_qa : []) as Prisma.InputJsonValue,
    applicantPosition: intOrNull(m.applicant_position),
    country: strOrNull(m.country),
    recommendedBy: strOrNull(m.recommended_by),
    recommendReason: strOrNull(m.recommend_reason),
    manuallyLogged: !!m.manually_logged,
    manuallyApplied: !!m.manually_applied,
    fromUnmatched: !!m.from_unmatched,
    addedAt: at(m, "matched_at") ?? at(m, "created_at") ?? new Date(0),
    updatedAt: at(m, "updated_at") ?? at(m, "matched_at") ?? new Date(0),
  });

  let firstApplied: Date | null = null;
  for (const e of Array.isArray(m.application_timeline) ? m.application_timeline : []) {
    const step = str(e?.step);
    const when = toInstant(e?.at);
    if (!STEPS.has(step) || !when) {
      report.unknownValues.push({ where: "application_timeline", id: appId, value: e });
      continue;
    }
    if (step === "applied" && (!firstApplied || when < firstApplied)) firstApplied = when;
    rows.applicationEvents.push({ applicationId: appId, step: step as any, at: when, createdAt: when });
  }
  if (firstApplied && appliedAt && firstApplied.getTime() !== appliedAt.getTime()) {
    report.appliedAtMismatch.push({ application: appId, appliedAt: iso(appliedAt), firstAppliedEvent: iso(firstApplied) });
  }
}

/** Which company_profiles row this analysis used (D13). */
function resolveProfile(
  analysisDoc: Doc, scraped: Doc, company: string, jobId: string,
  profiles: Map<string, Prisma.CompanyProfileCreateManyInput>, report: Report,
): string | null {
  const snap = analysisDoc.company_profile;
  if (isEmptyObject(snap)) return null;
  // The profile was looked up with the company name the pipeline saw.
  const usedKey = companyKey(scraped.company);
  if (usedKey && profiles.has(usedKey)) return usedKey;
  const byText = [...profiles.values()].find((p) => p.business && p.business === snap.business);
  if (byText) return byText.key;
  const key = usedKey || companyKey(company);
  if (!key) {
    report.analysesWithoutProfile.push({ job: jobId, company });
    return null;
  }
  profiles.set(key, {
    key,
    business: str(snap.business),
    productType: str(snap.product_type),
    vertical: str(snap.vertical),
    markets: str(snap.markets),
    marketsDetail: str(snap.markets_detail),
    isRecruiterForOtherCompany: !!snap.is_recruiter_for_other_company,
    sources: (snap.sources ?? []) as Prisma.InputJsonValue,
    cachedAt: at(analysisDoc, "matched_at") ?? new Date(0),
  });
  report.profilesRecreated.push({ key, from: jobId });
  return key;
}

/** AI fields a "Can Apply" card (src/web/routes/unmatched.py) never copied from the posting. */
const POSTING_ONLY_AI_FIELDS = ["job_labels", "match_gate", "company_profile", "requirement_extract"] as const;

function withPostingGaps(card: Doc, scraped: Doc): Doc {
  if (differentRun(card, scraped)) return card;
  const gaps = POSTING_ONLY_AI_FIELDS.filter((f) => isBlank(card[f]) && !isBlank(scraped[f]));
  return gaps.length ? { ...card, ...Object.fromEntries(gaps.map((f) => [f, scraped[f]])) } : card;
}

const isBlank = (v: unknown) => v == null || v === "" || isEmptyObject(v);

/**
 * The Tracker copy and the scraped copy hold results of different AI runs.
 * Compared by content: one run written to both copies gets two matched_at
 * stamps a few milliseconds apart.
 */
function differentRun(tracker: Doc, scraped: Doc): boolean {
  return numOrNull(tracker.match_score) !== numOrNull(scraped.match_score)
    || textOrNull(tracker.summary) !== textOrNull(scraped.summary);
}

/** A stable 24-hex id for a posting row created for a Tracker card without a scraped twin. */
function syntheticJobId(applicationId: string): string {
  // Flip the last hex digit's high bit: deterministic, cannot collide with the card itself.
  const last = Number.parseInt(applicationId.slice(-1), 16) ^ 0x8;
  return applicationId.slice(0, -1) + last.toString(16);
}
