/** Port of scrub_bullet_location (src/core/indeed_meta.py): never treat a separator or rating chip as a place. */
import { pyStrip } from "./py.js";

const SEPARATOR_ONLY = /^[\t\n\x0b\x0c\r •·∙⋅|\-–—]+$/;
const RATING = /^[0-5](?:[.,]\d)?[\t\n\x0b\x0c\r ]*(?:★|⭐)?[\t\n\x0b\x0c\r ]*(?:\([\d.,\t\n\x0b\x0c\r ]+\))?$/u;

export function scrubBulletLocation(location: string | null | undefined): string {
  const text = pyStrip(location ?? "");
  if (!text || SEPARATOR_ONLY.test(text) || RATING.test(pyStrip(text))) return "";
  return text;
}
