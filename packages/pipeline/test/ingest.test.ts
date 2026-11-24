/**
 * ingest() on the local test database (tracker_test): every funnel outcome,
 * the saved row, dry runs and the Overview counters. The AI title check runs
 * on a fake client.
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@tracker/db/client";
import type { LlmClient } from "@tracker/matching";
import { ingest } from "../src/ingest.js";
import type { SourceJob } from "../src/sources/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const url = process.env.DATABASE_URL ?? "";
if (!url.split("?")[0]!.endsWith("_test")) throw new Error("pipeline tests only run on a *_test database");

const EN = "We are looking for a frontend engineer to build our customer dashboard with React and TypeScript. ".repeat(5);
const DE = "Wir suchen einen Frontend-Entwickler für unser Kundenportal mit React und TypeScript. ".repeat(5);

/** Fake chat client: titles containing "Simulation" are unrelated. */
function titleClient() {
  const asked: string[] = [];
  const client = {
    chat: {
      completions: {
        create: async (p: { messages: { content: string }[] }) => {
          const title = /Job title: (.*)/.exec(p.messages[1]!.content)?.[1] ?? "";
          asked.push(title);
          return { choices: [{ message: { content: JSON.stringify({ relevant: !title.includes("Simulation"), reason: "fake" }) } }] };
        },
      },
    },
  } as unknown as LlmClient;
  return { client, asked };
}

let n = 0;
const listing = (title: string, extra: Partial<SourceJob> = {}): SourceJob => {
  n += 1;
  return {
    source: "arbeitnow", jobId: `ingest-test-${n}`, title, company: `Company ${n}`, location: "Berlin",
    link: `https://www.arbeitnow.com/jobs/ingest-test-${n}`, description: `<p>${title} at Company ${n}. ${EN}</p>`,
    postedAt: new Date(), ...extra,
  };
};

const totals = async () => (await prisma.scraperTotals.findUnique({ where: { id: 1 } })) ?? { titlePassedClicked: 0, germanFiltered: 0, aiTitleFiltered: 0 };

beforeEach(() => {
  execSync("pnpm --silent db contract:seed", { cwd: root, env: { ...process.env, DIRECT_DATABASE_URL: url }, stdio: "ignore" });
});

describe("ingest", () => {
  it("sorts every listing into one outcome and saves the survivors", async () => {
    const existing = await prisma.job.findFirstOrThrow({ where: { application: { isNot: null } }, select: { title: true, company: true, source: true } });
    const saved = listing("Frontend Engineer", { postedAt: new Date(), remote: true, extra: { tags: ["React"], jobTypes: ["full time"] } });
    const jobs = [
      saved,
      { ...saved }, // same source + id again
      listing("Frontend Engineer", { company: saved.company }), // same company + title in this run
      listing("Old Frontend Engineer", { postedAt: new Date(Date.now() - 200 * 86_400_000) }),
      listing("Frontend Engineer", { location: "Austin, Texas", locationPolicy: "strict", source: "ats" }),
      listing("Software Engineer", {
        location: "Hybrid",
        link: "https://www.arbeitnow.fr/jobs/companies/automation-consultants-ltd/software-engineer-hybrid-281608",
      }),
      listing("Senior Java Developer"),
      listing("Office Assistant"), // off-topic for a keyword-less feed
      listing("Simulation Software Engineer"), // AI title check: unrelated
      listing("Frontend Entwickler", { description: `<p>Frontend Entwickler. ${DE}</p>` }),
      listing(existing.title, { company: existing.company, source: "ats" }), // already on the Tracker from another board
      listing("Web Developer", { title: "" }),
    ];
    const before = await totals();
    const { client, asked } = titleClient();
    const stats = await ingest(prisma, jobs, { requireOnTopicTitle: true, client, titleModel: "fake", runId: "run-1", log: () => {} });

    expect(stats).toMatchObject({
      listed: 12, saved: 1, repeat_in_run: 2, too_old: 1, not_germany: 2, title_excluded: 1, off_topic: 1,
      ai_title_filtered: 1, german_filtered: 1, invalid: 1,
    });
    expect((stats.known ?? 0) + (stats.cross_source_duplicate ?? 0)).toBe(1);
    expect(asked).toEqual(expect.arrayContaining(["Simulation Software Engineer"]));
    expect(asked).not.toContain("Frontend Engineer"); // auto-pass keyword: no AI call

    const row = await prisma.job.findFirstOrThrow({ where: { externalId: saved.jobId } });
    expect(row).toMatchObject({
      source: "arbeitnow", title: "Frontend Engineer", location: "Berlin", remote: true, runId: "run-1",
      dedupKey: `${saved.jobId.split("-").pop()}|frontend engineer`, // "company" is a legal suffix, dropped tags: ["React"], jobTypes: ["full time"],
      descriptionQuality: "ok", descriptionEmpty: false, analysisState: "none",
    });
    expect(row.description.startsWith("Frontend Engineer at")).toBe(true); // HTML stripped
    expect(row.id).toMatch(/^[0-9a-f]{24}$/);

    const after = await totals();
    expect(after.titlePassedClicked - before.titlePassedClicked).toBe(2); // saved + the German one
    expect(after.germanFiltered - before.germanFiltered).toBe(1);
    expect(after.aiTitleFiltered - before.aiTitleFiltered).toBe(1);
  });

  it("a stored posting is known on the next run; a dry run writes nothing", async () => {
    const job = listing("Product Engineer");
    await ingest(prisma, [job], { client: null, titleModel: "fake", log: () => {} });
    const again = await ingest(prisma, [job], { client: null, titleModel: "fake", log: () => {} });
    expect(again.known).toBe(1);

    const before = await totals();
    const count = await prisma.job.count();
    const dry = await ingest(prisma, [listing("Forward Deployed Engineer")], { dryRun: true, client: null, titleModel: "fake", log: () => {} });
    expect(dry.would_save).toBe(1);
    expect(await prisma.job.count()).toBe(count);
    expect((await totals()).titlePassedClicked).toBe(before.titlePassedClicked);
  });

  it("fetches the JD only after the free filters, and saves an empty JD when the fetch fails", async () => {
    let fetched = 0;
    const lazy = listing("Frontend Engineer", { description: "", fetchDescription: async () => { fetched += 1; throw new Error("down"); } });
    const excluded = listing("Lead Frontend Engineer", { description: "", fetchDescription: async () => { fetched += 1; return EN; } });
    const stats = await ingest(prisma, [lazy, excluded], { client: null, titleModel: "fake", log: () => {} });
    expect(fetched).toBe(1);
    expect(stats.saved).toBe(1);
    const row = await prisma.job.findFirstOrThrow({ where: { externalId: lazy.jobId } });
    expect(row).toMatchObject({ description: "", descriptionEmpty: true, descriptionQuality: "empty" });
  });
});
