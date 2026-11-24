import { describe, expect, it } from "vitest";
import { transform, type MongoSource } from "../src/transform.js";

const oid = (n: number) => ({ $oid: n.toString(16).padStart(24, "0") });
const id = (n: number) => n.toString(16).padStart(24, "0");
const naive = (iso: string) => new Date(`${iso}Z`);

function source(partial: Partial<MongoSource>): MongoSource {
  return {
    jobs: [], matched_jobs: [], timeout_jobs: [], scraper_stats: [], company_profiles: [], stats_cache: [],
    ...partial,
  };
}

const scraped = (n: number, extra: Record<string, unknown> = {}) => ({
  _id: oid(n), source: "linkedin", job_id: `41${n}`, title: "Frontend Engineer", company: "Acme GmbH",
  location: "Berlin", link: `https://www.linkedin.com/jobs/view/41${n}/`, description: "JD",
  created_at: naive("2026-11-01T08:00:00"), ...extra,
});

const analysis = { matched_at: naive("2026-11-01T09:00:00"), match_score: 8, summary: "Good fit", match_reasons: ["React"] };

describe("jobs + matched_jobs -> jobs + applications (D1)", () => {
  it("the Tracker copy wins and the edited identity fields become manual_fields", () => {
    const { rows, report } = transform(source({
      jobs: [scraped(1, analysis)],
      matched_jobs: [{
        ...scraped(1), ...analysis, _id: oid(101), company: "Acme", location: "Berlin, Germany",
        status: "applied", origin: "pipeline", applied_at: naive("2026-11-02T10:00:00"),
        application_timeline: [{ step: "applied", at: naive("2026-11-02T10:00:00") }],
      }],
    }));
    expect(rows.jobs).toHaveLength(1);
    expect(rows.jobs[0]).toMatchObject({ id: id(1), company: "Acme", location: "Berlin, Germany", title: "Frontend Engineer" });
    expect(rows.jobs[0]!.manualFields).toEqual(["company", "location"]);
    expect(rows.applications[0]).toMatchObject({ id: id(101), jobId: id(1), status: "applied" });
    expect(rows.applicationEvents).toHaveLength(1);
    expect(report.twinConflicts.map((c) => c.field).sort()).toEqual(["company", "location"]);
    expect(report.appliedAtMismatch).toEqual([]);
  });

  it("keeps a user-pasted description flag in manual_fields", () => {
    const { rows } = transform(source({
      jobs: [scraped(1, { manual_fields: ["description"] })],
      matched_jobs: [{
        ...scraped(1), ...analysis, _id: oid(101), manual_fields: ["description"],
        status: "pending", origin: "pipeline",
      }],
    }));
    expect(rows.jobs[0]!.manualFields).toContain("description");
  });

  it("keeps the analysed document when one (source, job_id) was scraped twice", () => {
    const { rows, report } = transform(source({
      jobs: [scraped(2, { created_at: naive("2026-11-01T08:00:06") }), { ...scraped(3, analysis), job_id: "412" }],
    }));
    expect(rows.jobs.map((j) => j.id)).toEqual([id(3)]);
    expect(report.duplicateKeysMerged).toEqual([{ key: "linkedin:412", kept: id(3), dropped: [id(2)] }]);
  });
});

