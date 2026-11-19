/**
 * The TypeScript rules against the Python answers in
 * tests/contract/rule_cases.json (regenerate with
 * `python3 tests/contract/build_rule_cases.py`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  COUNTRY_LABELS, applicationProgress, canFetchDetails, chipStatusCounts, companyHistoryItem,
  formatBerlin, hydrateTimeline, inferOrigin, jobCountry, jobMissingDetails, matchesStatusFilter,
  normalizeLink, reachedInterview, serializeJob, statusFromTimeline, toInstant,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(resolve(here, "../../../tests/contract/rule_cases.json"), "utf8"));
const consumer: string[] = JSON.parse(
  readFileSync(resolve(here, "../../../tests/contract/consumer_fields.json"), "utf8"),
).job;

beforeAll(() => {
  process.env.TRACKER_ALLOW_FIXED_NOW = "1";
  process.env.TRACKER_FIXED_NOW = cases.now;
});

const wall = (v: unknown) => formatBerlin(toInstant(v));
/** Python output cut to what the frontend reads, nulls dropped (like the contract runner). */
function consumerView(obj: Record<string, unknown>, extra: string[] = []) {
  const keep = new Set([...consumer, ...extra]);
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => keep.has(k) && v != null));
}

describe("status rules", () => {
  it.each<[number, any]>(cases.jobs.map((c: any, i: number) => [i, c]))("job case %i", (_i, c) => {
    const job = c.input;
    if (c.status_from_timeline !== null) {
      expect(statusFromTimeline(job.application_timeline, job.status || "pending")).toBe(c.status_from_timeline);
    }
    expect(applicationProgress(job)).toBe(c.progress);
    expect(reachedInterview(job)).toBe(c.reached_interview);
    for (const f of cases.filters) expect([f, matchesStatusFilter(job, f)]).toEqual([f, c.filters[f]]);
    expect(hydrateTimeline(job).map((e) => [e.step, wall(e.at)]))
      .toEqual(c.hydrated.map((e: any) => [e.step, wall(e.at)]));
  });

  it("chip counts", () => {
    expect(chipStatusCounts(cases.jobs.map((c: any) => c.input))).toEqual(cases.chips);
  });
});

describe("country", () => {
  it("labels", () => expect(COUNTRY_LABELS).toEqual(cases.country_labels));
  it.each<[string, string | null, string]>(cases.countries.map((c: any) => [c.location, c.stored, c.country]))(
    "%j (stored %j) -> %s", (location, stored, country) => {
      expect(jobCountry(location, stored)).toBe(country);
    },
  );
});

describe("links, details, origin", () => {
  it.each<[any, string]>(cases.links.map((c: any) => [c.input, c.link]))("%j", (input, link) => {
    expect(normalizeLink(input)).toBe(link);
  });
  it.each<[any, boolean, boolean]>(cases.details.map((c: any) => [c.input, c.missing, c.can_fetch]))("%j", (input, missing, canFetch) => {
    expect(jobMissingDetails(input)).toBe(missing);
    expect(canFetchDetails(input)).toBe(canFetch);
  });
  it.each<[any, string]>(cases.origins.map((c: any) => [c.input, c.origin]))("%j", (input, origin) => {
    expect(inferOrigin(input)).toBe(origin);
  });
});

describe("serialization", () => {
  it.each<[string, any]>(cases.serialized.map((c: any) => [c.input.title, c]))("%s", (_t, c) => {
    const { description: _d, ...input } = c.input;
    const ours = consumerView(serializeJob(input), ["country", "country_label"]);
    const theirs = consumerView(c.output, ["country", "country_label"]);
    delete theirs.company_history; delete theirs.company_history_total; // attached by the route
    expect(ours).toEqual(theirs);
  });

  it.each<[string, any]>(cases.history.map((c: any) => [c.input.title, c]))("history item %s", (_t, c) => {
    expect(companyHistoryItem(c.input)).toEqual(c.output);
  });
});
