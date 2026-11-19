"use client";
/**
 * The list filters live in the URL: a refresh or a shared link shows the
 * same list. Changes replace the history entry (like the old page), so the
 * back button leaves the Tracker instead of stepping through filters.
 * Default values are left out of the URL.
 *
 *   /?status=rejected&q=react&company=Acme&company=Bluefin&page=2
 *
 * A company or applied-day link (/?company=Acme, the heatmap's
 * /?applied=2026-11-12) shows every such job, so in that view the status
 * and region default to "all" instead of "active" / "germany".
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_FILTERS, type Filters, OPEN_VIEW_FILTERS, uniqueCompanies } from "./filters";

const PARAM = {
  status: "status", q: "q", source: "source", origin: "origin", country: "country",
  timePreset: "time", dateFrom: "from", dateTo: "to",
} as const;

function defaultsFor(companies: string[], appliedOn: string): Filters {
  const view = companies.length > 0 || appliedOn !== "";
  return view ? { ...DEFAULT_FILTERS, ...OPEN_VIEW_FILTERS } : DEFAULT_FILTERS;
}

export function parseFilters(params: URLSearchParams): { filters: Filters; page: number } {
  const companies = uniqueCompanies(params.getAll("company"));
  const appliedOn = /^\d{4}-\d{2}-\d{2}$/.test(params.get("applied") ?? "") ? params.get("applied")! : "";
  const defaults = defaultsFor(companies, appliedOn);
  const text = (key: keyof typeof PARAM) => params.get(PARAM[key]) ?? defaults[key];
  return {
    filters: {
      status: text("status"), q: text("q"), source: text("source"), origin: text("origin"),
      country: text("country"), timePreset: text("timePreset"), dateFrom: text("dateFrom"), dateTo: text("dateTo"),
      highlightsOnly: params.get("hl") === "1",
      companies,
      appliedOn,
    },
    page: Math.max(1, Number.parseInt(params.get("page") ?? "", 10) || 1),
  };
}

export function serializeFilters(f: Filters, page: number, keep?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  // Parameters this hook does not own (e.g. ?open=) stay
  keep?.forEach((value, key) => {
    if (!["company", "applied", "hl", "page", ...Object.values(PARAM)].includes(key)) params.append(key, value);
  });
  f.companies.forEach((name) => params.append("company", name));
  if (f.appliedOn) params.set("applied", f.appliedOn);
  const defaults = defaultsFor(f.companies, f.appliedOn);
  for (const key of Object.keys(PARAM) as (keyof typeof PARAM)[]) {
    if (f[key] !== defaults[key]) params.set(PARAM[key], f[key]);
  }
  if (f.highlightsOnly) params.set("hl", "1");
  if (page > 1) params.set("page", String(page));
  return params;
}

export function useFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { filters, page } = parseFilters(new URLSearchParams(searchParams.toString()));

  const navigate = (next: Filters, nextPage: number) => {
    const qs = serializeFilters(next, nextPage, new URLSearchParams(searchParams.toString())).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return {
    filters,
    page,
    /** Change filters; the list goes back to page 1. */
    setFilters: (patch: Partial<Filters>) => navigate({ ...filters, ...patch }, 1),
    setPage: (next: number) => navigate(filters, next),
    /** Remove a one-off parameter (e.g. ?open= after the card was opened). */
    dropParam: (name: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(name);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
  };
}
