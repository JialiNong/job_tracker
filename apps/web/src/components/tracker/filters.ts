/**
 * The Tracker's list filters as one value, how they become /api/jobs query
 * parameters, and how many of the Filters popover's fields differ from
 * their defaults ("Filters (2)").
 */
import { presetRange } from "@/lib/tracker/format";

export interface Filters {
  status: string;
  q: string;
  source: string;
  origin: string;
  country: string;
  timePreset: string;
  dateFrom: string;
  dateTo: string;
  highlightsOnly: boolean;
  companies: string[];
  appliedOn: string;
}

export const DEFAULT_FILTERS: Filters = {
  status: "active",
  q: "",
  source: "all",
  origin: "all",
  country: "germany",
  timePreset: "all",
  dateFrom: "",
  dateTo: "",
  highlightsOnly: false,
  companies: [],
  appliedOn: "",
};

export const PAGE_SIZE = 20;

/** Toolbar reset used when opening a company / applied-day view: show every such job. */
export const OPEN_VIEW_FILTERS: Partial<Filters> = {
  status: "all", q: "", source: "all", origin: "all", country: "all", timePreset: "all", highlightsOnly: false,
};

export function toQuery(f: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams();
  if (f.origin !== "all") params.set("origin", f.origin);
  if (f.status !== "all") params.set("status", f.status);
  if (f.country !== "all") params.set("country", f.country);
  if (f.highlightsOnly) params.set("highlights", "true");
  if (f.source !== "all") params.set("source", f.source);
  if (f.q.trim()) params.set("q", f.q.trim());
  f.companies.forEach((name) => params.append("company", name));
  if (f.appliedOn) params.set("applied_on", f.appliedOn);
  const { from, to } = presetRange(f.timePreset, f.dateFrom, f.dateTo);
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));
  return params;
}

/** How many popover selects differ from their default. */
export function changedFilterCount(f: Filters): number {
  return (["source", "origin", "country", "timePreset"] as const)
    .filter((key) => f[key] !== DEFAULT_FILTERS[key]).length;
}

export const companyKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Company names, trimmed and case-insensitively unique. */
export function uniqueCompanies(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => n.trim()).filter((n) => n && !seen.has(companyKey(n)) && seen.add(companyKey(n)));
}
