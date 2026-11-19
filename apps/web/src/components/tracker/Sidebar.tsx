"use client";
/** Page navigation plus the status chips with their counts (markup from templates/_shell.html). */
import { useState } from "react";
import type { Stats } from "@/lib/tracker/types";

interface Chip {
  status: string;
  label: string;
  side?: boolean;
  title?: string;
}

const CHIPS: Chip[] = [
  { status: "active", label: "Active", title: "Not Applied, Applied, Screening, Interview, Offer and Rejected — hides Unsuitable, Closed, Repost and other side statuses" },
  { status: "pending", label: "Not applied" },
  { status: "applied", label: "Applied" },
  { status: "screening", label: "Screening", title: "Asked for questions / Loom, or already submitted — not a live interview" },
  { status: "interview", label: "Interview" },
  { status: "interview_cancelled", label: "Cancelled", title: "Interview cancelled before it happened — Got interview still counts" },
  { status: "offer", label: "Offer" },
  { status: "rejected", label: "Rejected" },
  { status: "got_interview", label: "Got interview", title: "Invite, rounds, later rejected, and offer — any job that reached an interview" },
  { status: "all", label: "All jobs", side: true },
  { status: "unsuitable", label: "Unsuitable", side: true },
  { status: "closed", label: "Closed", side: true },
  { status: "closed_no_reply", label: "Closed, no reply", side: true },
  { status: "prev_rejected", label: "Rejected before", side: true },
  { status: "too_many_questions", label: "Skipped, long form", side: true },
  { status: "repost", label: "Repost", side: true },
  { status: "duplicate", label: "Duplicate", side: true },
];

interface Props {
  stats: Stats | null;
  status: string;
  onStatus: (status: string) => void;
  showStatuses: boolean; // hidden on the Overview / Stacks tabs
}

export function Sidebar({ stats, status, onStatus, showStatuses }: Props) {
  const [expanded, setExpanded] = useState(false);
  const count = (key: string) => {
    if (!stats) return "–";
    return String(key === "all" ? stats.total : stats.by_status[key] ?? 0);
  };
  const pick = (next: string) => {
    setExpanded(false); // phone: fold the list after picking
    onStatus(next);
  };

  return (
    <aside className="side">
      <a className="brand" href="/"><img className="brand-mark" src="/static/img/logo.svg" alt="" />Job Tracker</a>
      <nav className="nav" aria-label="Pages">
        <a href="/" aria-current="page">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 14h8" /></svg>Tracker
        </a>
        {/* From the Tracker the other pages open in a new tab so the list stays put */}
        <a href="/manual-apply" target="_blank" rel="noopener" title="Opens in a new tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Log a job
        </a>
        <a href="/timeouts" target="_blank" rel="noopener" title="Opens in a new tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>Timeouts
          <b className="nav-count" id="timeoutNavCount">{stats ? stats.timeouts : ""}</b>
        </a>
        <a href="/unmatched" target="_blank" rel="noopener" title="Opens in a new tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h6" /></svg>Unmatched
          <b className="nav-count" id="unmatchedNavCount">{stats ? stats.unmatched : ""}</b>
        </a>
      </nav>
      <div className="side-extra" hidden={!showStatuses}>
        <div className="side-label">Status</div>
        <div className={expanded ? "stats-bar stats-expanded" : "stats-bar"} id="statsBar">
          {CHIPS.map((chip) => (
            <button
              key={chip.status} type="button" data-status={chip.status} title={chip.title}
              className={["stat-chip", chip.side ? "stat-side" : "", status === chip.status ? "active" : ""].filter(Boolean).join(" ")}
              onClick={() => pick(chip.status)}
            >
              <span className={`dot dot-${chip.status}`} />
              <span className="chip-label">{chip.label}</span>
              <b id={`cnt-${chip.status}`}>{count(chip.status)}</b>
            </button>
          ))}
          <button type="button" className="stats-more-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show fewer statuses" : "Show more statuses"}
          </button>
        </div>
      </div>
      <a className="side-logout" href="/logout">Log out</a>
    </aside>
  );
}
