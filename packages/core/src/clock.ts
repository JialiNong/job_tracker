/**
 * Single source of "now", same contract as src/core/clock.py:
 * TRACKER_FIXED_NOW (Berlin wall-clock, e.g. "2026-11-13T12:00") is honoured
 * only when TRACKER_ALLOW_FIXED_NOW=1, so tests can pin time and production
 * cannot freeze it by accident.
 */
import { berlinWallToInstant } from "./time.js";

export function now(): Date {
  if (process.env.TRACKER_ALLOW_FIXED_NOW === "1") {
    const raw = (process.env.TRACKER_FIXED_NOW ?? "").trim();
    if (raw) {
      const fixed = berlinWallToInstant(raw);
      if (fixed) return fixed;
    }
  }
  return new Date();
}
