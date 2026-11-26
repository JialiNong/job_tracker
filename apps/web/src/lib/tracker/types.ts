/** The JSON shapes the Tracker API returns (see packages/core/src/job.ts serializeJob). */

export interface TimelineItem {
  step: string;
  label?: string;
  at: string; // "YYYY-MM-DD HH:MM", Berlin
}

export interface BreakdownSection {
  matched?: string[];
  unmatched?: string[];
}

export interface CompanyProfile {
  business?: string;
  product_type?: string;
  vertical?: string;
  markets?: string;
  markets_detail?: string;
  is_recruiter_for_other_company?: boolean;
}

export interface HistoryItem {
  _id: string;
  title: string;
  status: string;
  progress: string;
  applied_at: string;
  matched_at: string;
  last_step_at: string;
  source: string;
  applicant_position: number | null;
}

export interface Job {
  _id: string;
  title: string;
  company: string;
  location: string;
  link: string;
  source: string;
  status: string;
  origin: string;
  applicants: string;
  match_score: number | null;
  recommendation: string | null;
  summary: string | null;
  disqualification_reason: string | null;
  match_reasons: string[] | null;
  what_youll_do: BreakdownSection | null;
  what_theyre_looking_for: BreakdownSection | null;
  job_labels: Record<string, unknown> | null;
  company_profile: CompanyProfile | null;
  matched_at: string | null;
  applied_at: string | null;
  details_fetched_at: string | null;
  posted_at: string | null;
  notes: string;
  ai_pending: boolean;
  highlights: string[];
  application_qa: { question: string; answer: string }[];
  applicant_position: number | null;
  recommended_by: string;
  recommend_reason: string;
  details_missing: boolean;
  can_fetch_details: boolean;
  application_timeline: TimelineItem[];
  company_history?: HistoryItem[];
  company_history_total?: number;
}

export interface JobPage {
  jobs: Job[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface Stats {
  total: number;
  by_status: Record<string, number>;
  unmatched: number;
  timeouts: number;
  funnel: {
    title_clicked: number;
    german_filtered: number;
    ai_matched: number;
    ai_unmatched: number;
    applied: number;
    interviewed: number;
    offer: number;
  };
}

export interface StackRow {
  key: string;
  label?: string;
  applied: number;
  rejected: number;
}
export interface StackSummary {
  applied: number;
  rejected: number;
  [group: string]: StackRow[] | number;
}
export interface StackStats {
  settled_after_days: number;
  computed_at: string;
  all: StackSummary;
  settled: StackSummary;
}

/** GET /api/stats/agent-pushes: today's (Berlin) agent pushes for the Tracker banner. */
export interface AgentPushesToday {
  day: string;
  /** True on the public demo: fixed sample, not live agent traffic. */
  sample?: boolean;
  agents: { agent: string; runs: number; received: number; saved: number; skipped: number; failed: number; last_at: string }[];
  failures: { url: string; reason: string; message: string; title: string; company: string; agent: string; at: string }[];
  needs_link: { card_id: string; url: string; title: string; company: string; agent: string }[];
  items: {
    outcome: "saved" | "tracker" | "unmatched" | "awaiting_match" | "timeout";
    url: string; title: string; company: string; open_path: string | null;
    match_score: number | null; match_gate: string; origin: string; agents: string[];
  }[];
}
