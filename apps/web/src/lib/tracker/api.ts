/**
 * Browser-side calls to the Tracker API. Every helper throws an Error with
 * the server's message on a non-2xx answer, so callers only handle one path.
 */
import type { DayStats, SankeyData, Week } from "./overview";
import type { Job, JobPage, Stats, StackStats, TimelineItem } from "./types";

export interface JourneyStep { step: string; label: string; at: string; date: string }
export interface Journey {
  start_date: string;
  end_date: string;
  today: string;
  duration_days: number;
  total_applied: number;
  tracks: { job_id: string; company: string; title: string; status: string; steps: JourneyStep[] }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && data.error) || `Request failed (HTTP ${res.status})`);
  }
  return data as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const api = {
  listJobs: (params: URLSearchParams, signal?: AbortSignal) =>
    request<JobPage>(`/api/jobs?${params}`, { signal }),
  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  getDescription: (id: string) => request<{ description: string }>(`/api/jobs/${id}/description`),
  stats: () => request<Stats>("/api/stats"),
  daily: (days: number) => request<{ days: DayStats[] }>(`/api/stats/daily?days=${days}`),
  locations: () => request<{ total: number; locations: { name: string; count: number }[] }>("/api/stats/locations"),
  flow: () => request<{ sankey: SankeyData; weekly: { weeks: Week[]; totals: Omit<Week, "week_start"> } }>("/api/stats/flow"),
  journey: () => request<Journey>("/api/journey"),
  stacks: (refresh = false) => request<StackStats>(`/api/stats/stacks${refresh ? "?refresh=1" : ""}`),

  setStatus: (id: string, status: string) =>
    send<{ status: string }>("PATCH", `/api/jobs/${id}/status`, { status }),
  setTimeline: (id: string, timeline: TimelineItem[]) =>
    send<{ status: string; applied_at: string | null; application_timeline: TimelineItem[] }>(
      "PATCH", `/api/jobs/${id}/timeline`, { timeline }),
  setNotes: (id: string, notes: string) => send("PATCH", `/api/jobs/${id}/notes`, { notes }),
  setHighlights: (id: string, highlights: string[]) =>
    send<{ highlights: string[] }>("PATCH", `/api/jobs/${id}/highlights`, { highlights }),
  setApplicationQa: (id: string, qa: { question: string; answer: string }[]) =>
    send<{ application_qa: { question: string; answer: string }[] }>(
      "PATCH", `/api/jobs/${id}/application-qa`, { application_qa: qa }),
  setApplicantPosition: (id: string, value: string) =>
    send<{ applicant_position: number | null }>("PATCH", `/api/jobs/${id}/applicant-position`, { applicant_position: value }),
  setInfo: (id: string, info: { title: string; company: string; location: string }) =>
    send("PATCH", `/api/jobs/${id}/info`, info),
  replaceLink: (id: string, link: string) =>
    send<{ unchanged: boolean }>("PATCH", `/api/jobs/${id}/link`, { link }),
  deleteJob: (id: string) => send("DELETE", `/api/jobs/${id}`),
  batchDelete: (ids: string[]) => send<{ deleted: number; ids: string[] }>("POST", "/api/jobs/batch-delete", { ids }),
};
