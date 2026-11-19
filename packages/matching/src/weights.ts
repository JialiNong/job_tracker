/**
 * How labels turn into a 0–10 score (port of MATCH_WEIGHTS and
 * MATCH_BLOCKED_COMPANIES in src/core/config.py). Preferences are tuned by
 * editing these numbers, not the prompts.
 */
export const MATCH_WEIGHTS = {
  hard_fail_score: 1.0,
  // Base score by what the role actually is
  role_type: {
    frontend: 7.0,
    fullstack_frontend_leaning: 6.5,
    fullstack_balanced: 5.5,
    fullstack_backend_leaning: 3.5,
    backend: 2.0,
    not_web_dev: 0.0,
  } as Record<string, number>,
  stack_fit: { strong: 1.0, partial: 0.0, weak: -2.0 } as Record<string, number>,
  seniority: { junior: -0.5, mid: 0.0, senior: 0.0, lead_or_above: -3.0 } as Record<string, number>,
  backend_language_ask: { implied_non_js: -1.0 } as Record<string, number>, // required_non_js is a hard fail
  ai_product_work: 0.5,
  preferred_location: 0.3, // Leipzig / Halle / Berlin / remote
  // Company (layer 2): business type and where its customers are
  product_type: {
    b2b_saas: 1.0,
    b2c_ecommerce_marketplace: 1.0,
    consumer_app: 0.5,
    fintech: 0.3,
    other_software_product: 0.0,
    agency_consulting_outsourcing: -1.0,
    staffing_recruiter: -1.0,
    hardware_industrial_automotive: -2.5,
    public_sector_research: -0.5,
    other: -0.5,
  } as Record<string, number>,
  recruiter_posting: -1.0, // agency posting on behalf of another employer
  markets: { global: 0.7, europe: 0.4, dach: 0.0, germany_only: -0.5, unclear: 0.0 } as Record<string, number>,
};

/** Aggregators never put on the Tracker (substring, case-insensitive). */
export const MATCH_BLOCKED_COMPANIES = ["instaffo", "jobgether", "Alignerr", "Hyra", "The Ai Training Company", "TaskVerse"];

export function isBlockedMatchCompany(company: string | null | undefined): boolean {
  if (!company) return false;
  const lower = String(company).toLowerCase();
  return MATCH_BLOCKED_COMPANIES.some((name) => lower.includes(name.toLowerCase()));
}
