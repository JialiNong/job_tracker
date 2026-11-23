import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS, changedFilterCount, companyKey, toQuery, uniqueCompanies, type Filters,
} from "@/components/tracker/filters";

const filters = (patch: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...patch });

describe("toQuery", () => {
  it("sends the UI defaults: active status and Germany, page 1", () => {
    const q = toQuery(filters(), 1);
    expect(q.get("status")).toBe("active");
    expect(q.get("country")).toBe("germany");
    expect(q.get("page")).toBe("1");
    expect(q.get("page_size")).toBe("20");
    expect(q.get("origin")).toBeNull();
    expect(q.get("source")).toBeNull();
    expect(q.get("q")).toBeNull();
  });

  it("drops defaults and sends the rest", () => {
    const q = toQuery(filters({
      status: "all", country: "all", origin: "agent", source: "linkedin",
      q: "  backend  ", highlightsOnly: true, companies: ["Acme", "Globex"], appliedOn: "2026-11-20",
    }), 3);
    expect(q.get("status")).toBeNull();
    expect(q.get("country")).toBeNull();
    expect(q.get("origin")).toBe("agent");
    expect(q.get("source")).toBe("linkedin");
    expect(q.get("q")).toBe("backend");
    expect(q.get("highlights")).toBe("true");
    expect(q.getAll("company")).toEqual(["Acme", "Globex"]);
    expect(q.get("applied_on")).toBe("2026-11-20");
    expect(q.get("page")).toBe("3");
  });

  it("turns Custom Time into date_from / date_to", () => {
    const q = toQuery(filters({ timePreset: "custom", dateFrom: "2026-01-01", dateTo: "2026-01-31" }), 1);
    expect(q.get("date_from")).toBe("2026-01-01");
    expect(q.get("date_to")).toBe("2026-01-31");
  });
});

describe("changedFilterCount", () => {
  it("is 0 at the toolbar defaults", () => {
    expect(changedFilterCount(filters())).toBe(0);
  });

  it("counts popover selects that left their default", () => {
    expect(changedFilterCount(filters({ source: "indeed", origin: "manual" }))).toBe(2);
    expect(changedFilterCount(filters({ country: "all", timePreset: "7" }))).toBe(2);
  });
});

describe("uniqueCompanies", () => {
  it("trims and de-dupes case-insensitively", () => {
    expect(uniqueCompanies([" Acme ", "acme", "Globex", ""])).toEqual(["Acme", "Globex"]);
  });

  it("companyKey folds whitespace", () => {
    expect(companyKey("  Acme   Labs ")).toBe("acme labs");
  });
});
