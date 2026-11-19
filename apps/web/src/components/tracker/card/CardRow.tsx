/** The always-visible row of a card: score, title, company line, channel and status. */
import { applicantsRow, historyFlags, historySummary, jobChannel, viaText } from "@/lib/tracker/format";
import { statusPill } from "@/lib/tracker/timeline";
import type { Job } from "@/lib/tracker/types";
import { ScoreRing } from "./ScoreRing";

interface Props {
  job: Job;
  highlights: string[];
  expanded: boolean;
  onToggle: () => void;
}

export function CardRow({ job, highlights, expanded, onToggle }: Props) {
  const channel = jobChannel(job);
  const pill = statusPill(job.status, job.application_timeline);
  return (
    <div
      className="card-row" role="button" tabIndex={0} aria-expanded={expanded} aria-controls={`body-${job._id}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="row-chevron" aria-hidden="true">▸</span>
      <ScoreRing score={job.match_score} />
      <div className="row-main">
        <div className="row-title-line">
          <span className="row-title">{job.title || "(No Title)"}</span>
          <span className="row-highlights"><HighlightBadges tags={highlights} /></span>
        </div>
        <RowSub job={job} />
      </div>
      <div className="row-meta">
        <span className="row-channel">
          {channel ? <span className={`channel-chip ${channel.cls}`} title={channel.title}>{channel.label}</span> : null}
        </span>
        <span className={`status-pill s-${pill.cls}`}>{pill.label}</span>
      </div>
    </div>
  );
}

export function HighlightBadges({ tags }: { tags: string[] }) {
  return <>{tags.map((tag) => <span key={tag} className="highlight-badge" title={tag}>★ {tag}</span>)}</>;
}

function RowSub({ job }: { job: Job }) {
  const via = viaText(job);
  const applicants = applicantsRow(job);
  const history = job.company_history ?? [];
  const total = job.company_history_total || history.length;
  const flags = historyFlags(history);
  const seenCls = flags.rejected ? " seen-rejected" : flags.applied ? " seen-applied" : "";
  return (
    <div className="row-sub">
      <span className="row-company">{job.company}</span>
      <span className="row-loc" title={job.location}>{job.location}</span>
      {via ? <span className="row-via">via {via}</span> : null}
      <span className="row-applicants" title={applicants.title} hidden={!applicants.label}>{applicants.label}</span>
      {history.length ? (
        <span
          className={`row-seen${seenCls}`}
          title={`Seen ${total} other job(s) at this company: ${historySummary(history)}`}
        >
          seen {total}× before
        </span>
      ) : null}
    </div>
  );
}
