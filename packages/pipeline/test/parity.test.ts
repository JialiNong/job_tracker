/**
 * The pipeline's pure parts against the Python answers in
 * tests/contract/pipeline_cases.json (regenerate with
 * `TZ=Europe/Berlin PYTHONPATH=src python3 tests/contract/build_pipeline_cases.py`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMatchMessages, formatJobBlock, normalizeJobLink } from "../src/digest.js";
import { dedupKey, normalizeCompany, normalizeTitle } from "../src/dedup.js";
import { isGermanyOrRemoteStrict } from "../src/location.js";
import { toSourceJob as adzunaJob } from "../src/sources/adzuna.js";
import { toSourceJob as arbeitnowJob } from "../src/sources/arbeitnow.js";
import { publishedSinceParam, toSourceJob as arbeitsagenturJob } from "../src/sources/arbeitsagentur.js";
import { PROVIDERS, joinParts } from "../src/sources/ats.js";
import type { SourceJob } from "../src/sources/types.js";
import { isApiTitleExcluded, isOnTopicTitle, isTitleExcluded, titleMatchesAutoPass } from "../src/title-gate.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases: any = JSON.parse(readFileSync(resolve(here, "../../../tests/contract/pipeline_cases.json"), "utf8"));
const each = (list: any[]) => list.map((c, i) => [i, c] as [number, any]);

/** A SourceJob in the shape the Python side recorded. */
const shape = (j: SourceJob) => ({
  source: j.source, jobId: j.jobId, title: j.title, company: j.company, location: j.location, link: j.link,
  description: j.description ?? "", postedAt: j.postedAt ? j.postedAt.toISOString().replace(/\.\d{3}Z$/, "Z") : null,
  remote: !!j.remote, extra: j.extra ?? {}, locationPolicy: j.locationPolicy ?? "lenient",
});

afterEach(() => vi.unstubAllGlobals());

describe("title gates", () => {
  it.each(each(cases.titles))("title %i", (_i, c) => {
    expect({
      excluded: isTitleExcluded(c.title), api_excluded: isApiTitleExcluded(c.title),
      on_topic: isOnTopicTitle(c.title), auto_pass: titleMatchesAutoPass(c.title),
    }, c.title).toEqual({ excluded: c.excluded, api_excluded: c.api_excluded, on_topic: c.on_topic, auto_pass: c.auto_pass });
  });
});

describe("cross-source dedup and location", () => {
  it.each(each(cases.dedup))("dedup %i", (_i, c) => {
    expect([normalizeCompany(c.company), normalizeTitle(c.title), dedupKey(c.title, c.company)]).toEqual([c.company_norm, c.title_norm, c.key]);
  });
  it.each(each(cases.strict_location))("strict location %i", (_i, c) => expect(isGermanyOrRemoteStrict(c.location), c.location).toBe(c.ok));
});

describe("source payloads -> jobs", () => {
  it.each(each(cases.arbeitnow))("arbeitnow %i", (_i, c) => expect(shape(arbeitnowJob(c.item))).toEqual(c.job));
  it.each(each(cases.arbeitsagentur))("arbeitsagentur %i", (_i, c) => {
    const { fetchDescription: _f, ...job } = arbeitsagenturJob(c.item);
    expect(shape(job)).toEqual(c.job);
  });
  it.each(each(cases.published_since))("published_since %i", (_i, c) => expect(publishedSinceParam(c.days)).toBe(c.param));
  it.each(each(cases.adzuna))("adzuna %i", (_i, c) => expect({ ...shape(adzunaJob(c.item)), description: "" }).toEqual(c.job));
  it.each(each(cases.ats))("ats %i", async (_i, c) => {
    const body = typeof c.payload === "string" ? c.payload : JSON.stringify(c.payload);
    vi.stubGlobal("fetch", async () => new Response(body, { status: 200 }));
    const jobs = await PROVIDERS[c.provider]!(c.entry);
    expect(jobs.map(shape)).toEqual(c.jobs);
  });
  it.each(each(cases.ats_join))("ats join %i", (_i, c) => expect(joinParts(...c.parts)).toBe(c.out));
});

describe("Telegram digest", () => {
  it.each(each(cases.digest_links))("link %i", (_i, c) => expect(normalizeJobLink(c.job)).toBe(c.link));
  it.each(each(cases.digest_blocks))("block %i", (_i, c) => expect(formatJobBlock(c.index, c.job)).toBe(c.block));
  it.each(each(cases.digest_messages))("messages %i", (_i, c) => expect(buildMatchMessages(c.jobs, c.label)).toEqual(c.messages));
});
