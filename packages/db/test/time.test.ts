import { describe, expect, it } from "vitest";
import { berlinOffsetMinutes, fromBerlinWall, parseBerlinText, toDateOnly, toInstant } from "../src/time.js";

const naive = (iso: string) => new Date(`${iso}Z`); // how the driver returns a naive datetime

describe("Berlin wall time -> instant", () => {
  it("winter is UTC+1, summer UTC+2", () => {
    expect(berlinOffsetMinutes(Date.UTC(2026, 0, 15, 12))).toBe(60);
    expect(berlinOffsetMinutes(Date.UTC(2026, 6, 15, 12))).toBe(120);
    expect(fromBerlinWall(naive("2026-11-13T12:00:00")).toISOString()).toBe("2026-11-13T11:00:00.000Z");
    expect(fromBerlinWall(naive("2026-07-01T09:30:00")).toISOString()).toBe("2026-07-01T07:30:00.000Z");
  });

  it("keeps milliseconds", () => {
    expect(fromBerlinWall(naive("2026-11-13T12:00:00.123")).toISOString()).toBe("2026-11-13T11:00:00.123Z");
  });

  it("just after midnight stays on the same Berlin day", () => {
    const instant = fromBerlinWall(naive("2026-11-13T00:30:00"));
    expect(instant.toISOString()).toBe("2026-11-12T23:30:00.000Z");
    expect(instant.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" })).toBe("2026-11-13");
  });

  it("handles the DST switches", () => {
    // 2026-03-29 02:30 does not exist in Berlin: shifted forward
    expect(fromBerlinWall(naive("2026-03-29T02:30:00")).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // 2026-10-25 02:30 happens twice: one of the two real instants
    expect(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"])
      .toContain(fromBerlinWall(naive("2026-10-25T02:30:00")).toISOString());
  });
});

describe("toInstant", () => {
  it("reads naive values as Berlin unless the field is UTC", () => {
    const d = naive("2026-11-13T12:00:00");
    expect(toInstant(d)!.toISOString()).toBe("2026-11-13T11:00:00.000Z");
    expect(toInstant(d, { utc: true })!.toISOString()).toBe("2026-11-13T12:00:00.000Z");
  });

  it("parses typed text as Berlin and rejects junk", () => {
    expect(parseBerlinText("2026-11-12 18:00")!.toISOString()).toBe("2026-11-12T17:00:00.000Z");
    expect(parseBerlinText("2026-11-12")!.toISOString()).toBe("2026-11-11T23:00:00.000Z");
    expect(toInstant("yesterday")).toBeNull();
    expect(toInstant(null)).toBeNull();
    expect(toInstant(new Date(Number.NaN))).toBeNull();
  });

  it("date-only columns", () => {
    expect(toDateOnly("2026-11-13")!.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(toDateOnly("13.11.2026")).toBeNull();
  });
});
