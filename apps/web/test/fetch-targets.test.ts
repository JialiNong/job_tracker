/**
 * GET /api/fetch-details/ids — "Select missing details" / "Select missing AI".
 * Must include Applied link-only stubs that have no agent tag (the Flask
 * batch path used to skip those).
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@tracker/db/client";
import { fetchDetailTargets } from "@/server/fetch-targets";

interface RowOpts {
  title?: string;
  status?: string;
  origin?: string;
  location?: string;
  country?: string | null;
  source?: string;
  company?: string;
  recommendedBy?: string | null;
  analysisState?: string;
  detailsFetchedAt?: Date | null;
  matchScore?: number | null;
  summary?: string;
  addedAt?: Date;
  appliedAt?: Date | null;
}

function row(id: string, opts: RowOpts = {}) {
  const addedAt = opts.addedAt ?? new Date("2026-11-23T10:00:00Z");
  const analysisState = opts.analysisState ?? "done";
  const hasAnalysis = opts.matchScore != null || (opts.summary != null && opts.summary !== "");
  return {
    id,
    status: opts.status ?? "pending",
    origin: opts.origin ?? "pipeline",
    appliedAt: opts.appliedAt ?? null,
    addedAt,
    updatedAt: addedAt,
    country: opts.country ?? "germany",
    highlights: [] as string[],
    applicantPosition: null,
    events: opts.appliedAt ? [{ step: "applied", at: opts.appliedAt }] : [],
    recommendedBy: opts.recommendedBy ?? null,
    job: {
      title: opts.title ?? "Backend Engineer",
      company: opts.company ?? "Acme",
      location: opts.location ?? "Berlin, Germany",
      source: opts.source ?? "linkedin",
      analysisState,
      detailsFetchedAt: opts.detailsFetchedAt === undefined ? new Date("2026-11-22T00:00:00Z") : opts.detailsFetchedAt,
      currentAnalysis: hasAnalysis
        ? { matchScore: opts.matchScore ?? null, summary: opts.summary ?? "" }
        : analysisState === "pending" ? null : { matchScore: opts.matchScore ?? 8, summary: opts.summary ?? "ok" },
    },
  };
}

function prismaWith(rows: ReturnType<typeof row>[]) {
  return {
    application: {
      findMany: async ({ where }: { where?: { id?: { in: string[] } } }) => {
        if (where?.id?.in) return rows.filter((r) => where.id.in.includes(r.id));
        return rows;
      },
    },
  } as unknown as PrismaClient;
}

const APPLIED = "65f000000000000000000002";
const PENDING = "65f000000000000000000001";
const FULL = "65f000000000000000000003";

const appliedLinkOnly = row(APPLIED, {
  title: "(Link only) linkedin",
  status: "applied",
  recommendedBy: null,
  analysisState: "pending",
  detailsFetchedAt: null,
  matchScore: null,
  summary: "",
  appliedAt: new Date("2026-11-20T12:00:00Z"),
});
const pendingLinkOnly = row(PENDING, {
  title: "(Link only) Indeed job",
  recommendedBy: null,
  analysisState: "pending",
  detailsFetchedAt: null,
  matchScore: null,
  summary: "",
});
const fullCard = row(FULL, {
  title: "Platform Engineer",
  analysisState: "done",
  matchScore: 8,
  summary: "Good fit",
});

describe("fetchDetailTargets missing=1 (Select missing details)", () => {
  it("includes Applied link-only stubs that have no recommended_by", async () => {
    const out = await fetchDetailTargets(
      prismaWith([appliedLinkOnly, pendingLinkOnly, fullCard]),
      new URLSearchParams("missing=1&status=active&country=germany"),
    );
    expect(out.ids).toEqual(expect.arrayContaining([APPLIED, PENDING]));
    expect(out.ids).not.toContain(FULL);
    expect(out.jobs.find((j) => j.id === APPLIED)?.details_missing).toBe(true);
  });

  it("excludes an Applied card that already has details", async () => {
    const appliedFull = row("applied-full", {
      title: "Node.js Developer", status: "applied",
      analysisState: "done", matchScore: 8, summary: "ok",
      appliedAt: new Date("2026-11-20T12:00:00Z"),
    });
    const out = await fetchDetailTargets(
      prismaWith([appliedFull, appliedLinkOnly]),
      new URLSearchParams("missing=1&status=active&country=germany"),
    );
    expect(out.ids).toEqual([APPLIED]);
  });

  it("does not require an agent tag", async () => {
    const tagged = row("agent-1", {
      title: "(Link only) linkedin", recommendedBy: "cursor",
      analysisState: "pending", detailsFetchedAt: null, matchScore: null, summary: "",
    });
    const untagged = row("old-1", {
      title: "(Link only) linkedin", recommendedBy: null,
      analysisState: "pending", detailsFetchedAt: null, matchScore: null, summary: "",
    });
    const out = await fetchDetailTargets(
      prismaWith([tagged, untagged]),
      new URLSearchParams("missing=1"),
    );
    expect(out.ids).toEqual(expect.arrayContaining(["agent-1", "old-1"]));
  });

  it("respects the current list filters (Indeed hides LinkedIn stubs)", async () => {
    const out = await fetchDetailTargets(
      prismaWith([appliedLinkOnly]),
      new URLSearchParams("missing=1&source=indeed&status=active&country=germany"),
    );
    expect(out.ids).toEqual([]);
  });

  it("keeps Applied cards when the toolbar is on Active (the Jobs default)", async () => {
    const out = await fetchDetailTargets(
      prismaWith([appliedLinkOnly]),
      new URLSearchParams("missing=1&status=active&country=germany"),
    );
    expect(out.ids).toEqual([APPLIED]);
  });
});

describe("fetchDetailTargets missing_ai=1 (Select missing AI result)", () => {
  it("selects cards with no score / pending analysis, not ones that already have a result", async () => {
    const out = await fetchDetailTargets(
      prismaWith([appliedLinkOnly, fullCard]),
      new URLSearchParams("missing_ai=1&status=active&country=germany"),
    );
    expect(out.ids).toEqual([APPLIED]);
  });
});

describe("fetchDetailTargets without missing= (legacy: missing details or agent-tagged)", () => {
  it("includes an agent-tagged card even after details exist", async () => {
    const agentFull = row("agent-full", {
      title: "Backend Engineer", recommendedBy: "cursor",
      analysisState: "done", matchScore: 8, summary: "ok",
    });
    const out = await fetchDetailTargets(prismaWith([agentFull, fullCard]), new URLSearchParams());
    expect(out.ids).toEqual(["agent-full"]);
  });
});
