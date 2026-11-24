import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@tracker/db/client";
import { setDescription } from "@/server/tracker-writes";

function prismaFor(card: {
  jobId: string;
  job: { title: string; company: string; manualFields: string[] };
} | null) {
  const jobUpdates: unknown[] = [];
  const tx = {
    application: {
      findUnique: async () => card,
      update: async () => ({}),
    },
    job: { update: async (args: unknown) => { jobUpdates.push(args); } },
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { prisma: prisma as unknown as PrismaClient, jobUpdates };
}

const CARD = {
  jobId: "job-1",
  job: { title: "Backend Engineer", company: "Acme", manualFields: ["title"] },
};

describe("setDescription", () => {
  it("rejects a non-string body", async () => {
    const { prisma } = prismaFor(CARD);
    const out = await setDescription(prisma, "aaaaaaaaaaaaaaaaaaaaaaaa", { description: 12 });
    expect(out.status).toBe(400);
    expect(String(out.body.error)).toMatch(/string/);
  });

  it("saves text and marks description as a manual field", async () => {
    const { prisma, jobUpdates } = prismaFor(CARD);
    const pasted = "Pasted from the company-page modal. We build backends in Node.js. ";
    const out = await setDescription(prisma, "aaaaaaaaaaaaaaaaaaaaaaaa", { description: pasted });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, description: pasted });
    const data = (jobUpdates[0] as { data: Record<string, unknown> }).data;
    expect(data.description).toBe(pasted);
    expect(data.manualFields).toEqual(["title", "description"]);
    expect(data.descriptionEmpty).toBe(false);
  });

  it("clears the manual flag when the paste is empty", async () => {
    const { prisma, jobUpdates } = prismaFor({
      jobId: "job-1",
      job: { title: "Backend Engineer", company: "Acme", manualFields: ["description", "company"] },
    });
    const out = await setDescription(prisma, "aaaaaaaaaaaaaaaaaaaaaaaa", { description: "" });
    expect(out.status).toBe(200);
    const data = (jobUpdates[0] as { data: Record<string, unknown> }).data;
    expect(data.description).toBe("");
    expect(data.manualFields).toEqual(["company"]);
    expect(data.descriptionEmpty).toBe(true);
  });

  it("404s when the card is gone", async () => {
    const { prisma } = prismaFor(null);
    const out = await setDescription(prisma, "aaaaaaaaaaaaaaaaaaaaaaaa", { description: "x" });
    expect(out.status).toBe(404);
  });
});
