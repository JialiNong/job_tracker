// The Flask app's stylesheets and images stay the single source until the
// cutover: copy them into public/static before dev / build. public/static is
// git-ignored.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const out = resolve(here, "../public/static");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ["css", "img"]) cpSync(resolve(repo, "static", dir), resolve(out, dir), { recursive: true });
console.log("copied static/css and static/img into apps/web/public/static");
