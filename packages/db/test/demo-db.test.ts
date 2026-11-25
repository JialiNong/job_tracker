import { describe, expect, it } from "vitest";
import { demoDbName, isDemoDatabaseUrl } from "../src/demo-db.js";

describe("isDemoDatabaseUrl", () => {
  it("allows names that end with _demo", () => {
    expect(isDemoDatabaseUrl("postgresql://u:p@localhost:5432/tracker_demo")).toBe(true);
    expect(isDemoDatabaseUrl("postgresql://u:p@localhost/job_scraper_demo")).toBe(true);
  });

  it("refuses production / dev / test names", () => {
    expect(isDemoDatabaseUrl("postgresql://u:p@localhost/tracker_dev")).toBe(false);
    expect(isDemoDatabaseUrl("postgresql://u:p@localhost/tracker_test")).toBe(false);
    expect(isDemoDatabaseUrl("postgresql://u:p@localhost/neondb")).toBe(false);
    expect(isDemoDatabaseUrl("postgresql://u:p@localhost/demo")).toBe(false);
  });

  it("reads the path name from the URL", () => {
    expect(demoDbName("postgresql://u:p@h/tracker_demo?sslmode=require")).toBe("tracker_demo");
  });
});
