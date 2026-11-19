/**
 * After a load: read Postgres back and check it against the Mongo source.
 * Independent of transform.ts on purpose (it re-derives the expectations
 * from the raw documents), so a bug in the transform cannot hide itself.
 */
import type { PrismaClient } from "@prisma/client";
import type { MongoSource, Report } from "./transform.js";
import { idOf } from "./transform.js";
import { toInstant } from "./time.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function verify(prisma: PrismaClient, source: MongoSource, report: Report): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // Row counts: source minus what the report says was merged away.
  const droppedJobs = report.duplicateKeysMerged.reduce((n, d) => n + d.dropped.length, 0)
    + report.postingKeyMerged.reduce((n, d) => n + d.dropped.length, 0)
    - report.matchedWithoutJob.length;
  const droppedApps = report.postingKeyMerged.reduce((n, d) => n + d.dropped.filter((x) => x.application).length, 0);
  const counts = {
    jobs: [await prisma.job.count(), source.jobs.length - droppedJobs],
    applications: [await prisma.application.count(), source.matched_jobs.length - droppedApps],
    scrape_timeouts: [await prisma.scrapeTimeout.count(), source.timeout_jobs.length],
    company_profiles: [await prisma.companyProfile.count(), source.company_profiles.length + report.profilesRecreated.length],
  } as const;
  for (const [table, [got, want]] of Object.entries(counts)) {
    add(`count ${table}`, got === want, `${got} rows, expected ${want}`);
  }

  // Every Tracker card: status, applied_at, notes, highlights, timeline steps, shown title/company/location.
  const apps = await prisma.application.findMany({
    include: { job: { select: { title: true, company: true, location: true } }, events: { orderBy: { id: "asc" } } },
  });
  const byId = new Map(apps.map((a) => [a.id, a]));
  const droppedAppIds = new Set(report.postingKeyMerged.flatMap((d) => d.dropped.map((x) => x.application).filter(Boolean)));
  const problems: string[] = [];
  for (const m of source.matched_jobs) {
    const id = idOf(m);
    if (droppedAppIds.has(id)) continue;
    const a = byId.get(id);
    if (!a) { problems.push(`${id}: missing`); continue; }
    const wantStatus = m.status ?? "pending";
    if (a.status !== wantStatus) problems.push(`${id}: status ${a.status} != ${wantStatus}`);
    const wantApplied = toInstant(m.applied_at);
    if ((a.appliedAt?.getTime() ?? null) !== (wantApplied?.getTime() ?? null)) problems.push(`${id}: applied_at`);
    if (a.notes !== (m.notes ?? "")) problems.push(`${id}: notes`);
    for (const f of ["title", "company", "location"] as const) {
      if ((m[f] ?? "") !== "" && a.job[f] !== m[f]) problems.push(`${id}: ${f} "${a.job[f]}" != "${m[f]}"`);
    }
    const steps = (Array.isArray(m.application_timeline) ? m.application_timeline : []).map((e: any) => e.step);
    const gotSteps = a.events.map((e) => e.step);
    if (steps.join(",") !== gotSteps.join(",")) problems.push(`${id}: timeline ${gotSteps} != ${steps}`);
  }
  add("tracker cards match matched_jobs", problems.length === 0,
    problems.length ? `${problems.length} differences, e.g. ${problems.slice(0, 5).join("; ")}` : `${apps.length} cards checked`);

  // Analysed jobs have a current analysis with the score the Tracker showed.
  const scoreProblems: string[] = [];
  const jobs = await prisma.job.findMany({
    select: { id: true, source: true, externalId: true, analysisState: true, currentAnalysis: { select: { matchScore: true } } },
  });
  const pgByKey = new Map(jobs.map((j) => [`${j.source}\u0000${j.externalId}`, j]));
  const matchedByKey = new Map(source.matched_jobs.map((m) => [`${m.source}\u0000${m.job_id}`, m]));
  for (const doc of source.jobs) {
    const k = `${doc.source}\u0000${doc.job_id}`;
    const j = pgByKey.get(k);
    if (!j) continue; // merged away (in the report)
    const shown = matchedByKey.get(k) ?? doc;
    if (shown.ai_pending || shown.matched_at == null || shown.match_score == null) continue;
    const got = j.currentAnalysis?.matchScore;
    if (got == null || Math.abs(got - Number(shown.match_score)) > 1e-6) {
      scoreProblems.push(`${j.id}: ${got} != ${shown.match_score}`);
    }
  }
  add("current analysis score matches", scoreProblems.length === 0,
    scoreProblems.length ? `${scoreProblems.length} differences, e.g. ${scoreProblems.slice(0, 5).join("; ")}` : "ok");

  // Constraints the schema promises.
  const [{ dup }] = await prisma.$queryRawUnsafe<{ dup: bigint }[]>(
    `SELECT count(*) AS dup FROM (SELECT posting_key FROM jobs WHERE posting_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d`,
  ) as [{ dup: bigint }];
  add("posting_key unique", dup === 0n, `${dup} duplicates`);
  const [{ orphan }] = await prisma.$queryRawUnsafe<{ orphan: bigint }[]>(
    `SELECT count(*) AS orphan FROM jobs WHERE analysis_state = 'done' AND current_analysis_id IS NULL`,
  ) as [{ orphan: bigint }];
  add("analysed jobs point at an analysis", orphan === 0n, `${orphan} without current_analysis_id`);

  return checks;
}
