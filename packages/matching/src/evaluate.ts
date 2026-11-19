/**
 * One job, start to finish (port of evaluate() in src/matching/evaluator.py):
 * empty / non-English / incomplete checks first (no AI for those), then
 * layer 1, layer 2 only when layer 1 passes, then the score.
 */
import { isNonEnglishJobDetail } from "./language.js";
import { type CompanyCache, type JobInput, type LlmClient, type Log, type ModelSettings, classifyJob, researchCompany } from "./llm.js";
import { assessJobDescription } from "./quality.js";
import { type Company, type EvaluateResult, descriptionUsable, scoreJob } from "./score.js";
import { MATCH_WEIGHTS, isBlockedMatchCompany } from "./weights.js";

export interface EvaluateDeps {
  client: LlmClient;
  cv: string;
  rules: string;
  settings: ModelSettings;
  companyCache?: CompanyCache | null;
  log?: Log;
}

const stopped = (part: string): EvaluateResult => ({ labels: null, company: null, score: 0, parts: [part] });

export async function evaluate(job: JobInput, deps: EvaluateDeps): Promise<EvaluateResult> {
  const log = deps.log ?? (() => {});
  const description = job.description ?? "";
  const assessment = assessJobDescription(description, job.title ?? "", job.company ?? "");
  if (assessment.kind === "empty") return stopped("empty description");
  if (isNonEnglishJobDetail(description)[0]) return stopped("non-english description");
  if (!assessment.ok) return stopped("description unusable");

  const labels = await classifyJob(deps.client, job, deps.cv, deps.rules, deps.settings, log);
  let company: Company | null = null;
  if (
    labels
    && descriptionUsable(labels)
    && !isBlockedMatchCompany(job.company)
    && (scoreJob(job, labels).score ?? 0) > MATCH_WEIGHTS.hard_fail_score
  ) {
    company = await researchCompany(deps.client, job.company ?? "", job, deps.companyCache ?? null, deps.settings, log);
  }
  return { labels, company, ...scoreJob(job, labels, company) };
}
