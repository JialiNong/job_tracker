/**
 * Environment for the pipeline commands: the repo-root .env (OPENAI_API_KEY,
 * TELEGRAM_*, ...) plus DATABASE_URL. Variables already set win.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
for (const file of [".env", "apps/web/.env.local"]) {
  const path = join(root, file);
  if (existsSync(path)) config({ path });
}

export function requireEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(2);
  }
  return value;
}
