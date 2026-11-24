/**
 * API job sources: fetch -> filters -> AI match -> Telegram digest
 * (replaces src/sources/run_sources.py). No browser: runs locally or on
 * GitHub Actions.
 *
 *   pnpm pipeline sources                                  # Arbeitnow + Bundesagentur + ATS, last day
 *   pnpm pipeline sources --sources arbeitnow,ats --days 3
 *   pnpm pipeline sources --dry-run --no-match             # print what would be saved
 */
import { parseArgs } from "node:util";
import { requireEnv } from "./env.js";
import { prisma } from "@tracker/db/client";
import { createOpenAiClient, modelSettings } from "@tracker/matching";
import { API_MAX_POSTING_AGE_DAYS } from "../config.js";
import { SOURCE_LABELS, pushMatchDigest } from "../digest.js";
import { loadMatchingDocs } from "../docs.js";
import { type IngestStats, ingest } from "../ingest.js";
import { formatMatchOutcomeLine, matchNewJobs, mergeMatchSummaries, type MatchSummary } from "../match.js";
import { adzunaCredentials, fetchAdzuna } from "../sources/adzuna.js";
import { fetchArbeitnow } from "../sources/arbeitnow.js";
import { fetchArbeitsagentur } from "../sources/arbeitsagentur.js";
import { fetchAts } from "../sources/ats.js";
import type { SourceJob } from "../sources/types.js";
import { sendTelegramMessage } from "../telegram.js";

// name -> [fetch, keyword-less feed?]
const SOURCES: Record<string, [(days: number) => Promise<SourceJob[]>, boolean]> = {
  arbeitnow: [(d) => fetchArbeitnow(d), true],
  arbeitsagentur: [(d) => fetchArbeitsagentur(d), false],
  adzuna: [(d) => fetchAdzuna(d), false],
  ats: [(d) => fetchAts(d), true],
};
// Adzuna is opt-in (--sources ...,adzuna): its key is paid beyond 25 trial calls
const DEFAULT_SOURCES = ["arbeitnow", "arbeitsagentur", "ats"];

function summaryLine(name: string, stats: IngestStats, error: string | null): string {
  const label = SOURCE_LABELS[name] ?? name;
  if (error?.startsWith("skipped")) return `• ${label}: ${error}`;
  if (error) return `⚠️ ${label}: failed — ${error.slice(0, 120)}`;
  const parts = [`${stats.listed ?? 0} listed`, `${(stats.saved ?? 0) + (stats.would_save ?? 0)} new saved`];
  for (const [key, text] of [
    ["known", "already seen"], ["cross_source_duplicate", "dup of other board"], ["german_filtered", "non-English"],
    ["not_germany", "outside DE"], ["too_old", `posted >${API_MAX_POSTING_AGE_DAYS}d ago`],
  ] as const) {
    if (stats[key]) parts.push(`${stats[key]} ${text}`);
  }
  return `• ${label}: ${parts.join(", ")}`;
}

const { values } = parseArgs({
  options: {
    sources: { type: "string", default: DEFAULT_SOURCES.join(",") },
    days: { type: "string", default: "1" },
    "dry-run": { type: "boolean", default: false },
    "no-match": { type: "boolean", default: false },
    "no-telegram": { type: "boolean", default: false },
  },
});
const names = values.sources!.split(",").map((s) => s.trim()).filter(Boolean);
const unknown = names.filter((n) => !(n in SOURCES));
const days = Number.parseInt(values.days!, 10);
if (unknown.length) { console.error(`unknown source(s): ${unknown.join(", ")}`); process.exit(2); }
if (!(days >= 1)) { console.error("--days must be ≥ 1"); process.exit(2); }
const dryRun = values["dry-run"]!;

requireEnv("DATABASE_URL");
const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
const client = apiKey ? await createOpenAiClient(apiKey) : null;
const settings = modelSettings();
const runId = process.env.PIPELINE_RUN_ID || `api_${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}_${process.pid}`;
console.log(`=== API sources run ${runId} · sources=${names.join(",")} · days=${days}${dryRun ? " · DRY RUN" : ""} ===`);

const started = Date.now();
const results: Record<string, [IngestStats, string | null]> = {};
try {
  for (const name of names) {
    console.log(`\n--- ${SOURCE_LABELS[name]} ---`);
    if (name === "adzuna" && !adzunaCredentials()) {
      console.log("Adzuna: ADZUNA_APP_ID / ADZUNA_APP_KEY not set — skipped");
      results[name] = [{}, "skipped — no API key (ADZUNA_APP_ID / ADZUNA_APP_KEY)"];
      continue;
    }
    try {
      const [fetchSource, feed] = SOURCES[name]!;
      const stats = await ingest(prisma, await fetchSource(days), {
        requireOnTopicTitle: feed, dryRun, client, titleModel: settings.metadataModel, runId,
      });
      results[name] = [stats, null];
      console.log(`${SOURCE_LABELS[name]}: ${Object.entries(stats).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
    } catch (err) {
      results[name] = [{}, `${(err as Error).name}: ${(err as Error).message}`];
      console.log(`✗ ${SOURCE_LABELS[name]} failed: ${(err as Error).message}`);
    }
  }

  const matchParts: MatchSummary[] = [];
  let matchSkippedReason: string | null = null;
  if (!dryRun && !values["no-match"]) {
    if (!client) matchSkippedReason = "OPENAI_API_KEY not set — AI matching skipped";
    else {
      const { cv, rules } = await loadMatchingDocs();
      if (!cv || !rules) matchSkippedReason = "docs/user_profile.md or docs/matching_rules.md missing — AI matching skipped";
      else {
        const threshold = Number.parseFloat(process.env.MATCH_THRESHOLD ?? "7.0") || 7.0;
        for (const name of names.filter((n) => results[n]![1] === null)) {
          console.log(`\n--- AI matching: ${SOURCE_LABELS[name]} ---`);
          const part = await matchNewJobs(prisma, { client, cv, rules, settings, threshold, source: name });
          matchParts.push(part);
          if (part.stoppedReason) break;
        }
      }
    }
    if (matchSkippedReason) console.log(`\n${matchSkippedReason}`);
  }

  const matchSummary = mergeMatchSummaries(matchParts);
  const minutes = Math.round((Date.now() - started) / 60_000);
  const lines = [
    `🌐 API sources done (${minutes} min, last ${days}d)`,
    ...names.map((n) => summaryLine(n, ...results[n]!)),
  ];
  // Same shape as Agent push ("N saved · M already stored"): new cards vs skips
  if (!dryRun && !values["no-match"]) {
    if (matchSkippedReason) lines.push(`🎯 Matcher: skipped — ${matchSkippedReason}`);
    else {
      const outcome = formatMatchOutcomeLine(matchSummary);
      // Credit stop (etc.) must not look like a finished full run
      lines.push(matchSummary.stoppedReason ? `${outcome}\n⚠️ Matching stopped: ${matchSummary.stoppedReason}` : outcome);
    }
  }
  const summary = lines.join("\n");
  console.log(`\n${summary}`);
  if (!dryRun && !values["no-telegram"]) {
    await sendTelegramMessage(summary);
    if (!values["no-match"] && !matchSkippedReason) await pushMatchDigest(prisma, matchSummary.matchedCardIds);
  }
  const failed = names.filter((n) => results[n]![1] && !results[n]![1]!.startsWith("skipped"));
  process.exitCode = failed.length && failed.length === names.length ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
