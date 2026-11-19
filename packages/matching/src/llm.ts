/**
 * The two model calls (port of classify_job and research_company in
 * src/matching/evaluator.py) and the title / company / location guess for
 * a JD without them (infer_job_metadata_with_ai in src/services/job_analysis.py).
 * The prompts are word for word the Python ones.
 *
 * The OpenAI client is passed in, so tests run on recorded answers.
 */
import type OpenAI from "openai";
import { companyKey } from "@tracker/core";
import { pySlice } from "./py.js";
import { COMPANY_SCHEMA, JOB_SCHEMA } from "./schemas.js";
import type { Company, Labels } from "./score.js";
import { groundStackLabels } from "./stack.js";
import { scrubBulletLocation } from "./location.js";
import { stripHtml } from "./text.js";

export type LlmClient = Pick<OpenAI, "responses" | "chat">;
export type Log = (line: string) => void;

export const MAX_DESCRIPTION_CHARS = 12000;

export interface ModelSettings {
  jobModel: string;
  companyModel: string;
  metadataModel: string;
  reasoningEffort: string;
}

/** Same environment variables and defaults as the Python matcher. */
export function modelSettings(env: NodeJS.ProcessEnv = process.env): ModelSettings {
  return {
    jobModel: env.MATCH_JOB_MODEL || "gpt-5.4-mini",
    companyModel: env.MATCH_COMPANY_MODEL || "gpt-5.4-mini",
    metadataModel: env.AI_MODEL || "gpt-4.1-mini",
    reasoningEffort: env.MATCH_REASONING || "low",
  };
}

/** The OpenAI account has no credits left; every further call would fail too. */
export class OutOfCreditsError extends Error {
  constructor() {
    super("OpenAI account has no credits left — add credits at https://platform.openai.com/settings/organization/billing/");
    this.name = "OutOfCreditsError";
  }
}

function rethrowIfOutOfCredits(err: unknown): void {
  const text = String((err as Error)?.message ?? err);
  if (text.includes("insufficient_quota") || text.includes("credit_balance_exhausted")) throw new OutOfCreditsError();
}

const reasoning = (model: string, effort: string) =>
  /^(gpt-5|gpt-6|o)/.test(model) ? { reasoning: { effort: effort as "low" } } : {};

const usage = (resp: { usage?: { input_tokens?: number; output_tokens?: number } | null }) => ({
  input_tokens: resp.usage?.input_tokens ?? 0,
  output_tokens: resp.usage?.output_tokens ?? 0,
});

export interface JobInput {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
}

/** Layer 1: labels for one job, or null if the call fails. */
export async function classifyJob(
  client: LlmClient, job: JobInput, cv: string, rules: string, settings: ModelSettings, log: Log = () => {},
): Promise<Labels | null> {
  const model = settings.jobModel;
  const description = pySlice(stripHtml(job.description ?? ""), MAX_DESCRIPTION_CHARS);
  const prompt = `## Candidate CV
${cv}

## Rules
${rules}

## Job posting
Title: ${job.title || "N/A"}
Company: ${job.company || "N/A"}
Location: ${scrubBulletLocation(job.location ?? "") || "N/A"}

${description || "(no description)"}
`;
  try {
    const resp = await client.responses.create({
      model,
      instructions:
        "You screen job postings for one candidate. Judge like an experienced "
        + "tech recruiter who knows her CV. Use only facts in the posting; quote it "
        + "for any hard fail or German requirement. Return the JSON schema.",
      input: prompt,
      text: { format: { type: "json_schema", name: "job_labels", schema: JOB_SCHEMA, strict: true } },
      ...reasoning(model, settings.reasoningEffort),
    });
    const labels = JSON.parse(resp.output_text) as Labels;
    groundStackLabels(labels, `${job.title || ""}\n${description}`, log);
    return { ...labels, _usage: usage(resp), _model: model };
  } catch (err) {
    rethrowIfOutOfCredits(err);
    log(`classify_job failed for ${JSON.stringify(job.title ?? null)}: ${(err as Error).message}`);
    return null;
  }
}