describe("AI runs (D2, D7, D13)", () => {
  it("an analysed job gets one run and points at it", () => {
    const { rows } = transform(source({ jobs: [scraped(4, analysis)] }));
    expect(rows.jobs[0]!.analysisState).toBe("done");
    expect(rows.jobAnalyses[0]).toMatchObject({ jobId: id(4), matchScore: 8, trigger: "migration" });
    expect(rows.jobAnalyses[0]!.details).toEqual({ match_reasons: ["React"] });
    expect(rows.currentAnalysis).toEqual([{ jobId: id(4), analysisId: 1n }]);
  });

  it("keeps a later pipeline run on the scraped copy as history; the card shows its own", () => {
    const { rows, report } = transform(source({
      jobs: [scraped(14, { matched_at: naive("2026-11-18T19:33:00"), match_score: 5.3, summary: "Re-run" })],
      matched_jobs: [{ ...scraped(14), ...analysis, _id: oid(114), status: "rejected" }],
    }));
    expect(rows.jobAnalyses.map((a) => a.matchScore)).toEqual([8, 5.3]);
    expect(rows.currentAnalysis).toEqual([{ jobId: id(14), analysisId: 1n }]);
    expect(report.extraAnalysisRuns).toEqual([
      { job: id(14), shown: 8, alsoKept: 5.3, keptAt: "2026-11-18T18:33:00.000Z" },
    ]);
  });

  it("link-only (ai_pending) has no run yet; never analysed is 'none'", () => {
    const { rows } = transform(source({
      jobs: [scraped(5, { matched_at: naive("2026-11-01T09:00:00"), ai_pending: true, match_score: 0 }), scraped(6)],
    }));
    expect(rows.jobs.map((j) => j.analysisState)).toEqual(["pending", "none"]);
    expect(rows.jobAnalyses).toEqual([]);
  });

  it("references the profile under the name the pipeline saw, not the edited one", () => {
    const profile = { business: "Hosts job ads", product_type: "marketplace" };
    const { rows } = transform(source({
      company_profiles: [{ _id: "karriere bei indeed", ...profile }],
      jobs: [scraped(7, { ...analysis, company: "Karriere bei Indeed", company_profile: profile })],
      matched_jobs: [{ ...scraped(7), ...analysis, _id: oid(107), company: "ContractHero GmbH", company_profile: profile, status: "pending" }],
    }));
    expect(rows.jobAnalyses[0]!.companyKey).toBe("karriere bei indeed");
    expect(rows.jobs[0]!.company).toBe("ContractHero GmbH");
  });

  it("recreates a missing profile from the snapshot", () => {
    const { rows, report } = transform(source({
      jobs: [scraped(8, { ...analysis, company: "Bluefin GmbH", company_profile: { business: "Boats" } })],
    }));
    expect(rows.jobAnalyses[0]!.companyKey).toBe("bluefin");
    expect(rows.companyProfiles).toEqual([expect.objectContaining({ key: "bluefin", business: "Boats" })]);
    expect(report.profilesRecreated).toEqual([{ key: "bluefin", from: id(8) }]);
  });

  it("a card named by hand after scraping uses the cached profile under that name, not overwrite it", () => {
    const cached = { business: "Recruiter (cached)", is_recruiter_for_other_company: true };
    const { rows, report } = transform(source({
      company_profiles: [{ _id: "code compass", ...cached }],
      jobs: [scraped(11, { ...analysis, company: "", company_profile: { business: "Recruiter (snapshot)" } })],
      matched_jobs: [{
        ...scraped(11), ...analysis, _id: oid(111), company: "Code Compass",
        company_profile: { business: "Recruiter (snapshot)" }, status: "applied",
      }],
    }));
    expect(rows.jobAnalyses[0]!.companyKey).toBe("code compass");
    expect(rows.companyProfiles).toEqual([expect.objectContaining({ key: "code compass", business: "Recruiter (cached)" })]);
    expect(report.profilesRecreated).toEqual([]);
  });

  it("a 'Can Apply' card keeps the labels, gate and profile only the posting stored (same run)", () => {
    const profile = { business: "Snacks", product_type: "b2c_ecommerce_marketplace" };
    const labels = { role_type: "fullstack_balanced" };
    const { rows } = transform(source({
      company_profiles: [{ _id: "acme", ...profile }],
      jobs: [scraped(9, { ...analysis, match_gate: "scored", job_labels: labels, company_profile: profile })],
      matched_jobs: [{
        ...scraped(9), ...analysis, _id: oid(109), matched_at: naive("2026-11-03T10:00:00"),
        status: "applied", from_unmatched: true,
      }],
    }));
    expect(rows.jobAnalyses).toHaveLength(1);
    expect(rows.jobAnalyses[0]).toMatchObject({ matchGate: "scored", companyKey: "acme" });
    expect(rows.jobAnalyses[0]!.details).toMatchObject({ job_labels: labels });
  });

  it("a card from a different run does not borrow the posting's fields", () => {
    const { rows } = transform(source({
      jobs: [scraped(10, { ...analysis, match_score: 5, summary: "Rerun", job_labels: { role_type: "backend" } })],
      matched_jobs: [{ ...scraped(10), ...analysis, _id: oid(110), status: "pending" }],
    }));
    const shown = rows.jobAnalyses.find((a) => a.matchScore === 8)!;
    expect(shown.details).not.toHaveProperty("job_labels");
  });
});

