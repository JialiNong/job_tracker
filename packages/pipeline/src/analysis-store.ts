/**
 * Where AI results go in Postgres, shared by Run AI (apps/web) and the
 * pipeline matcher: company profiles as the matcher's cache, and one
 * job_analyses row per run with the posting pointing at the latest
 * (docs/pg-schema.md D2, D4, D13).
 */
import { companyKey, now as clockNow } from "@tracker/core";
import type { Prisma, PrismaClient } from "@tracker/db/client";
import type { Analysis, CompanyCache } from "@tracker/matching";

/** company_profiles as the matcher's cache, keyed by companyKey(). */
export function prismaCompanyCache(prisma: PrismaClient): CompanyCache {
  return {
    async get(key) {
      const p = await prisma.companyProfile.findUnique({ where: { key } });
      return p && {
        business: p.business, product_type: p.productType, vertical: p.vertical, markets: p.markets,
        markets_detail: p.marketsDetail, is_recruiter_for_other_company: p.isRecruiterForOtherCompany, sources: p.sources,
      };
    },
    async set(key, profile) {
      const text = (v: unknown) => (typeof v === "string" ? v : "");
      const fields = {
        business: text(profile.business), productType: text(profile.product_type), vertical: text(profile.vertical),
        markets: text(profile.markets), marketsDetail: text(profile.markets_detail),
        isRecruiterForOtherCompany: profile.is_recruiter_for_other_company === true,
        sources: (Array.isArray(profile.sources) ? profile.sources : []) as Prisma.InputJsonValue,
        model: typeof profile._model === "string" ? profile._model : null,
        usage: (profile._usage ?? null) as Prisma.InputJsonValue,
        cachedAt: clockNow(),
      };
      await prisma.companyProfile.upsert({ where: { key }, create: { key, ...fields }, update: fields });
    },
  };
}

/** The company_profiles key a run used, or null when it looked no company up. */
export const profileKeyOf = (analysis: Analysis, company: string) =>
  Object.keys(analysis.company_profile).length ? companyKey(company) || null : null;

export interface SaveAnalysisInput {
  jobId: string;
  analysis: Analysis;
  model: string;
  trigger: "run_ai" | "pipeline";
  profileKey: string | null;
  state?: "done" | "failed";
  /** Identity fields to write with it (a filled-in title, a cleaned location). */
  jobFields?: { title?: string; company?: string; location?: string };
}

/** One job_analyses row (columns + details, same split as the migration) and the posting pointed at it. */
export async function saveAnalysis(db: PrismaClient | Prisma.TransactionClient, input: SaveAnalysisInput) {
  const { analysis } = input;
  const now = clockNow();
  const row = await db.jobAnalysis.create({
    data: {
      jobId: input.jobId, trigger: input.trigger, model: input.model, analyzedAt: now,
      matchScore: analysis.match_score, matchGate: analysis.match_gate, recommendation: analysis.recommendation,
      summary: analysis.summary, disqualificationReason: analysis.disqualification_reason,
      details: {
        match_reasons: analysis.match_reasons, missing_requirements: analysis.missing_requirements,
        red_flags: analysis.red_flags, nice_to_have_matches: analysis.nice_to_have_matches,
        what_youll_do: analysis.what_youll_do, what_theyre_looking_for: analysis.what_theyre_looking_for,
        special_match: analysis.special_match, special_match_reasons: analysis.special_match_reasons,
        job_labels: analysis.job_labels,
      } as Prisma.InputJsonValue,
      companyKey: input.profileKey,
    },
    select: { id: true },
  });
  await db.job.update({
    where: { id: input.jobId },
    data: {
      ...input.jobFields, currentAnalysisId: row.id, analysisState: input.state ?? "done", analysisStartedAt: null,
      needsRefetch: analysis.needs_refetch, updatedAt: now,
    },
  });
  return row.id;
}