/** Where company profiles are cached (company_profiles), by companyKey(). */
export interface CompanyCache {
  get(key: string): Promise<Company | null>;
  set(key: string, profile: Company): Promise<void>;
}

/** Layer 2: business and customer markets via web search, cached by companyKey. */
export async function researchCompany(
  client: LlmClient, company: string, job: (JobInput & { title?: string | null }) | null,
  cache: CompanyCache | null, settings: ModelSettings, log: Log = () => {},
): Promise<Company | null> {
  const key = companyKey(company);
  if (cache && key) {
    const cached = await cache.get(key);
    if (cached) return cached;
  }
  let hint = "";
  if (job) {
    const snippet = pySlice(stripHtml(job.description ?? ""), 1500);
    hint = `\nJob title: ${job.title ?? "None"}\nPosting excerpt:\n${snippet}\n`;
  }
  const prompt = `Company: ${company}${hint}
Find what this company sells and who its customers are.
- business: what the product does and who uses it, one plain sentence.
- product_type / vertical: classify the company's own business.
- markets: where its customers or users are today (not where offices or staff are).
  global / europe / dach / germany_only, or unclear if no source confirms it.
- markets_detail: countries, regions or number of markets if a source gives them.
- If the company is a recruiter or agency and the posting names the real employer,
  set is_recruiter_for_other_company true and describe the real employer instead.
- sources: the URLs you relied on.
Never guess; say unclear.`;
  const model = settings.companyModel;
  let profile: Company;
  try {
    const resp = await client.responses.create({
      model,
      tools: [{ type: "web_search" }],
      input: prompt,
      text: { format: { type: "json_schema", name: "company_profile", schema: COMPANY_SCHEMA, strict: true } },
      ...reasoning(model, settings.reasoningEffort),
    });
    profile = { ...(JSON.parse(resp.output_text) as Company), _usage: usage(resp), _model: model };
  } catch (err) {
    rethrowIfOutOfCredits(err);
    log(`research_company failed for ${JSON.stringify(company)}: ${(err as Error).message}`);
    return null;
  }
  if (cache && key) await cache.set(key, profile);
  return profile;
}

/** Guess title / company / location from JD text (already plain text). Fields may be "". */
export async function inferJobMetadata(
  client: LlmClient, descriptionText: string, settings: ModelSettings, log: Log = () => {},
): Promise<{ title?: string; company?: string; location?: string }> {
  const trimmed = pySlice(descriptionText, 3000); // header info is near the top; keep the prompt cheap
  const prompt = "The following text was extracted from a job posting page "
    + "(LinkedIn, Indeed, or a company careers site). "
    + "Based only on the text below, infer the job title, company name, and location. "
    + "If you cannot determine a field with reasonable confidence, return an empty string.\n\n"
    + `Job description text:\n${trimmed}\n\n`
    + "Respond ONLY with valid JSON:\n"
    + '{"title": "<job title>", "company": "<company name>", "location": "<location>"}';
  try {
    const resp = await client.chat.completions.create({
      model: settings.metadataModel,
      messages: [
        {
          role: "system",
          content: "You extract job metadata (title, company, location) from job-posting text. "
            + "Respond only with valid JSON containing exactly three keys: title, company, location.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(resp.choices[0]?.message.content ?? "{}") as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return { title: text(parsed.title), company: text(parsed.company), location: text(parsed.location) };
  } catch (err) {
    log(`AI metadata inference failed: ${(err as Error).message}`);
    return {};
  }
}

/** The real client (OPENAI_API_KEY). Kept here so apps import no OpenAI SDK of their own. */
export async function createOpenAiClient(apiKey = process.env.OPENAI_API_KEY): Promise<LlmClient> {
  const { default: OpenAIClient } = await import("openai");
  return new OpenAIClient({ apiKey });
}
