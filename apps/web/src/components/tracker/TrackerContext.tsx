"use client";
/**
 * What a card needs from the page besides server data (which comes from
 * TanStack Query): filter by its company, and take part in "Select jobs".
 */
import { createContext, use } from "react";

export interface TrackerActions {
  filterByCompany: (name: string) => void;
  selectMode: boolean;
  isSelected: (id: string) => boolean;
  toggleSelected: (id: string, on: boolean) => void;
}

export const TrackerContext = createContext<TrackerActions | null>(null);

export function useTracker(): TrackerActions {
  const ctx = use(TrackerContext);
  if (!ctx) throw new Error("useTracker needs <TrackerContext>");
  return ctx;
}
