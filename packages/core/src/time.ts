/**
 * Dates on the API are Berlin wall-clock strings ("YYYY-MM-DD HH:MM"), as the
 * Flask app returned them. Internally everything is an instant (Date).
 */
const BERLIN = "Europe/Berlin";

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: BERLIN,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function berlinFields(d: Date) {
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

function offsetMinutes(instantMs: number): number {
  const sec = Math.floor(instantMs / 1000) * 1000;
  const f = berlinFields(new Date(sec));
  return Math.round((Date.UTC(+f.y, +f.mo - 1, +f.d, +f.h, +f.mi, +f.s) - sec) / 60_000);
}

/** Wall-clock fields in Berlin -> instant (DST-safe, same rule as packages/db). */
function wallMsToInstant(wallMs: number): Date {
  let guess = wallMs - offsetMinutes(wallMs) * 60_000;
  guess = wallMs - offsetMinutes(guess) * 60_000;
  return new Date(guess);
}

/**
 * Parse what the UI or old data may send, like status.py _parse_timeline_at:
 * ISO with a zone (an instant), or "YYYY-MM-DD[ HH:MM[:SS]]" (Berlin wall time).
 */
export function berlinWallToInstant(text: string): Date | null {
  const t = text.trim();
  if (!t) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(t) && t.includes("T")) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(t);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const ms = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s);
  return Number.isNaN(ms) ? null : wallMsToInstant(ms);
}

export function toInstant(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") return berlinWallToInstant(value);
  return null;
}

/** "YYYY-MM-DD HH:MM" in Berlin. */
export function formatBerlin(d: Date | null | undefined): string {
  if (!d) return "";
  const f = berlinFields(d);
  return `${f.y}-${f.mo}-${f.d} ${f.h}:${f.mi}`;
}

/** "YYYY-MM-DD" in Berlin. */
export function formatBerlinDate(d: Date | null | undefined): string {
  if (!d) return "";
  const f = berlinFields(d);
  return `${f.y}-${f.mo}-${f.d}`;
}

/** Start / end of a Berlin calendar day given as "YYYY-MM-DD". */
export function berlinDayBounds(day: string): { start: Date; end: Date } | null {
  const text = day.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const start = berlinWallToInstant(`${text} 00:00:00`);
  if (!start) return null;
  const [y, mo, d] = text.split("-").map(Number) as [number, number, number];
  const following = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
  const nextStart = berlinWallToInstant(`${following} 00:00:00`)!;
  return { start, end: new Date(nextStart.getTime() - 1) };
}
