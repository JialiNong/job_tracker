"use client";
import { useSyncExternalStore } from "react";

/** A CSS media query as React state (false on the server). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phones and tablets: no hover, so charts use tap / double-tap instead. */
export const useTouchUi = () => useMediaQuery("(hover: none)");
