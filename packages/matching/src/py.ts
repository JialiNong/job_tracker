/**
 * Python string behaviour the matcher depends on, so the TypeScript port
 * gives the same answers as src/matching and src/core:
 * - len() counts code points (an emoji is 1), String.length counts UTF-16 units
 * - str.isspace / re's \s / str.split() / str.strip() use a slightly
 *   different whitespace set than JavaScript (\x1c-\x1f and \x85 are
 *   whitespace in Python; ﻿ is not)
 * - str.splitlines() breaks on more than \n
 * - round(x, 1) and "%.1f" round ties to even
 */

/** Python whitespace, as a regex character-class body (no "u" flag needed). */
export const PY_WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

const WS_RUN = new RegExp(`[${PY_WS}]+`, "g");
const EDGE_WS = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");
const LINE_BREAKS = new RegExp("\\r\\n|[\\n\\r\\x0b\\x0c\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]");

export const pyLen = (s: string) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Code-point index of a UTF-16 index (re.Match.start() in Python). */
export const pyIndex = (s: string, utf16Index: number) => pyLen(s.slice(0, utf16Index));

/** s[:n] by code points. */
export function pySlice(s: string, n: number): string {
  let out = "";
  let i = 0;
  for (const ch of s) {
    if (i++ >= n) break;
    out += ch;
  }
  return out;
}

export const pyStrip = (s: string) => s.replace(EDGE_WS, "");

/** str.split() with no arguments: runs of whitespace, no empty strings. */
export const pySplit = (s: string) => s.split(WS_RUN).filter(Boolean);

/** str.splitlines(): line breaks dropped; no trailing empty line. */
export function pySplitLines(s: string): string[] {
  if (!s) return [];
  const lines = s.split(LINE_BREAKS);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** str(value) for the values that reach an f-string here. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return String(value);
}

/** x rounded to 1 decimal, ties to even on the exact binary value (Python round / "%.1f"). */
export function pyRound1(x: number): number {
  const scaled = x * 10;
  const floor = Math.floor(scaled);
  // A tie only when x * 10 is exactly k + 0.5 (true for exact quarters like 2.25)
  if (scaled - floor === 0.5) return (floor % 2 === 0 ? floor : floor + 1) / 10;
  return Number(x.toFixed(1));
}

/** f"{x:+.1f}" */
export function pySigned1(x: number): string {
  const r = pyRound1(x);
  const text = Math.abs(r).toFixed(1);
  return (r < 0 || Object.is(r, -0) ? "-" : "+") + text;
}
