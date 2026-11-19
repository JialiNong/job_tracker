/**
 * The page links at the top of the sidebar (templates/_shell.html). From the
 * Tracker the other pages open in a new tab so the job list stays put;
 * switching among Log / Timeouts / Unmatched stays in the tab.
 */
export type PageKey = "tracker" | "log" | "timeouts" | "unmatched";

interface Props {
  active: PageKey;
  /** Sidebar counts; only the Tracker loads them. */
  counts?: { timeouts: number; unmatched: number } | null;
}

export function PageNav({ active, counts }: Props) {
  const fromTracker = active === "tracker";
  const link = (page: PageKey) => ({
    ...(fromTracker && page !== "tracker" ? { target: "_blank", rel: "noopener", title: "Opens in a new tab" } : {}),
    ...(active === page ? { "aria-current": "page" as const } : {}),
  });
  return (
    <>
      <a className="brand" href="/"><img className="brand-mark" src="/static/img/logo.svg" alt="" />Job Tracker</a>
      <nav className="nav" aria-label="Pages">
        <a href="/" {...link("tracker")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 14h8" /></svg>Tracker
        </a>
        <a href="/manual-apply" {...link("log")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Log a job
        </a>
        <a href="/timeouts" {...link("timeouts")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>Timeouts
          <b className="nav-count" id="timeoutNavCount">{counts ? counts.timeouts : ""}</b>
        </a>
        <a href="/unmatched" {...link("unmatched")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h6" /></svg>Unmatched
          <b className="nav-count" id="unmatchedNavCount">{counts ? counts.unmatched : ""}</b>
        </a>
      </nav>
    </>
  );
}

/** The whole sidebar for the pages without extra sidebar content. */
export function PageSide({ active }: { active: PageKey }) {
  return (
    <aside className="side">
      <PageNav active={active} />
      <a className="side-logout" href="/logout">Log out</a>
    </aside>
  );
}
