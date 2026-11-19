/** Overview / Stacks rules against the Python answers in tests/contract/rule_cases.json. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSankey, buildStackStats, buildWeeklyByPlatform, classifyFlowSink, formatBerlin, isGermanyOrRemote,
  normalizeAppliedLocation, reappliedCount, resolveAppliedAt, toInstant,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(resolve(here, "../../../tests/contract/rule_cases.json"), "utf8"));

describe("applied location", () => {
  it.each<[string, string, boolean]>(cases.applied_locations.map((c: any) => [c.raw, c.name, c.germany_or_remote]))(
    "%j -> %s", (raw, name, onChart) => {
      expect(normalizeAppliedLocation(raw)).toBe(name);
      expect(isGermanyOrRemote(raw)).toBe(onChart);
    },
  );
});

describe("flow", () => {
  const now = toInstant(cases.flow.now)!;
  it.each<[number, any]>(cases.flow.jobs.map((c: any, i: number) => [i, c]))("job %i", (_i, c) => {
    expect(classifyFlowSink(c.input, now)).toBe(c.sink);
    const applied = resolveAppliedAt(c.input);
    expect(applied ? formatBerlin(applied) : null).toBe(c.applied_at ? formatBerlin(toInstant(c.applied_at)) : null);
    expect(reappliedCount(c.input)).toBe(c.reapplied);
  });
  it("sankey", () => expect(buildSankey(cases.flow.jobs.map((c: any) => c.input), now)).toEqual(cases.flow.sankey));
  it("weekly", () => expect(buildWeeklyByPlatform(cases.flow.jobs.map((c: any) => c.input), now)).toEqual(cases.flow.weekly));
});

describe("stacks", () => {
  it("matches build_stack_stats", () => {
    expect(buildStackStats(cases.stacks.jobs, toInstant(cases.stacks.now)!)).toEqual(cases.stacks.output);
  });
});
