/**
 * Load the fictional demo dataset into a *_demo Postgres database.
 *
 * Builds Mongo-shaped JSON via scripts/db/export_demo_json.py (dates relative
 * to today), then runs the same transform + replaceAll path as contract:seed.
 *
 *   DATABASE_URL=postgresql://…/tracker_demo pnpm db demo:seed
 *   DATABASE_URL=…/tracker_demo pnpm db demo:seed -- --today 2026-11-17T15:00:00
 *
 * Refuses any database whose name does not end in `_demo`.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EJSON } from "bson";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { demoDbName, isDemoDatabaseUrl } from "../demo-db.js";
import { replaceAll } from "../load.js";
import { transform, type MongoSource } from "../transform.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "../..");
const root = resolve(pkg, "../..");
config({ path: resolve(pkg, ".env") });
config({ path: resolve(root, ".env") });
config({ path: resolve(root, "apps/web/.env.local") });

const COLLECTIONS = ["jobs", "matched_jobs", "timeout_jobs", "scraper_stats", "company_profiles", "stats_cache"] as const;

function parseArgs(argv: string[]): { today?: string; seed?: string } {
  const out: { today?: string; seed?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--today" && argv[i + 1]) {
      out.today = argv[++i];
    } else if (a === "--seed" && argv[i + 1]) {
      out.seed = argv[++i];
    }
  }
  return out;
}

function exportDemoJson(opts: { today?: string; seed?: string }): MongoSource {
  const script = resolve(root, "scripts/db/export_demo_json.py");
  const args = [script];
  if (opts.seed) args.push("--seed", opts.seed);
  if (opts.today) args.push("--today", opts.today);
  const python = process.env.PYTHON?.trim() || "python3";
  const result = spawnSync(python, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: [resolve(root, "src"), process.env.PYTHONPATH].filter(Boolean).join(":") },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`export_demo_json.py failed (exit ${result.status}):\n${result.stderr || result.stdout}`);
  }
  const parsed = EJSON.parse(result.stdout, { relaxed: true }) as {
    collections: Partial<MongoSource>;
  };
  const source = {} as MongoSource;
  for (const name of COLLECTIONS) {
    source[name] = (parsed.collections[name] ?? []) as MongoSource[typeof name];
  }
  return source;
}

async function main() {
  const urls = [process.env.DATABASE_URL, process.env.DIRECT_DATABASE_URL]
    .map((u) => (u ?? "").trim())
    .filter(Boolean);
  if (!urls.length) throw new Error("DATABASE_URL (or DIRECT_DATABASE_URL) is not set");
  for (const url of urls) {
    if (!isDemoDatabaseUrl(url)) {
      throw new Error(
        `refusing to seed "${demoDbName(url) || "(empty)"}": every set DATABASE_URL / DIRECT_DATABASE_URL must end in _demo`,
      );
    }
  }
  const url = process.env.DATABASE_URL?.trim() || process.env.DIRECT_DATABASE_URL!.trim();

  const opts = parseArgs(process.argv.slice(2));
  const source = exportDemoJson(opts);
  const { rows, report } = transform(source);
  const prisma = new PrismaClient();
  try {
    await replaceAll(prisma, rows);
    await prisma.agentPushRun.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
  console.log(
    `seeded ${demoDbName(url)}: ${Object.entries(report.rows).map(([k, v]) => `${k} ${v}`).join(", ")}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
