"use client";
/** Pieces every job list page shares: the List / Cards layout, the sheet scrim, Esc to close. */
import { useEffect, useState } from "react";

export type Layout = "compact" | "cards";

/** List or Cards, remembered per browser (same key as the old pages). */
export function useLayout(onChange?: () => void) {
  const [layout, setLayoutState] = useState<Layout>("compact");
  useEffect(() => {
    try {
      if (localStorage.getItem("jobLayout") === "cards") setLayoutState("cards");
    } catch { /* storage blocked: keep the default */ }
  }, []);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    onChange?.();
    try { localStorage.setItem("jobLayout", next); } catch { /* ignore */ }
  };
  return [layout, setLayout] as const;
}

export function LayoutToggle({ layout, onLayout }: { layout: Layout; onLayout: (layout: Layout) => void }) {
  return (
    <div className="layout-toggle" id="layoutToggle">
      {(["compact", "cards"] as const).map((mode) => (
        <button
          key={mode} type="button" data-layout={mode} className={layout === mode ? "active" : undefined}
          title={mode === "compact" ? "List with a details panel" : "Cards: score, title, company, location — tap for a details sheet"}
          onClick={() => onLayout(mode)}
        >
          {mode === "compact" ? "List" : "Cards"}
        </button>
      ))}
    </div>
  );
}

/** Esc closes the open card (not while typing, a dialog, or the filter popover is up). */
export function useEscapeClose(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".tl-modal-backdrop")) return;
      const pop = document.getElementById("filterPop");
      if (pop && !pop.hidden) return;
      if (["input", "textarea", "select"].includes((document.activeElement?.tagName ?? "").toLowerCase())) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
}

/**
 * Below 1080px the details panel is a sheet over the list: a scrim behind it
 * closes it, and the page behind does not scroll (html.ui-lock).
 */
export function PanelScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1080px)");
    const update = () => setStacked(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const show = open && stacked;
  useEffect(() => {
    if (!show) return;
    const y = window.scrollY;
    document.documentElement.classList.add("ui-lock");
    document.body.style.top = `-${y}px`;
    return () => {
      document.documentElement.classList.remove("ui-lock");
      document.body.style.top = "";
      window.scrollTo(0, y);
    };
  }, [show]);
  return <div id="panelScrim" className="panel-scrim" hidden={!show} role="button" aria-label="Close details" onClick={onClose} />;
}
