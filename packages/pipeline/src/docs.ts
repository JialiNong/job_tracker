/**
 * The matcher's two prompt files: the CV (docs/user_profile.md, git-ignored)
 * and the rules (docs/matching_rules.md). MATCH_PROFILE_PATH /
 * MATCH_RULES_PATH override them; otherwise the first docs/ found going up
 * from the working directory (repo root, apps/web or a package).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

function docPath(name: string, envPath: string | undefined): string | null {
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath);
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, "docs", name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function readDoc(name: string, envPath: string | undefined): Promise<string> {
  const path = docPath(name, envPath);
  if (!path) return "";
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function loadMatchingDocs(env: NodeJS.ProcessEnv = process.env) {
  const [cv, rules] = await Promise.all([
    readDoc("user_profile.md", env.MATCH_PROFILE_PATH),
    readDoc("matching_rules.md", env.MATCH_RULES_PATH),
  ]);
  return { cv, rules };
}
