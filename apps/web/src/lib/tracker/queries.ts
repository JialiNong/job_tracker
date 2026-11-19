"use client";
/**
 * Server state for the Tracker, with TanStack Query.
 *
 * Query keys:
 *   ["jobs", queryString]  one page of the list for a set of filters
 *   ["job", id]            one card (a deep link to a card not on the page)
 *   ["stats"]              sidebar counts
 *
 * After any write the affected queries are invalidated and refetch in the
 * background; the list keeps showing the old data until the new arrives.
 * A card that no longer fits the filter simply is not in the new page.
 */
import {
  type QueryClient, keepPreviousData, useMutation, useQuery, useQueryClient,
} from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { api } from "./api";
import type { Job, JobPage } from "./types";

export const trackerKeys = {
  all: ["jobs"] as const,
  page: (query: string) => ["jobs", query] as const,
  job: (id: string) => ["job", id] as const,
  stats: ["stats"] as const,
  /** Overview charts: refetched after writes like the counts */
  overview: ["overview"] as const,
  stacks: ["stacks"] as const,
};

export function useJobPage(query: URLSearchParams) {
  const key = query.toString();
  return useQuery({
    queryKey: trackerKeys.page(key),
    queryFn: ({ signal }) => api.listJobs(query, signal), // an obsolete request is aborted
    placeholderData: keepPreviousData, // no spinner flash when filters change
  });
}

export function useStats() {
  return useQuery({ queryKey: trackerKeys.stats, queryFn: api.stats });
}

/** One card by id (only for a deep link to a card that is not on the current page). */
export function useJob(id: string) {
  return useQuery({ queryKey: trackerKeys.job(id), queryFn: () => api.getJob(id), enabled: !!id, retry: false });
}

/** Overview charts. Only fetched while the Overview tab is open (`enabled`). */
export function useOverview(enabled: boolean) {
  const opts = { enabled, staleTime: 30_000 };
  return {
    daily: useQuery({ queryKey: [...trackerKeys.overview, "daily"], queryFn: () => api.daily(92), ...opts }), // ~3 months
    locations: useQuery({ queryKey: [...trackerKeys.overview, "locations"], queryFn: api.locations, ...opts }),
    flow: useQuery({ queryKey: [...trackerKeys.overview, "flow"], queryFn: api.flow, ...opts }),
    journey: useQuery({ queryKey: [...trackerKeys.overview, "journey"], queryFn: api.journey, ...opts }),
  };
}

/** Stacks numbers (served from the server-side cache). */
export function useStacks(enabled: boolean) {
  return useQuery({ queryKey: trackerKeys.stacks, queryFn: () => api.stacks(), enabled, staleTime: 60_000 });
}

/** Rebuild the Stacks numbers from every JD; the current numbers stay shown until then. */
export function useRecomputeStacks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.stacks(true),
    onSuccess: (data) => client.setQueryData(trackerKeys.stacks, data),
  });
}

/** Refetch everything the Tracker shows: list pages, single cards, counts, charts. */
export function invalidateTracker(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: trackerKeys.all }),
    client.invalidateQueries({ queryKey: ["job"] }),
    client.invalidateQueries({ queryKey: trackerKeys.stats }),
    client.invalidateQueries({ queryKey: trackerKeys.overview }),
  ]);
}

/** Apply `change` to a card wherever it is cached (list pages and the single-card query). */
export function updateCachedJob(client: QueryClient, id: string, change: (job: Job) => Job) {
  client.setQueriesData<JobPage>({ queryKey: trackerKeys.all }, (page) =>
    page && { ...page, jobs: page.jobs.map((j) => (j._id === id ? change(j) : j)) });
  client.setQueryData<Job>(trackerKeys.job(id), (job) => job && change(job));
}

interface WriteOptions<TArgs, TResult> {
  /** Toast after success; a function gets the server's answer. */
  success?: string | ((result: TResult, args: TArgs) => string);
  /** Toast prefix on failure; the server's message follows. */
  failure: string;
  /** Skip the refetch (the write changes nothing the list shows, e.g. notes). */
  noRefetch?: boolean;
}

/**
 * A Tracker write: run it, toast the outcome, refetch what changed.
 * `isPending` replaces hand-kept "busy" flags.
 */
export function useTrackerWrite<TArgs, TResult>(
  write: (args: TArgs) => Promise<TResult>,
  options: WriteOptions<TArgs, TResult>,
) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: write,
    onSuccess: async (result, args) => {
      if (!options.noRefetch) await invalidateTracker(client);
      const msg = typeof options.success === "function" ? options.success(result, args) : options.success;
      if (msg) toast(msg);
    },
    onError: (err: Error) => toast(`${options.failure}: ${err.message}`, "err"),
  });
}
