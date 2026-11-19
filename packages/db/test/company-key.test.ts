import { describe, expect, it } from "vitest";
import { companyKey } from "../src/company-key.js";

// Expected values come from matching/evaluator.py company_key().
describe("companyKey matches the Python version", () => {
  it.each([
    ["Northwind Labs GmbH", "northwind labs"],
    ["Müller GmbH & Co. KG", "müller"],
    ["Smith & Co. KG", "smith"],
    ["ÄÖÜ Holding AG", "äöü"],
    ["SE Ranking", "ranking"],
    ["Cobalt", "cobalt"],
    ["co-op", "op"],
    ["x.ag", "x"],
    ["  ", ""],
    [null, ""],
  ])("%s -> %s", (name, key) => {
    expect(companyKey(name)).toBe(key);
  });
});
