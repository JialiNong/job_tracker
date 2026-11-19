/**
 * evaluate() end to end on recorded model answers: the requests sent to
 * OpenAI (model, prompt, schema, tools) and the result must equal what the
 * Python matcher sent and produced for the same job (matching_cases.json "flow").
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompanyCache, type LlmClient, evaluate, modelSettings, toAnalysis } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases: any = JSON.parse(readFileSync(resolve(here, "../../../tests/contract/matching_cases.json"), "utf8"));
const CV = "Frontend developer, 4 years React and TypeScript, some Node.js. Based in Leipzig.";
const RULES = "Hard fail when German is mandatory. Prefer product companies.";

function fakeClient(answers: any[]) {
  const queue = [...answers];
  const calls: unknown[] = [];
  const client = {
    responses: {
      create: async (params: unknown) => {
        calls.push(params);
        const answer = queue.shift();
        if (answer?.__error__) throw new Error(answer.__error__);
        return { output_text: JSON.stringify(answer), usage: { input_tokens: 120, output_tokens: 30 } };
      },
    },
  } as unknown as LlmClient;
  return { client, calls };
}

function memoryCache(): CompanyCache {
  const store = new Map<string, Record<string, unknown>>();
  return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
}

describe("evaluate on recorded answers", () => {
  it.each<[number, any]>(cases.flow.map((c: any, i: number) => [i, c]))("flow %i", async (_i: number, c: any) => {
    const { client, calls } = fakeClient(c.answers);
    const result = await evaluate(c.job, {
      client, cv: CV, rules: RULES, settings: modelSettings({}), companyCache: memoryCache(),
    });
    expect(calls).toEqual(c.calls);
    expect(result).toEqual(c.result);
    expect(toAnalysis(result, 7)).toEqual(c.analysis);
  });

  it("serves a cached company profile without a second web search", async () => {
    const c = cases.flow[0];
    const cache = memoryCache();
    const first = fakeClient(c.answers);
    await evaluate(c.job, { client: first.client, cv: CV, rules: RULES, settings: modelSettings({}), companyCache: cache });
    const second = fakeClient([c.answers[0]]);
    const again = await evaluate(c.job, { client: second.client, cv: CV, rules: RULES, settings: modelSettings({}), companyCache: cache });
    expect(second.calls).toHaveLength(1); // layer 1 only
    expect(again.score).toBe(c.result.score);
  });
});
