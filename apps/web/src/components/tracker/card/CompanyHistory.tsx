/** "You've seen this company before": other Tracker cards at the same company. */
import { companyPageUrl, historyFlags, historyStatus, historySummary } from "@/lib/tracker/format";
import type { HistoryItem, Job } from "@/lib/tracker/types";

function historyDates(item: HistoryItem): string {
  const status = historyStatus(item);
  const dates: string[] = [];
  if (item.applied_at) dates.push(`applied ${item.applied_at}`);
  if (item.progress && item.progress !== "applied" && item.last_step_at) {
    dates.push(`${status.label.toLowerCase()} ${item.last_step_at}`);
  }
  if (!dates.length && item.matched_at) dates.push(`seen ${item.matched_at}`);
  if (item.applicant_position) dates.push(`#${item.applicant_position} applicant`);
  return dates.join(" · ");
}

export function CompanyHistory({ job }: { job: Job }) {
  const history = job.company_history ?? [];
  if (!history.length) return null;
  const total = job.company_history_total || history.length;
  const { rejected } = historyFlags(history);
  return (
    <div className={rejected ? "company-history seen-rejected" : "company-history"} onClick={(e) => e.stopPropagation()}>
      <div className="ch-head">
        You&apos;ve seen this company before — {total} other job{total === 1 ? "" : "s"}{" "}
        <span className="ch-summary">({historySummary(history)})</span>
      </div>
      <ul>
        {history.slice(0, 5).map((item) => {
          const status = historyStatus(item);
          return (
            <li key={item._id}>
              <span className={`ch-status ${status.cls}`}>{status.label}</span>
              <span className="ch-title">{item.title || "(No Title)"}</span>
              <span className="ch-dates">{historyDates(item)}</span>
            </li>
          );
        })}
      </ul>
      <a className="ch-all" href={companyPageUrl(job.company)} target="_blank" rel="noopener" title="Open in a new tab">
        Show all jobs at {job.company} ↗
      </a>
    </div>
  );
}
