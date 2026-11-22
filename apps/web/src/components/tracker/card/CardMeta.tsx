/** Pills under the title: highlights, source, origin, agent, matched / posted dates, applicants. */
import {
  BOARD_LABEL, ORIGIN_PILL, RECOMMENDED_BY_LABEL, SOURCE_BADGE, formatApplicants, hostOf, needsLinkFix, postedAgo,
} from "@/lib/tracker/format";
import type { Job } from "@/lib/tracker/types";
import { HighlightBadges } from "./CardRow";

function SourcePill({ job }: { job: Job }) {
  const source = job.source || "";
  // LinkedIn / Indeed are the board ("via …" in the row), not a channel
  if (BOARD_LABEL[source.toLowerCase()]) return null;
  if (source === "manual" && RECOMMENDED_BY_LABEL[job.recommended_by.toLowerCase()]) {
    const host = hostOf(job.link);
    return host ? <span className="meta-pill source-pill site-pill" title={job.link}>{host}</span> : null;
  }
  const key = source.toLowerCase();
  const badge = SOURCE_BADGE[key];
  if (badge) {
    const host = hostOf(job.link);
    return <span className={`meta-pill source-badge src-${key}`} title={badge.title + (host ? ` · ${host}` : "")}>{badge.label}</span>;
  }
  return <span className="meta-pill source-pill">{source}</span>;
}

export function CardMeta({ job, highlights }: { job: Job; highlights: string[] }) {
  const origin = ORIGIN_PILL[job.origin];
  const agent = RECOMMENDED_BY_LABEL[job.recommended_by.toLowerCase()];
  const reason = job.recommend_reason.trim();
  const posted = postedAgo(job.posted_at);
  const applicants = formatApplicants(job.applicants);
  const pos = job.applicant_position;
  return (
    <div className="card-meta">
      <span className="body-highlights"><HighlightBadges tags={highlights} /></span>
      <SourcePill job={job} />
      {needsLinkFix(job.link) ? (
        <span
          className="meta-pill fix-link-pill"
          title="Indeed gave this job only a short link with no job id. Open it, copy the viewjob?jk=… URL and paste it under Replace posting link."
        >
          Fix link
        </span>
      ) : null}
      {origin ? <span className={`meta-pill origin-pill origin-${job.origin}`} title={origin.title}>{origin.label}</span> : null}
      {agent ? (
        <span className="meta-pill recommended-pill" title={`Recommended by ${agent}${reason ? ` — ${reason}` : ""}`}>{agent}</span>
      ) : null}
      {job.matched_at ? <span className="meta-pill" title="Matched on">Matched {job.matched_at}</span> : null}
      {posted ? <span className="meta-pill" title={`Published by the employer on ${posted.date}`}>{posted.label}</span> : null}
      {applicants ? <span className="meta-pill" title="Applicant count when the job was scraped">{applicants}</span> : null}
      <span
        className="meta-pill applicant-pos-pill" hidden={!pos}
        title={`You were roughly applicant #${pos ?? ""} when you applied`}
      >
        #{pos ?? ""} at apply
      </span>
    </div>
  );
}
