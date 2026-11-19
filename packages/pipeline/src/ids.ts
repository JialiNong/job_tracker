import { randomBytes } from "node:crypto";

/** 24-hex id like a Mongo ObjectId: seconds, then random (the ids stay 24-hex, docs/pg-schema.md D3). */
export function newRecordId(now = Date.now()): string {
  return Math.floor(now / 1000).toString(16).padStart(8, "0") + randomBytes(8).toString("hex");
}
