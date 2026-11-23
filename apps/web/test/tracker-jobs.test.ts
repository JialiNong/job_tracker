import { describe, expect, it } from "vitest";
import { filtersFromParams, matchesFilters, sortNewestFirst, type LightCard } from "@/server/tracker-jobs";

const card = (patch: Partial<LightCard> = {}): LightCard => ({
  _id: "a",
  status: "pending",
  origin: "pipeline",
  applied_at: null,
  updated_at: new Date("2026-11-23T10:00:00Z"),
  matched_at: new Date("2026-11-23T10:00:00Z"),
  application_timeline: [],
  title: "Backend Engineer",
  company: "Acme",
  location: "Berlin, Germany",
  source: "linkedin",
  country: "germany",
  highlights: [],
  applicant_position: null,
  ...patch,
});

const params = (q: string) => filtersFromParams(new URLSearchParams(q));

describe("filtersFromParams", () => {
  it("reads the list query the toolbar sends", () => {
    const f = params("status=active&country=germany&origin=agent&source=indeed&q=node&company=Acme&company=Globex&highlights=true&applied_on=2026-11-20&date_from=2026-11-01&date_to=2026-11-23");
    expect(f.status).toBe("active");
    expect(f.country).toBe("germany");
    expect(f.origin).toBe("agent");
    expect(f.source).toBe("indeed");
    expect(f.q).toBe("node");
    expect(f.companies).toEqual(["Acme", "Globex"]);
    expect(f.highlightsOnly).toBe(true);
    expect(f.appliedOn).toBe("2026-11-20");
    expect(f.dateFrom).toBe("2026-11-01");
    expect(f.dateTo).toBe("2026-11-23");
  });

  it("treats a junk origin as empty (show every origin)", () => {
    expect(params("origin=nope").origin).toBe("");
  });
});

describe("matchesFilters", () => {
  const berlin = card();
  const amsterdam = card({ _id: "b", location: "Amsterdam, Netherlands", country: "netherlands", company: "Globex" });
  const applied = card({
    _id: "c", status: "applied", title: "Node.js Developer",
    applied_at: new Date("2026-11-20T12:00:00Z"),
    application_timeline: [{ step: "applied", at: new Date("2026-11-20T12:00:00Z") }],
  });

  it("status=active hides side statuses and keeps applied", () => {
    const f = params("status=active");
    expect(matchesFilters(berlin, f)).toBe(true);
    expect(matchesFilters(applied, f)).toBe(true);
    expect(matchesFilters(card({ status: "unsuitable" }), f)).toBe(false);
  });

  it("source / origin / company / search", () => {
    expect(matchesFilters(berlin, params("source=indeed"))).toBe(false);
    expect(matchesFilters(berlin, params("source=linkedin"))).toBe(true);
    expect(matchesFilters(berlin, params("origin=manual"))).toBe(false);
    expect(matchesFilters(berlin, params("origin=pipeline"))).toBe(true);
    expect(matchesFilters(berlin, params("company=globex"))).toBe(false);
    expect(matchesFilters(berlin, params("company=acme"))).toBe(true);
    expect(matchesFilters(berlin, params("q=Acme"))).toBe(true);
    expect(matchesFilters(berlin, params("q=zzzz"))).toBe(false);
    expect(() => matchesFilters(berlin, params("q=c++"))).not.toThrow();
  });

  it("Region=Europe excludes Germany", () => {
    expect(matchesFilters(berlin, params("country=europe"))).toBe(false);
    expect(matchesFilters(amsterdam, params("country=europe"))).toBe(true);
    expect(matchesFilters(berlin, params("country=germany"))).toBe(true);
  });

  it("highlights-only and applied-on", () => {
    expect(matchesFilters(berlin, params("highlights=true"))).toBe(false);
    expect(matchesFilters(card({ highlights: ["Leipzig"] }), params("highlights=true"))).toBe(true);
    expect(matchesFilters(applied, params("applied_on=2026-11-20"))).toBe(true);
    expect(matchesFilters(berlin, params("applied_on=2026-11-20"))).toBe(false);
  });
});

describe("sortNewestFirst", () => {
  it("puts the newest matched_at first", () => {
    const older = card({ _id: "old", matched_at: new Date("2026-11-01T00:00:00Z") });
    const newer = card({ _id: "new", matched_at: new Date("2026-11-23T00:00:00Z") });
    expect(sortNewestFirst([older, newer]).map((c) => c._id)).toEqual(["new", "old"]);
  });
});
