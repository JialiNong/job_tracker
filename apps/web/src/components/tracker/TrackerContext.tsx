"use client";
/**
 * What a card needs from the page besides server data (which comes from
 * TanStack Query): filter by its company, take part in "Select jobs", Run AI and Fetch details.
 */
import { createContext, use } from "react";

export interface TrackerActions {
  filterByCompany: (name: string) => void;
  selectMode: boolean;
  isSelected: (id: string) => boolean;
  toggleSelected: (id: string, on: boolean) => void;
  runAi: (id: string) => void;
  fetchDetails: (id: string) => void;
  /** Run AI or Fetch details is running for this card */
  isRunningAi: (id: string) => boolean;
  batchRunning: boolean;
}

export const TrackerContext = createContext<TrackerActions | null>(null);

export function useTracker(): TrackerActions {
  const ctx = use(TrackerContext);
  if (!ctx) throw new Error("useTracker needs <TrackerContext>");
  return ctx;
}
