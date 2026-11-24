/**
 * Pure helpers for the matcher Telegram line (no database).
 */
import { describe, expect, it } from "vitest";
import { formatMatchOutcomeLine, mergeMatchSummaries, type MatchSummary } from "../src/match.js";

const base: Pick<MatchSummary, "matched" | "alreadyOnTracker" | "belowThreshold" | "stale" | "blocked" | "failed"> = {
  matched: 2, alreadyOnTracker: 0, belowThreshold: 0, stale: 0, blocked: 0, failed: 0,
};

describe("formatMatchOutcomeLine", () => {
  it("always reports new cards and only appends non-zero skip buckets", () => {
    expect(formatMatchOutcomeLine(base)).toBe("🎯 Matcher: 2 new on Tracker");
    expect(formatMatchOutcomeLine({ ...base, alreadyOnTracker: 1, belowThreshold: 3 })).toBe(
      "🎯 Matcher: 2 new on Tracker · 1 already stored · 3 below cut-off",
    );
  });
});

describe("mergeMatchSummaries", () => {
  it("sums per-source summaries for the API Telegram header", () => {
    const a = {
      ...base, found: 1, analysed: 1, matched: 1, matchedCardIds: ["a"], gates: { scored: 1 }, stoppedReason: null,
    } as MatchSummary;
    const b = {
      ...base, found: 2, analysed: 2, matched: 0, alreadyOnTracker: 1, belowThreshold: 1,
      matchedCardIds: [], gates: { scored: 1, non_english: 1 }, stoppedReason: null,
    } as MatchSummary;
    expect(mergeMatchSummaries([a, b])).toMatchObject({
      found: 3, analysed: 3, matched: 1, alreadyOnTracker: 1, belowThreshold: 1, matchedCardIds: ["a"],
      gates: { scored: 2, non_english: 1 },
    });
  });
});
