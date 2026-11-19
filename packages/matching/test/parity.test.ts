/**
 * The matcher's pure parts against the Python answers in
 * tests/contract/matching_cases.json (regenerate with
 * `PYTHONPATH=src python3 tests/contract/build_matching_cases.py`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { companyKey } from "@tracker/core";
import { describe, expect, it } from "vitest";
import {
  assessJobDescription, detectJobDetailLanguage, gateOf, germanContentShare, groundStackLabels,
  isBlockedMatchCompany, isNonEnglishJobDetail, scoreJob, scrubBulletLocation, stackTermInText, stripHtml, toAnalysis,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cases: any = JSON.parse(readFileSync(resolve(here, "../../../tests/contract/matching_cases.json"), "utf8"));
const indexed = (list: unknown[]) => list.map((c, i) => [i, c] as [number, any]);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("text and JD quality", () => {
  it.each(indexed(cases.strip_html))("strip_html %i", (_i, c) => expect(stripHtml(c.input)).toBe(c.output));
  it.each(indexed(cases.quality))("assess_job_description %i", (_i, c) =>
    expect(assessJobDescription(c.input.text, c.input.title, c.input.company)).toEqual(c.output));
  it.each(indexed(cases.scrub_location))("scrub_bullet_location %i", (_i, c) =>
    expect(scrubBulletLocation(c.input)).toBe(c.output));
});

describe("English-only gate (Lingua)", () => {
  it.each(indexed(cases.language))("language %i", (_i, c) => {
    expect(germanContentShare(c.text)).toBeCloseTo(c.german_share, 12);
    const [lang, share] = detectJobDetailLanguage(c.text);
    expect(lang).toBe(c.detect[0]);
    expect(share).toBeCloseTo(c.detect[1], 12);
    const [skip, lang2] = isNonEnglishJobDetail(c.text);
    expect([skip, lang2]).toEqual([c.skip, c.lang]);
  });
});

describe("stack grounding", () => {
  it.each(indexed(cases.stack_terms))("stack_term_in_text %i", (_i, c) =>
    expect(stackTermInText(c.term, c.text), `${c.term} in ${JSON.stringify(c.text)}`).toBe(c.output));
  it.each(indexed(cases.grounding))("ground_stack_labels %i", (_i, c) => {
    const labels = clone(c.labels);
    groundStackLabels(labels, c.text);
    expect(labels).toEqual(c.output);
  });
});

describe("scoring and the stored analysis", () => {
  it.each(indexed(cases.score))("score_job %i", (_i, c) =>
    expect(scoreJob(c.job, c.labels === null ? null : clone(c.labels), c.company)).toEqual(c.output));
  it.each(indexed(cases.gate))("gate %i", (_i, c) => expect(gateOf(c.parts)).toBe(c.output));
  it.each(indexed(cases.analysis))("to_analysis %i", (_i, c) => expect(toAnalysis(c.result, c.threshold)).toEqual(c.output));
  it.each(indexed(cases.company_key))("company_key %i", (_i, c) => expect(companyKey(c.input)).toBe(c.output));
  it.each(indexed(cases.blocked))("blocked company %i", (_i, c) => expect(isBlockedMatchCompany(c.input)).toBe(c.output));
});
