/** JSON schemas the model must answer in (structured outputs). Same as src/matching/evaluator.py. */
export const ROLE_TYPES = [
  "frontend", "fullstack_frontend_leaning", "fullstack_balanced", "fullstack_backend_leaning", "backend", "not_web_dev",
];
export const HARD_FAIL_KINDS = [
  "none", "german_required", "non_js_backend_required", "leadership", "not_web_dev", "backend_heavy",
  "too_many_years", "contract_or_location",
];
export const PRODUCT_TYPES = [
  "b2b_saas", "b2c_ecommerce_marketplace", "consumer_app", "fintech", "other_software_product",
  "agency_consulting_outsourcing", "staffing_recruiter", "hardware_industrial_automotive", "public_sector_research", "other",
];
export const MARKETS = ["global", "europe", "dach", "germany_only", "unclear"];

const str = { type: "string" };
const strList = { type: "array", items: { type: "string" } };
const oneOf = (values: string[]) => ({ type: "string", enum: values });

const JOB_PROPERTIES = {
  description_usable: { type: "boolean" },
  hard_fail: { type: "boolean" },
  hard_fail_kind: oneOf(HARD_FAIL_KINDS),
  hard_fail_evidence: str,
  german_required: { type: "boolean" },
  german_evidence: str,
  role_type: oneOf(ROLE_TYPES),
  stack_fit: oneOf(["strong", "partial", "weak"]),
  seniority: oneOf(["junior", "mid", "senior", "lead_or_above"]),
  backend_language_ask: oneOf([
    "none", "js_only", "or_list_with_js", "nice_to_have", "company_uses", "implied_non_js", "required_non_js",
  ]),
  ai_product_work: { type: "boolean" },
  english_team: oneOf(["true", "false", "unclear"]),
  stack: str,
  stack_matched: strList,
  stack_missing: strList,
  summary: str,
  watch_outs: str,
};

export const JOB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: JOB_PROPERTIES,
  required: Object.keys(JOB_PROPERTIES),
};

const COMPANY_PROPERTIES = {
  business: str,
  product_type: oneOf(PRODUCT_TYPES),
  vertical: str,
  markets: oneOf(MARKETS),
  markets_detail: str,
  is_recruiter_for_other_company: { type: "boolean" },
  sources: strList,
};

export const COMPANY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: COMPANY_PROPERTIES,
  required: Object.keys(COMPANY_PROPERTIES),
};
