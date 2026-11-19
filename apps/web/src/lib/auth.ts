/**
 * Credentials check, same account as the Flask app: TRACKER_USERNAME and a
 * bcrypt TRACKER_PASSWORD_HASH ($2b$, which bcryptjs reads).
 */
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Compare equal-length buffers so the time taken does not leak the length
  const padded = Buffer.alloc(Math.max(left.length, right.length));
  left.copy(padded);
  const other = Buffer.alloc(padded.length);
  right.copy(other);
  return timingSafeEqual(padded, other) && left.length === right.length;
}

export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const expectedUser = process.env.TRACKER_USERNAME ?? "";
  const hash = (process.env.TRACKER_PASSWORD_HASH ?? "").replace(/^'|'$/g, "");
  if (!expectedUser || !hash) return false;
  // Always run bcrypt, even for a wrong username, so both cases take as long
  const passwordOk = await bcrypt.compare(password, hash);
  return sameText(username, expectedUser) && passwordOk;
}