describe("posting_key is unique (D8)", () => {
  const pk = "personio:acme:42";

  it("drops the card the user marked duplicate", () => {
    const { rows, report } = transform(source({
      jobs: [
        scraped(9, { source: "manual", job_id: "m1", posting_key: pk }),
        scraped(10, { source: "ats", job_id: pk, posting_key: pk, created_at: naive("2026-11-05T08:00:00") }),
      ],
      matched_jobs: [
        { ...scraped(9), source: "manual", job_id: "m1", posting_key: pk, _id: oid(109), status: "applied" },
        { ...scraped(10), source: "ats", job_id: pk, posting_key: pk, _id: oid(110), status: "duplicate" },
      ],
    }));
    expect(rows.jobs.map((j) => j.id)).toEqual([id(9)]);
    expect(rows.applications.map((a) => a.id)).toEqual([id(109)]);
    expect(report.postingKeyMerged[0]!.dropped[0]).toMatchObject({ job: id(10), application: id(110), status: "duplicate" });
  });

  it("never drops a real application: clears the shared key instead", () => {
    const { rows, report } = transform(source({
      jobs: [
        scraped(11, { source: "manual", job_id: "m2", posting_key: pk }),
        scraped(12, { source: "ats", job_id: pk, posting_key: pk }),
      ],
      matched_jobs: [
        { ...scraped(11), source: "manual", job_id: "m2", posting_key: pk, _id: oid(111), status: "applied" },
        { ...scraped(12), source: "ats", job_id: pk, posting_key: pk, _id: oid(112), status: "rejected", notes: "Second try" },
      ],
    }));
    expect(rows.applications).toHaveLength(2);
    expect(rows.jobs.filter((j) => j.postingKey === pk)).toHaveLength(1);
    expect(report.postingKeyCleared).toHaveLength(1);
  });
});

describe("vocabulary and bookkeeping", () => {
  it("unknown statuses and steps are reported, not silently kept", () => {
    const { rows, report } = transform(source({
      jobs: [scraped(13)],
      matched_jobs: [{
        ...scraped(13), _id: oid(113), status: "hired",
        application_timeline: [{ step: "ghosted", at: naive("2026-11-02T10:00:00") }],
      }],
    }));
    expect(rows.applications[0]!.status).toBe("pending");
    expect(rows.applicationEvents).toEqual([]);
    expect(report.unknownValues.map((u) => u.where)).toEqual(["matched_jobs.status", "application_timeline"]);
  });

  it("splits scraper_stats into daily rows and the totals row", () => {
    const { rows } = transform(source({
      scraper_stats: [
        { _id: "global", title_passed_clicked: 640, german_filtered: 410 },
        { _id: "daily_2026-11-13", date: "2026-11-13", title_passed_clicked: 22, german_filtered: 14 },
      ],
    }));
    expect(rows.scraperTotals).toEqual([expect.objectContaining({ id: 1, titlePassedClicked: 640 })]);
    expect((rows.scraperDailyStats[0]!.day as Date).toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });
});
