/**
 * matchNewJobs on the local test database (tracker_test, `pnpm db:up`) with
 * a fake OpenAI client. Each test seeds the contract fixture first, then adds
 * the new postings it needs.
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@tracker/db/client";
import { type LlmClient, modelSettings } from "@tracker/matching";
import { matchNewJobs, newRecordId } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const url = process.env.DATABASE_URL ?? "";
if (!url.split("?")[0]!.endsWith("_test")) throw new Error("pipeline tests only run on a *_test database");

const EN = "We are looking for a frontend engineer to build our customer dashboard with React and TypeScript. ".repeat(6);
const DE = "Wir suchen einen Frontend-Entwickler für unser Kundenportal mit React und TypeScript. ".repeat(6);
const LABELS = {
  description_usable: true, hard_fail: false, hard_fail_kind: "none", hard_fail_evidence: "", german_required: false,
  german_evidence: "", role_type: "frontend", stack_fit: "strong", seniority: "mid", backend_language_ask: "none",
  ai_product_work: false, english_team: "true", stack: "React", stack_matched: ["React"], stack_missing: [],
  summary: "Fake summary", watch_outs: "none",
};
const COMPANY = {
  business: "Fake business", product_type: "b2b_saas", vertical: "x", markets: "europe", markets_detail: "",
  is_recruiter_for_other_company: false, sources: [],
};

/** Labels by job title; "boom" fails, "credits" runs out of credits. */
function fakeClient(byTitle: Record<string, object | "boom" | "credits">) {
  const calls: string[] = [];
  const client = {
    responses: {
      create: async (params: { input: string; tools?: unknown }) => {
        if (params.tools) return { output_text: JSON.stringify(COMPANY), usage: {} };
        const title = /Title: (.*)/.exec(params.input)?.[1] ?? "";
        calls.push(title);
        const answer = byTitle[title] ?? LABELS;
        if (answer === "boom") throw new Error("boom");
        if (answer === "credits") throw new Error("429 insufficient_quota");
        return { output_text: JSON.stringify(answer), usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  } as unknown as LlmClient;
  return { client, calls };
}

async function addPosting(title: string, extra: Record<string, unknown> = {}) {
  const id = newRecordId();
  await prisma.job.create({
    data: {
      id, source: "linkedin", externalId: `match-test-${id}`, title, company: "Acme", location: "·",
      link: `https://www.linkedin.com/jobs/view/${id}/`, description: `${title} at Acme. ${EN}`, updatedAt: new Date(),
      ...extra,
    },
  });
  return id;
}

const run = (client: LlmClient, extra: object = {}) =>
  matchNewJobs(prisma, { client, cv: "CV", rules: "Rules", settings: modelSettings({}), threshold: 7, log: () => {}, ...extra });

const state = (id: string) => prisma.job.findUniqueOrThrow({
  where: { id },
  select: { analysisState: true, location: true, application: true, currentAnalysis: true },
});

beforeEach(() => {
  execSync("pnpm --silent db contract:seed", { cwd: root, env: { ...process.env, DIRECT_DATABASE_URL: url }, stdio: "ignore" });
});

describe("matchNewJobs", () => {
  it("puts a match on the Tracker, keeps a weak one on Unmatched, and skips analysed jobs", async () => {
    const seeded = await prisma.job.count({ where: { analysisState: "none" } }); // fixture postings never analysed
    const strong = await addPosting("Strong Frontend Engineer");
    const weak = await addPosting("Weak Backend Engineer");
    const before = await prisma.jobAnalysis.count();
    const { client, calls } = fakeClient({ "Weak Backend Engineer": { ...LABELS, role_type: "backend", stack_fit: "weak" } });
    const summary = await run(client);

    expect(calls).toEqual(expect.arrayContaining(["Strong Frontend Engineer", "Weak Backend Engineer"]));
    expect(summary).toMatchObject({ found: seeded + 2, failed: 0, stoppedReason: null });
    expect(await prisma.jobAnalysis.count()).toBe(before + seeded + 2);
    // Analysed postings (state done / pending) are never picked up again
    expect(await prisma.job.count({ where: { analysisState: "none" } })).toBe(0);

    const s = await state(strong);
    expect(s.analysisState).toBe("done");
    expect(s.location).toBe(""); // a separator is never a location
    expect(s.application).toMatchObject({ status: "pending", origin: "pipeline" });
    expect(s.currentAnalysis).toMatchObject({ matchGate: "scored", trigger: "pipeline", companyKey: "acme" });
    expect(s.currentAnalysis!.matchScore).toBeGreaterThanOrEqual(7);

    const w = await state(weak);
    expect(w.application).toBeNull();
    expect(w.currentAnalysis!.matchScore).toBeLessThan(7);
  });

  it("stores a failed call as score_failed and stops when credits run out", async () => {
    const failing = await addPosting("Failing Job", { scrapedAt: new Date(Date.now() - 1000) });
    const broke = await addPosting("Credits Job", { scrapedAt: new Date(Date.now() - 2000) });
    const waiting = await addPosting("Waiting Job", { scrapedAt: new Date(Date.now() - 3000) });
    const { client } = fakeClient({ "Failing Job": "boom", "Credits Job": "credits" });
    const summary = await run(client);

    expect(summary.failed).toBe(1);
    expect(summary.stoppedReason).toMatch(/no credits/);
    const f = await state(failing);
    expect(f.analysisState).toBe("failed");
    expect(f.currentAnalysis).toMatchObject({ matchScore: 0, matchGate: "score_failed" });
    expect((await state(broke)).analysisState).toBe("none");
    expect((await state(waiting)).analysisState).toBe("none"); // waits for the next run
  });

  it("gates a German JD before any model call and never puts a blocked company on the Tracker", async () => {
    const german = await addPosting("Frontend Entwickler", { description: `Frontend Entwickler bei Acme. ${DE}` });
    const blocked = await addPosting("Blocked Frontend Engineer", { company: "Jobgether" });
    const { client, calls } = fakeClient({});
    await run(client);

    // German: stopped before any call. Blocked company: layer 1 runs, the score is a hard fail (as in Python)
    expect(calls).not.toContain("Frontend Entwickler");
    expect(calls).toContain("Blocked Frontend Engineer");
    const g = await state(german);
    expect(g.currentAnalysis).toMatchObject({ matchGate: "non_english", matchScore: 0 });
    const b = await state(blocked);
    expect(b.application).toBeNull();
    expect(b.currentAnalysis).toMatchObject({ matchGate: "blocked_company" });
  });

  it("only takes the requested source and limit", async () => {
    await addPosting("One");
    await addPosting("Two");
    await addPosting("Indeed Job", { source: "indeed" });
    const { client, calls } = fakeClient({});
    const summary = await run(client, { source: "indeed", limit: 1 });
    expect(summary.found).toBe(1);
    expect(calls).toEqual(["Indeed Job"]);
  });
});
