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
}
