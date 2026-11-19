"use client";
/**
 * What a card can ask of the page: reload itself after a write, leave the
 * list, filter by its company, take part in "Select jobs". TrackerApp
 * provides it; cards stay unaware of how the list is stored.
 */
import { createContext, useContext } from "react";

export interface TrackerActions {
  /** After a write: reload the card from the API (drop it if it no longer fits the filter) and the counts. */
  afterWrite: (id: string) => Promise<void>;
  /** Drop a card from the list (it was deleted). */
  removeCard: (id: string) => void;
  /** Reload the sidebar counts only. */
  refreshStats: () => void;
  filterByCompany: (name: string) => void;
  selectMode: boolean;
  isSelected: (id: string) => boolean;
  toggleSelected: (id: string, on: boolean) => void;
}

export const TrackerContext = createContext<TrackerActions | null>(null);

export function useTracker(): TrackerActions {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error("useTracker needs <TrackerContext.Provider>");
  return ctx;
}
