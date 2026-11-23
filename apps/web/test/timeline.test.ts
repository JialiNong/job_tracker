import { describe, expect, it } from "vitest";
import { fromInputValue, nextActions, toInputValue } from "@/lib/tracker/timeline";
import type { TimelineItem } from "@/lib/tracker/types";

const at = "2026-11-20 12:00";
const ev = (step: string): TimelineItem => ({ step, at });

describe("nextActions", () => {
  it("starts with Applied, then Reapplied after Rejected", () => {
    expect(nextActions([]).map((a) => a.step)).toEqual(["applied"]);
    expect(nextActions([ev("applied"), ev("rejected")]).map((a) => a.step)).toContain("reapplied");
  });

  it("offers Offer after an interview round", () => {
    const steps = nextActions([ev("applied"), ev("interview_invite"), ev("interview_1")]).map((a) => a.step);
    expect(steps).toContain("offer");
    expect(steps).toContain("interview_2");
  });

  it("offers nothing forward after Offer (screening already recorded)", () => {
    const steps = nextActions([
      ev("applied"), ev("screening"), ev("screening_done"), ev("interview_invite"), ev("offer"),
    ]).map((a) => a.step);
    expect(steps).toEqual([]);
  });
});

describe("datetime-local round-trip", () => {
  it("converts the modal value to the stored wall clock", () => {
    expect(fromInputValue("2026-01-15T14:30")).toBe("2026-01-15 14:30");
    expect(toInputValue("2026-01-15 14:30")).toBe("2026-01-15T14:30");
  });
});
