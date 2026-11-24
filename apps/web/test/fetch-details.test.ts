import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@tracker/db/client";
import {
  FETCH_DETAILS_LOCAL_ONLY, cardUrl, fetchDetailsForCard, keepManualDescription, keepManualIdentity,
  parseScraperOutput,
} from "@/server/fetch-details";

describe("parseScraperOutput", () => {
  it("reads the last JSON line", () => {
    const out = parseScraperOutput('noise\n{"ok":true,"job":{"title":"T","company":"C","location":"L","description":"D","applicants":"12","link":"https://x"}}');
    expect(out).toEqual({
      ok: true,
      job: { title: "T", company: "C", location: "L", description: "D", applicants: "12", link: "https://x" },
    });
  });

  it("reads a scraper error", () => {
    expect(parseScraperOutput('{"ok":false,"error":"page timeout"}')).toEqual({ ok: false, error: "page timeout" });
  });

  it("returns null for empty or non-JSON stdout", () => {
    expect(parseScraperOutput("")).toBeNull();
    expect(parseScraperOutput("Traceback (most recent call last)")).toBeNull();
  });
});

describe("cardUrl", () => {
  it("rebuilds a LinkedIn / Indeed URL from the job id when the stored link is empty", () => {
    expect(cardUrl({ link: "", source: "linkedin", externalId: "4100000001" }))
      .toBe("https://www.linkedin.com/jobs/view/4100000001/");
    expect(cardUrl({ link: "", source: "indeed", externalId: "jk1" }))
      .toBe("https://de.indeed.com/viewjob?jk=jk1");
  });

  it("keeps an http(s) stored link", () => {
    expect(cardUrl({ link: "https://jobs.ashbyhq.com/acme/1", source: "ats", externalId: "1" }))
      .toBe("https://jobs.ashbyhq.com/acme/1");
  });

  it("does not pass javascript: or data: URLs to the scraper", () => {
    expect(cardUrl({ link: "javascript:alert(1)", source: "ats", externalId: "x" })).toBe("");
    expect(cardUrl({ link: "data:text/html,hi", source: "ats", externalId: "x" })).toBe("");
    expect(cardUrl({ link: "//evil.example/jobs", source: "ats", externalId: "x" })).toBe("");
  });
});

describe("keepManualIdentity", () => {
  const scraped = { title: "Scraped Title", company: "Scraped Co", location: "Hamburg", description: "", applicants: "", link: "" };

  it("keeps user-typed fields", () => {
    expect(keepManualIdentity(scraped, {
      title: "My Title", company: "My Co", location: "Leipzig", manualFields: ["title", "company"],
    })).toEqual({ title: "My Title", company: "My Co", location: "Hamburg" });
  });

  it("keeps a real stored value when the scrape is blank", () => {
    expect(keepManualIdentity(
      { ...scraped, title: "", company: "", location: "" },
      { title: "Backend Engineer", company: "Acme", location: "Berlin", manualFields: [] },
    )).toEqual({ title: "Backend Engineer", company: "Acme", location: "Berlin" });
  });

  it("does not keep a (Link only) title as identity", () => {
    expect(keepManualIdentity(
      { ...scraped, title: "Fetched" },
      { title: "(Link only) linkedin", company: "", location: "", manualFields: [] },
    ).title).toBe("Fetched");
  });
});

describe("keepManualDescription", () => {
  it("keeps a user-pasted JD", () => {
    expect(keepManualDescription("Scraped teaser", {
      description: "Pasted from the modal",
      manualFields: ["description"],
    })).toBe("Pasted from the modal");
  });

  it("lets the scrape through when the paste is empty or unmarked", () => {
    expect(keepManualDescription("Scraped", {
      description: "   ",
      manualFields: ["description"],
    })).toBe("Scraped");
    expect(keepManualDescription("Scraped", {
      description: "Pasted from the modal",
      manualFields: ["title"],
    })).toBe("Scraped");
  });
});

function prismaFor(card: {
  id: string;
  recommendedBy?: string | null;
  job: {
    id: string; source: string; externalId: string; link: string; title: string; company: string;
    location: string; description: string; manualFields: string[];
    detailsFetchedAt: Date | null; linkReplacedAt: Date | null;
  };
}) {
  const updates: unknown[] = [];
  const prisma = {
    application: { findUnique: async () => card },
    job: { update: async (args: unknown) => { updates.push(args); } },
  };
  return { prisma: prisma as unknown as PrismaClient, updates };
}

