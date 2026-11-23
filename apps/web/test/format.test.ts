import { describe, expect, it } from "vitest";
import {
  formatApplicants, groupByDay, groupHeading, jobChannel, needsAi, needsLinkFix,
  presetRange, safeUrl, scoreClass, scoreLabel,
} from "@/lib/tracker/format";
import type { Job } from "@/lib/tracker/types";

const job = (patch: Partial<Job>): Job => patch as Job;

describe("safeUrl", () => {
  it("keeps http(s) and same-site paths", () => {
    expect(safeUrl("https://www.linkedin.com/jobs/view/1/")).toContain("linkedin.com");
    expect(safeUrl("/jobs/1")).toBe("/jobs/1");
  });

  it("rejects javascript: and garbage", () => {
    expect(safeUrl("javascript://%0Aalert(1)")).toBe("#");
    expect(safeUrl("not a url")).toBe("#");
    expect(safeUrl("")).toBe("#");
  });
});

describe("needsLinkFix", () => {
  it("flags Indeed short links", () => {
    expect(needsLinkFix("https://to.indeed.com/abc")).toBe(true);
    expect(needsLinkFix("https://de.indeed.com/viewjob?jk=abc")).toBe(false);
  });
});

describe("needsAi / score", () => {
  it("needs AI when pending, unscored, or missing a summary", () => {
    expect(needsAi(job({ ai_pending: true, match_score: 8, summary: "ok" }))).toBe(true);
    expect(needsAi(job({ ai_pending: false, match_score: null, summary: "ok" }))).toBe(true);
    expect(needsAi(job({ ai_pending: false, match_score: 8, summary: "" }))).toBe(true);
    expect(needsAi(job({ ai_pending: false, match_score: 8, summary: "ok" }))).toBe(false);
  });

  it("labels scores", () => {
    expect(scoreLabel(null)).toBe("—");
    expect(scoreLabel(8)).toBe("8");
    expect(scoreLabel(7.5)).toBe("7.5");
    expect(scoreClass(null)).toBe("score-pending");
    expect(scoreClass(8)).toBe("score-hi");
    expect(scoreClass(6)).toBe("score-mid");
    expect(scoreClass(3)).toBe("score-lo");
  });
});

describe("formatApplicants", () => {
  it("shortens LinkedIn / Indeed applicant lines", () => {
    expect(formatApplicants("Be among the first 25 applicants")).toBe("first 25");
    expect(formatApplicants("Over 200 applicants")).toBe("200+ applicants");
    expect(formatApplicants("47 applicants")).toBe("47 applicants");
    expect(formatApplicants("")).toBe("");
  });
});

describe("presetRange", () => {
  const now = new Date(2026, 10, 23); // 23 Nov 2026, local

  it("all time has no bounds; custom keeps the typed dates", () => {
    expect(presetRange("all", "2026-01-01", "2026-01-31", now)).toEqual({ from: "", to: "" });
    expect(presetRange("custom", "2026-01-01", "2026-01-31", now))
      .toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("today / last N days are inclusive of today", () => {
    expect(presetRange("today", "", "", now)).toEqual({ from: "2026-11-23", to: "2026-11-23" });
    expect(presetRange("7", "", "", now)).toEqual({ from: "2026-11-17", to: "2026-11-23" });
  });
});

describe("groupByDay / groupHeading", () => {
  it("groups in list order and names today / yesterday", () => {
    const groups = groupByDay([
      job({ _id: "1", matched_at: "2026-11-23 10:00" }),
      job({ _id: "2", matched_at: "2026-11-23 09:00" }),
      job({ _id: "3", matched_at: "2026-11-22 18:00" }),
    ]);
    expect(groups.map(([day, jobs]) => [day, jobs.map((j) => j._id)])).toEqual([
      ["2026-11-23", ["1", "2"]],
      ["2026-11-22", ["3"]],
    ]);
    const now = new Date(2026, 10, 23);
    expect(groupHeading("2026-11-23", now)).toBe("Today · 2026-11-23");
    expect(groupHeading("2026-11-22", now)).toBe("Yesterday · 2026-11-22");
  });
});

describe("jobChannel", () => {
  it("prefers the agent tag, then API source, then origin", () => {
    expect(jobChannel({ recommended_by: "cursor", source: "linkedin", origin: "agent" })?.label).toBe("Cursor");
    expect(jobChannel({ recommended_by: "", source: "ats", origin: "api" })?.label).toBe("ATS");
    expect(jobChannel({ recommended_by: "", source: "linkedin", origin: "pipeline" })?.label).toBe("Scraper");
    expect(jobChannel({ recommended_by: "", source: "manual", origin: "manual" })?.label).toBe("Log job");
  });
});
