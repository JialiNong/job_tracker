import { describe, expect, it } from "vitest";
import {
  activityLevel, activityScore, heatmapWeeks, pctLabel, type DayStats,
} from "@/lib/tracker/overview";

const day = (date: string, patch: Partial<DayStats> = {}): DayStats => ({
  date, title_clicked: 0, german_filtered: 0, ai_matched: 0, applied: 0, agent_unmatched: 0, ...patch,
});

describe("heatmap helpers", () => {
  it("scores a day as clicks + matches + applications", () => {
    expect(activityScore(day("2026-11-23", { title_clicked: 4, ai_matched: 2, applied: 1 }))).toBe(7);
  });

  it("buckets colour by quarter of the busiest day", () => {
    expect(activityLevel(0, 8)).toBe(0);
    expect(activityLevel(2, 8)).toBe(1);
    expect(activityLevel(4, 8)).toBe(2);
    expect(activityLevel(6, 8)).toBe(3);
    expect(activityLevel(8, 8)).toBe(4);
  });

  it("builds week columns covering the range", () => {
    const weeks = heatmapWeeks([day("2026-11-23"), day("2026-11-24")]);
    expect(weeks.length).toBeGreaterThan(0);
    const dates = weeks.flatMap((w) => w.cells.map((c) => c.date));
    expect(dates).toContain("2026-11-23");
    expect(dates).toContain("2026-11-24");
  });
});

describe("pctLabel", () => {
  it("shows a tenth under 10%, else a whole percent", () => {
    expect(pctLabel(0, 0)).toBe("0%");
    expect(pctLabel(1, 20)).toBe("5.0%");
    expect(pctLabel(5, 10)).toBe("50%");
  });
});
