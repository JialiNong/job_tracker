import { randomBytes } from "node:crypto";

/**
 * A new 24-hex id in the Mongo ObjectId layout: 4 bytes of Unix seconds,
 * then 8 random bytes. Keeps one id format with the migrated rows
 * (docs/pg-schema.md, D3), and new ids sort after older ones, which the
 * charts rely on for "insertion order".
 */
export function newRecordId(now = Date.now()): string {
  const seconds = Math.floor(now / 1000).toString(16).padStart(8, "0");
  return seconds + randomBytes(8).toString("hex");
}
