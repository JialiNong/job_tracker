"use client";
/** Cards grouped by the day they were matched; groups fold. Plus empty / error / loading states. */
import { Fragment, useState } from "react";
import { groupByDay, groupHeading } from "@/lib/tracker/format";
import type { Job } from "@/lib/tracker/types";
import { JobCard } from "./card/JobCard";
import type { Layout } from "./Toolbar";

interface Props {
  jobs: Job[] | null; // null while the first page loads
  error: string;
  layout: Layout;
  selectMode: boolean;
  expandedId: string;
  onExpand: (id: string) => void;
  flashId: string;
  /** A deep-linked card that is not on this page / filter, shown above the list. */
  pinned: Job | null;
}

export function JobList({ jobs, error, layout, selectMode, expandedId, onExpand, flashId, pinned }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (day: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(day)) next.delete(day); else next.add(day);
    return next;
  });

  const card = (job: Job) => (
    <JobCard
      key={job._id} job={job} expanded={expandedId === job._id} flash={flashId === job._id}
      onToggle={() => onExpand(expandedId === job._id ? "" : job._id)} onClose={() => onExpand("")}
    />
  );

  const className = ["job-grid", `layout-${layout}`, selectMode ? "select-mode" : ""].filter(Boolean).join(" ");
  let content: React.ReactNode;
  if (error) {
    content = <div className="empty"><h2>Loading Failed</h2><p>{error}</p></div>;
  } else if (jobs === null) {
    content = <div className="spinner" />;
  } else if (!jobs.length && !pinned) {
    content = <div className="empty"><h2>No Matched Jobs</h2><p>Try different filters?</p></div>;
  } else {
    content = groupByDay(jobs).map(([day, group]) => (
      <Fragment key={day}>
        <div className={collapsed.has(day) ? "date-group-header collapsed" : "date-group-header"} onClick={() => toggleGroup(day)}>
          <span className="dg-toggle">▾</span>
          <span>{groupHeading(day)}</span>
          <span className="dg-count">{group.length} jobs</span>
        </div>
        <div className={collapsed.has(day) ? "date-group-cards hidden" : "date-group-cards"}>{group.map(card)}</div>
      </Fragment>
    ));
  }

  return (
    <div className={className} id="jobGrid">
      {pinned ? (
        <>
          <div className="open-job-banner">
            <span>Opened job from URL (not on this page/filter) — <strong>{pinned.title}</strong></span>
            <a href="/">Show all matches</a>
          </div>
          {card(pinned)}
        </>
      ) : null}
      {content}
    </div>
  );
}
