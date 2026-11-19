/**
 * Load tests/contract/fixture.json into a *test* database, through the same
 * transform as the real migration. The contract runner calls this as its
 * --seed-cmd before every write case.
 *
 *   DATABASE_URL=postgresql://.../tracker_test pnpm db contract:seed
 *
 * Refuses any database whose name does not end in "_test".
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EJSON } from "bson";
import { PrismaClient } from "@prisma/client";
import { replaceAll } from "../load.js";
import { transform, type MongoSource } from "../transform.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(here, "../../../../tests/contract/fixture.json");

const COLLECTIONS = ["jobs", "matched_jobs", "timeout_jobs", "scraper_stats", "company_profiles", "stats_cache"] as const;

export function readFixture(path: string): MongoSource {
  const parsed = EJSON.parse(readFileSync(path, "utf8"), { relaxed: true }) as {
    collections: Partial<MongoSource>;
  };
  const source = {} as MongoSource;
  for (const name of COLLECTIONS) source[name] = (parsed.collections[name] ?? []) as MongoSource[typeof name];
  return source;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`refusing to seed "${dbName}": the database name must end in _test`);
  }
  const path = process.env.CONTRACT_FIXTURE || DEFAULT_FIXTURE;
  const { rows, report } = transform(readFixture(path));
  const prisma = new PrismaClient();
  try {
    await replaceAll(prisma, rows);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`seeded ${dbName}: ${Object.entries(report.rows).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
