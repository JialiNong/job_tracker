/** Browser calls for the Unmatched, Timeouts and Log Job pages (same error handling as the Tracker's). */
import { request, send } from "@/lib/tracker/api";
import type { Job } from "@/lib/tracker/types";

export interface UnmatchedJob extends Job {
  match_gate: string | null;
  user_status: string | null;
  agent_recommended_by: string | null;
  agent_recommend_reason: string | null;
  missing_requirements: string[] | null;
  red_flags: string[] | null;
}

export interface UnmatchedPage {
  jobs: UnmatchedJob[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  threshold: number;
}

export interface TimeoutJob {
  _id: string;
  job_id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  keyword: string;
  reason: string;
  review_status: string;
  timeout_count: number;
  link: string;
  created_at: string;
  updated_at: string;
}

export interface LookupResult {
  url: string;
  found: boolean;
  collection?: string;
  stage?: "tracker" | "unmatched" | "awaiting_match" | "timeout";
  on_tracker: boolean;
  promotable: boolean;
  id?: string;
  title?: string;
  company?: string;
  status?: string;
  source: string;
  job_id: string;
  match_score?: number | null;
  open_path?: string | null;
  ai_pending?: boolean;
  details_missing?: boolean;
  needs_scrape?: boolean;
}

export interface LogRun {
  running: boolean;
  log: string[];
  log_total: number;
  done_count: number;
  fail_count: number;
  skip_count: number;
}

export interface LogRequest {
  urls: string[];
  status: "pending" | "applied";
  applied_date: string;
  mode: "scrape" | "link_only";
  recommended_by: string;
  title: string;
  company: string;
  location: string;
}

export const pagesApi = {
  unmatched: (params: URLSearchParams, signal?: AbortSignal) =>
    request<UnmatchedPage>(`/api/unmatched-jobs?${params}`, { signal }),
  unmatchedJob: (id: string) => request<UnmatchedJob>(`/api/unmatched-jobs/${id}`),
  setUnmatchedStatus: (id: string, userStatus: "" | "watchlist") =>
    send<{ ok: boolean; copy_error: string | null }>("PATCH", `/api/unmatched-jobs/${id}/status`, { user_status: userStatus }),

  timeouts: (source: string, reviewStatus: string) =>
    request<{ jobs: TimeoutJob[]; total: number; page: number; pages: number }>(
      `/api/timeout-jobs?${new URLSearchParams({ source, review_status: reviewStatus })}`),
  addTimeout: (id: string) => send<{ ok: boolean; already: boolean }>("POST", `/api/timeout-jobs/${id}/match`),
  dismissTimeout: (id: string) => send<{ ok: boolean }>("POST", `/api/timeout-jobs/${id}/dismiss`),

  lookup: (urls: string[]) => send<{ results: LookupResult[] }>("POST", "/api/manual-apply/lookup", { urls }),
  logJobs: (body: LogRequest) =>
    send<{ status: string; total: number; job_status: string; mode: string }>("POST", "/api/manual-apply", body),
  logStatus: (since: number) => request<LogRun>(`/api/manual-apply/status?since=${since}`),
};
