/**
 * URL parsing and the PATCH /status + /timeline rules against the Python
 * answers in tests/contract/rule_cases.json.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  canonicalJobLink, canonicalizeUrl, detectSource, extractIndeedJkFromUrl, formatBerlin, isHttpUrl,
  normalizePastedJobUrl, normalizeTimeline, postingKey, replacementLinkFields, resolveJobId,
  statusUpdate, timelineUpdate, toInstant,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(resolve(here, "../../../tests/contract/rule_cases.json"), "utf8"));
const noNetwork = (() => { throw new Error("no network in tests"); }) as unknown as typeof fetch;

beforeAll(() => {
  process.env.TRACKER_ALLOW_FIXED_NOW = "1";
  process.env.TRACKER_FIXED_NOW = cases.now;
});

describe("job URLs", () => {
  it.each<[string, any]>(cases.urls.map((c: any) => [JSON.stringify(c.input), c]))("%s", async (_name, c) => {
    expect(normalizePastedJobUrl(c.input)).toBe(c.normalized);
    expect(isHttpUrl(c.input)).toBe(c.is_http);
    expect(detectSource(c.input)).toBe(c.source);
    if (c.normalized) {
      expect(canonicalizeUrl(c.input)).toBe(c.canonical);
      expect(canonicalJobLink(c.normalized)).toBe(c.link);
    }
    expect(postingKey(c.input)).toBe(c.posting_key);
    expect(resolveJobId(c.input)).toBe(c.job_id);
    expect(extractIndeedJkFromUrl(c.input)).toBe(c.jk);
    const { fields, error } = await replacementLinkFields(c.input, noNetwork);
    expect(fields).toEqual(c.replacement);
    expect(error).toBe(c.replacement_error);
  });
});

/** Python returns naive wall-clock datetimes; compare as Berlin "YYYY-MM-DD HH:MM". */
const wall = (v: unknown) => (v == null ? v : formatBerlin(toInstant(v)));

describe("PATCH /status and /timeline rules", () => {
  const now = () => toInstant(cases.now)!;

  it.each<[string, string, any]>(
    cases.timeline_updates.map((c: any) => [`${c.kind} ${c.job}`, c.payload, c]),
  )("%s <- %s", (_n, _p, c) => {
    const want = c.output;
    const got = c.kind === "status"
      ? statusUpdate(c.input_job, c.input_payload, now())
      : timelineUpdate(c.input_job, normalizeTimeline(c.input_payload, now()));
    expect(got.status).toBe(want.status);
    if ("applied_at" in want) expect(wall(got.appliedAt)).toBe(wall(want.applied_at));
    else expect(got.appliedAt).toBeUndefined();
    if ("applicant_position" in want) expect(got.applicantPosition).toBeNull();
    if ("application_timeline" in want) {
      expect((got.events ?? []).map((e) => [e.step, wall(e.at)]))
        .toEqual(want.application_timeline.map((e: any) => [e.step, wall(e.at)]));
    } else {
      expect(got.events).toBeUndefined();
    }
  });
});
