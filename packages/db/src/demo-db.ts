/**
 * Safety helpers for the public demo database seed.
 * The demo Neon / local DB name must end in `_demo` so a mistyped
 * DATABASE_URL cannot wipe production or tracker_dev / tracker_test.
 */

export function demoDbName(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, "").split("?")[0] ?? "";
  } catch {
    return "";
  }
}

/** True when seeding this URL is allowed (name ends with `_demo`). */
export function isDemoDatabaseUrl(databaseUrl: string): boolean {
  const name = demoDbName(databaseUrl);
  return name.length > 0 && name.endsWith("_demo");
}
