/**
 * AI matching for newly scraped jobs (replaces src/matching/ai_matcher.py).
 *
 *   pnpm pipeline match [--source linkedin] [--limit 20] [--threshold 7.0]
 */
import { parseArgs } from "node:util";
import { requireEnv } from "./env.js";
import { prisma } from "@tracker/db/client";
import { createOpenAiClient, modelSettings } from "@tracker/matching";
import { loadMatchingDocs } from "../docs.js";
import { matchNewJobs } from "../match.js";

const SOURCES = ["indeed", "linkedin", "arbeitnow", "arbeitsagentur", "adzuna", "ats"];

const { values } = parseArgs({
  options: {
    source: { type: "string", short: "s" },
    limit: { type: "string", short: "l" },
    threshold: { type: "string", short: "t" },
  },
});
if (values.source && !SOURCES.includes(values.source)) {
  console.error(`--source must be one of: ${SOURCES.join(", ")}`);
  process.exit(2);
}
const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined;
const threshold = Number.parseFloat(values.threshold ?? process.env.MATCH_THRESHOLD ?? "7.0") || 7.0;

requireEnv("DATABASE_URL");
const apiKey = requireEnv("OPENAI_API_KEY");
const { cv, rules } = await loadMatchingDocs();
if (!cv) {
  console.error("Error: No user profile found. Create docs/user_profile.md first.");
  process.exit(2);
}
if (!rules) {
  console.error("Error: docs/matching_rules.md is missing.");
  process.exit(2);
}

const settings = modelSettings();
console.log("=== Starting AI Job Matching ===");
console.log(`Job model: ${settings.jobModel} · company model: ${settings.companyModel}`);
try {
  const summary = await matchNewJobs(prisma, {
    client: await createOpenAiClient(apiKey), cv, rules, settings, threshold, source: values.source, limit,
  });
  process.exitCode = summary.stoppedReason ? 3 : 0;
} finally {
  await prisma.$disconnect();
}
