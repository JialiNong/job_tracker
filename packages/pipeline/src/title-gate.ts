/**
 * Decide from the title alone whether a listing is worth fetching (port of
 * src/core/title_gate.py and the title checks in src/sources/base.py):
 * exclude list -> auto-pass keywords -> AI check.
 */
import { pyRegex } from "@tracker/core";
import type { LlmClient } from "@tracker/matching";
import { config } from "./config.js";

const EXCLUDE = config.TITLE_EXCLUDE_KEYWORDS.map((p) => pyRegex(p, true));
const API_EXCLUDE = pyRegex(config.API_TITLE_EXCLUDE_EXTRA.join("|"), true);
const FEED_TITLE = pyRegex(config.FEED_TITLE_INCLUDE_PATTERNS.join("|"), true);
const KEYWORD_SPLIT = /[-_\s]+/gu;

/** Matches the shared exclude list (TITLE_EXCLUDE_KEYWORDS). */
export const isTitleExcluded = (title: string) => !!title && EXCLUDE.some((re) => re.test(title));

/** Shared exclude list plus the API-only extras (VP, Director, new grad, ...). */
export const isApiTitleExcluded = (title: string) => isTitleExcluded(title) || API_EXCLUDE.test(title || "");

/** Broad dev-role check for keyword-less feeds (Arbeitnow, company ATS boards). */
export const isOnTopicTitle = (title: string) => FEED_TITLE.test(title || "");

const normalize = (text: string) => (text || "").toLowerCase().replace(KEYWORD_SPLIT, " ").trim();

/** Contains a TITLE_AUTO_PASS_KEYWORDS term (full-stack = fullstack = full stack). */
export function titleMatchesAutoPass(title: string, keywords: string[] = config.TITLE_AUTO_PASS_KEYWORDS): boolean {
  if (!title) return false;
  const t = normalize(title);
  const compact = t.replaceAll(" ", "");
  return keywords.some((kw) => {
    const k = normalize(kw);
    return !!k && (t.includes(k) || compact.includes(k.replaceAll(" ", "")));
  });
}

const TITLE_CHECK_PROMPT = (title: string) => `You screen job titles before opening the posting, for one candidate:
a frontend / full-stack web engineer (JavaScript/TypeScript, React / Vue / Angular,
some Node.js backend). A later step reads the full posting, so only reject titles
that are clearly NOT web/product software development.

Relevant (open it):
- Software Engineer / Developer, also with a team or product suffix
  ("Software Engineer – Payments", "Software Engineer (m/f/d)")
- Frontend / Front-End / Full Stack / Web / UI Developer or Engineer
- Product Engineer, Forward Deployed Engineer
- JavaScript / TypeScript / React / Vue / Angular / Node.js Developer
- Titles at AI companies where the work is building the product

Not relevant (skip), e.g.:
- Embedded, firmware, hardware, electronics, robotics, automotive ECU
- HMI / Qt / QML / C++ desktop or simulation software
  ("Qt/QML Simulation HMI Software Engineer")
- Data visualisation / data / BI / analytics engineering ("Data Visualisation Engineer")
- Systems / network / integration engineering ("Digital Integration Engineer")
- Growth / marketing engineering ("Growth Engineer // AI Music Video Platform")
- DevOps, SRE, cloud, security, QA, test, support, sales, solutions roles
- Roles in another language stack named in the title (Java, .NET, PHP, Python, Go, …)

If unsure, answer relevant.

Job title: ${title}

Respond ONLY with valid JSON:
{"relevant": true/false, "reason": "<one short sentence>"}
`;

/**
 * Ask the model whether a title is plausibly web / product development.
 * Fails open (true) without a client or on an error, so a good job is never
 * dropped because of a transient failure.
 */
export async function isTitleRelevantByAi(
  client: LlmClient | null, title: string, model: string, log: (l: string) => void = console.log,
): Promise<boolean> {
  if (!title) return false;
  if (!client) {
    log("⚠ OPENAI_API_KEY missing; allowing click for title without keyword match");
    return true;
  }
  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You classify job titles for a JavaScript/TypeScript web "
            + "engineer. Reject only titles that are clearly not web or "
            + "product software development. Respond only with JSON.",
        },
        { role: "user", content: TITLE_CHECK_PROMPT(title) },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const result = JSON.parse(resp.choices[0]?.message.content || "{}") as { relevant?: unknown; reason?: unknown };
    const relevant = Boolean(result.relevant);
    const reason = typeof result.reason === "string" ? result.reason.trim() : "";
    log(`  AI title check: ${relevant ? "relevant" : "unrelated"}${reason ? ` — ${reason}` : ""}`);
    return relevant;
  } catch (err) {
    log(`⚠ AI title relevance check failed (${(err as Error).message}); allowing click`);
    return true;
  }
}
