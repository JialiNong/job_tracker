/**
 * Copy the live Mongo data into Postgres, then check the result.
 *
 *   pnpm db from-mongo              # into DATABASE_URL (local docker by default)
 *   pnpm db from-mongo --dry-run    # transform + report only, write nothing
 *   pnpm db from-mongo --quiet      # counts only in the log (CI: no job names or ids)
 *
 * Mongo is only read (find). Postgres tables are replaced in one
 * transaction (src/load.ts), so the command can run every day during the
 * parallel week. The full report goes to packages/db/reports/ (git-ignored:
 * it contains job data).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { PrismaClient } from "@prisma/client";
import { replaceAll } from "../load.js";
import { transform, type MongoSource, type Report } from "../transform.js";
import { verify } from "../verify.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "../..");
config({ path: resolve(pkg, ".env") });            // DATABASE_URL (local docker)
config({ path: resolve(pkg, "../../.env") });      // MONGO_URI (the Python app's .env)

const COLLECTIONS = ["jobs", "matched_jobs", "timeout_jobs", "scraper_stats", "company_profiles", "stats_cache"] as const;

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

function summarize(report: Report, quiet: boolean): string[] {
  return [
    `source:  ${Object.entries(report.source).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `rows:    ${Object.entries(report.rows).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `merged duplicate (source, job_id): ${report.duplicateKeysMerged.length}`,
    `merged posting_key duplicates:     ${report.postingKeyMerged.length}` +
      (quiet ? [] : report.postingKeyMerged).map((p) => `\n    ${p.postingKey}: kept ${p.kept}, dropped ${p.dropped.map((d) => `${d.job}${d.status ? ` (card ${d.status}, ${d.events} events${d.notes ? ", has notes" : ""})` : ""}`).join(", ")}`).join(""),
    `posting_key cleared (kept both):   ${report.postingKeyCleared.length}`,
    `tracker edits kept over scraped:   ${report.twinConflicts.length} fields on ${new Set(report.twinConflicts.map((c) => c.application)).size} cards`,
    `scraped company looks wrong:       ${report.scrapedCompanyLooksWrong.length}`,
    `applied_at != first applied event: ${report.appliedAtMismatch.length}`,
    `profiles recreated from snapshots: ${report.profilesRecreated.length}`,
    `analyses without a profile:        ${report.analysesWithoutProfile.length}`,
    `extra AI runs kept from scraped copy: ${report.extraAnalysisRuns.length}`,
    `cards without a scraped twin:      ${report.matchedWithoutJob.length}`,
    `unknown values:                    ${report.unknownValues.length}`,
  ];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const quiet = process.argv.includes("--quiet");
  const mongoUri = process.env.MONGO_URI;
  const pgUrl = process.env.DATABASE_URL;
  if (!mongoUri) throw new Error("MONGO_URI is not set (expected in the repo's .env)");
  if (!pgUrl) throw new Error("DATABASE_URL is not set (packages/db/.env)");
  const dbName = process.env.DATABASE_NAME || "job_scraper";

  console.log(`Mongo   ${quiet ? "(hidden)" : hostOf(mongoUri)} / ${dbName} (read only)`);
  console.log(`Target  ${dryRun ? "(dry run, nothing written)" : quiet ? "(hidden)" : hostOf(pgUrl)}`);

  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  await mongo.connect();
  const db = mongo.db(dbName);
  const source = {} as MongoSource;
  for (const name of COLLECTIONS) source[name] = await db.collection(name).find({}).toArray();
  await mongo.close();

  const started = Date.now();
  const { rows, report } = transform(source);
  console.log(`\nTransformed in ${Date.now() - started} ms`);
  for (const line of summarize(report, quiet)) console.log(`  ${line}`);

  let checks: Awaited<ReturnType<typeof verify>> = [];
  if (!dryRun) {
    const prisma = new PrismaClient();
    try {
      const t0 = Date.now();
      await replaceAll(prisma, rows);
      console.log(`\nLoaded in ${Date.now() - t0} ms`);
      checks = await verify(prisma, source, report);
    } finally {
      await prisma.$disconnect();
    }
    console.log("\nChecks");
    // Quiet: the examples in a detail name cards; keep only the leading count
    for (const c of checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${quiet ? c.detail.split(", e.g.")[0] : c.detail}`);
  }

  const dir = resolve(pkg, "reports");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `from-mongo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ report, checks }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
  console.log(`\nFull report: ${file}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