const linkOnlyJob = {
  id: "job-1", source: "linkedin", externalId: "4100000001",
  link: "https://www.linkedin.com/jobs/view/4100000001/",
  title: "(Link only) linkedin", company: "", location: "", description: "",
  manualFields: [] as string[], detailsFetchedAt: null, linkReplacedAt: null,
};

const scraped = {
  title: "E2E Fetched Backend Engineer", company: "E2E Fetched GmbH",
  location: "Hamburg, Germany", description: "We build backends. ".repeat(20),
  applicants: "12 applicants", link: "https://www.linkedin.com/jobs/view/4100000001/",
};

describe("fetchDetailsForCard", () => {
  const vercel = process.env.VERCEL;
  afterEach(() => {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  });

  it("answers 503 on Vercel unless a scraper is passed in", async () => {
    process.env.VERCEL = "1";
    const { prisma } = prismaFor({ id: "app-1", job: linkOnlyJob });
    const blocked = await fetchDetailsForCard(prisma, "app-1");
    expect(blocked).toEqual({ status: 503, body: { ok: false, error: FETCH_DETAILS_LOCAL_ONLY } });

    const ok = await fetchDetailsForCard(prisma, "app-1", {
      scrape: async () => ({ ok: true, job: scraped }), llm: null,
    });
    expect(ok.status).toBe(200);
  });

  it("refuses a javascript: stored link instead of handing it to the scraper", async () => {
    const { prisma, updates } = prismaFor({
      id: "app-1",
      job: { ...linkOnlyJob, source: "ats", link: "javascript:alert(1)", externalId: "x" },
    });
    let scrapedUrl = "";
    const out = await fetchDetailsForCard(prisma, "app-1", {
      scrape: async (url) => { scrapedUrl = url; return { ok: true, job: scraped }; },
      llm: null,
    });
    expect(out).toEqual({ status: 400, body: { ok: false, error: "No job link" } });
    expect(scrapedUrl).toBe("");
    expect(updates).toHaveLength(0);
  });

  it("404s when the card is gone", async () => {
    const prisma = { application: { findUnique: async () => null } } as unknown as PrismaClient;
    const out = await fetchDetailsForCard(prisma, "missing", { scrape: async () => ({ ok: true, job: scraped }), llm: null });
    expect(out.status).toBe(404);
  });

  it("refuses a card that already has details", async () => {
    const { prisma } = prismaFor({
      id: "app-1",
      job: { ...linkOnlyJob, title: "Backend Engineer", description: "A full JD. ".repeat(20), detailsFetchedAt: new Date() },
    });
    const out = await fetchDetailsForCard(prisma, "app-1", { scrape: async () => ({ ok: true, job: scraped }), llm: null });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/already has job details/i);
  });

  it("saves scrape fields and does not write status or timeline", async () => {
    const { prisma, updates } = prismaFor({ id: "app-1", recommendedBy: null, job: linkOnlyJob });
    const out = await fetchDetailsForCard(prisma, "app-1", {
      scrape: async () => ({ ok: true, job: scraped }), llm: null,
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      ok: true, title: scraped.title, company: scraped.company, location: scraped.location,
    });
    expect(updates).toHaveLength(1);
    const data = (updates[0] as { data: Record<string, unknown> }).data;
    expect(data.title).toBe(scraped.title);
    expect(data.description).toContain("We build backends");
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("appliedAt");
    expect(data).not.toHaveProperty("recommendedBy");
  });

  it("keeps a user-pasted description over the scrape", async () => {
    const pasted = "User pasted the modal JD. We build backends in Node.js. ".repeat(8);
    const { prisma, updates } = prismaFor({
      id: "app-1",
      recommendedBy: "claude",
      job: {
        ...linkOnlyJob,
        title: "Backend Engineer",
        company: "Acme",
        description: pasted,
        manualFields: ["description"],
        detailsFetchedAt: new Date("2026-10-01"),
      },
    });
    const out = await fetchDetailsForCard(prisma, "app-1", {
      scrape: async () => ({ ok: true, job: scraped }), llm: null,
    });
    expect(out.status).toBe(200);
    const data = (updates[0] as { data: Record<string, unknown> }).data;
    expect(data.description).toBe(pasted);
  });

  it("returns the scraper error as 502 and does not write", async () => {
    const { prisma, updates } = prismaFor({ id: "app-1", job: linkOnlyJob });
    const out = await fetchDetailsForCard(prisma, "app-1", {
      scrape: async () => ({ ok: false, error: "E2E fake scrape failure" }), llm: null,
    });
    expect(out).toEqual({ status: 502, body: { ok: false, error: "E2E fake scrape failure" } });
    expect(updates).toHaveLength(0);
  });
});
