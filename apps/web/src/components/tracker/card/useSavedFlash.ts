"use client";
import { useEffect, useRef, useState } from "react";

/** "Saved ✓" on a button for two seconds after a save. */
export function useSavedFlash(ms = 2000): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = () => {
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), ms);
  };
  return [saved, flash];
}
