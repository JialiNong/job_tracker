/**
 * TEMPORARY (phase 2c, step 1): serve the Flask Tracker page unchanged, with
 * its own JS / CSS from public/static, so the browser e2e suite exercises
 * the new API and Postgres before any UI changes. Replaced by the React
 * page in step 2; delete legacy/ then.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const html = await readFile(join(process.cwd(), "legacy", "tracker.html"), "utf8");
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
