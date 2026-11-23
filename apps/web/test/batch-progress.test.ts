import { describe, expect, it } from "vitest";
import { batchModeLabel, batchRowText, type BatchRow } from "@/components/tracker/useRunAi";

const row = (patch: Partial<BatchRow>): BatchRow => ({
  ok: true, error: null, match_score: null, id: "1", label: "Backend Engineer", ...patch,
});

describe("batch progress copy", () => {
  it("names the two batch modes", () => {
    expect(batchModeLabel("ai")).toBe("Run AI");
    expect(batchModeLabel("fetch")).toBe("Fetch details");
  });

  it("shows a score and stored-JD note on success", () => {
    expect(batchRowText(row({ title: "Backend Engineer", match_score: 8.0, used_stored_jd: true })))
      .toBe("✓ Backend Engineer · 8/10 · stored JD");
  });

  it("quotes a hard-fail gate", () => {
    expect(batchRowText(row({ title: "Java Engineer", match_gate: "german" })))
      .toBe("✓ Java Engineer — stopped at German required, not scored");
  });

  it("shows the error on failure", () => {
    expect(batchRowText(row({ ok: false, error: "E2E fake scrape failure", title: "" })))
      .toBe("✗ Backend Engineer — E2E fake scrape failure");
  });
});
