/**
 * Old Mongo timestamps are naive: the Python app stored wall-clock time
 * without a zone, and the driver hands it back as a Date whose UTC fields
 * hold that wall-clock time. These helpers turn them into real instants
 * (docs/pg-schema.md, D10).
 */

const BERLIN = "Europe/Berlin";

const berlinParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BERLIN,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Minutes Berlin is ahead of UTC at this instant (60 or 120). */
export function berlinOffsetMinutes(instantMs: number): number {
  const seconds = Math.floor(instantMs / 1000) * 1000;
  const p = Object.fromEntries(
    berlinParts.formatToParts(new Date(seconds)).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  );
  return Math.round((asUtc - seconds) / 60_000);
}

/**
 * A naive Berlin wall-clock value (UTC fields = wall time) -> the instant.
 * Two passes settle the offset around DST changes. For the hour that does
 * not exist (spring forward) the result is shifted forward, for the hour
 * that happens twice (fall back) the first occurrence wins.
 */
export function fromBerlinWall(naive: Date): Date {
  const wall = naive.getTime();
  let guess = wall - berlinOffsetMinutes(wall) * 60_000;
  guess = wall - berlinOffsetMinutes(guess) * 60_000;
  return new Date(guess);
}

/** A naive value that was written as UTC (datetime.utcnow()) is already the instant. */
export function fromNaiveUtc(naive: Date): Date {
  return new Date(naive.getTime());
}

/** "YYYY-MM-DD HH:MM[:SS]" or "YYYY-MM-DD" typed by a person, read as Berlin wall time. */
export function parseBerlinText(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const naive = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s));
  return Number.isNaN(naive.getTime()) ? null : fromBerlinWall(naive);
}

/** Any stored time value -> instant, or null. */
export function toInstant(value: unknown, { utc = false } = {}): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return utc ? fromNaiveUtc(value) : fromBerlinWall(value);
  }
  if (typeof value === "string") return parseBerlinText(value);
  return null;
}

/** "YYYY-MM-DD" -> a Date at UTC midnight, for `date` columns. */
export function toDateOnly(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
}
