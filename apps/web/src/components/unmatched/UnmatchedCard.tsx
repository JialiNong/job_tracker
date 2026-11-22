/** One Unmatched card: the row, and the details panel with "Can apply" when expanded. */
import { Breakdown, ScoreParts } from "@/components/tracker/card/AiResult";
import { ScoreRing } from "@/components/tracker/card/ScoreRing";
import type { UnmatchedJob } from "@/lib/pages/api";
import {
  RECOMMENDED_BY_LABEL, applicantsRow, formatApplicants, jobChannel, postedAgo, reasonsWithoutScore, safeUrl, viaText,
} from "@/lib/tracker/format";

const GATE_PILLS: Record<string, string> = {
  german: "German", stack: "Backend", not_web_dev: "Not web dev", leadership: "Leadership",
  backend_heavy: "Backend-heavy", too_many_years: "Years", contract_or_location: "Contract/location",
  blocked_company: "Blocked", empty_desc: "No JD", incomplete_desc: "Unusable JD", non_english: "Not English",
  ai_ml: "AI/ML", scored: "Scored",
};

interface Props {
  job: UnmatchedJob;
  expanded: boolean;
  flash: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMark: (value: "" | "watchlist") => void;
}

function GatePill({ gate }: { gate: string }) {
  const label = GATE_PILLS[gate];
  return label ? <span className={gate === "stack" ? "meta-pill gate-pill gate-stack" : "meta-pill gate-pill"}>{label}</span> : null;
}

function AgentAlso({ job }: { job: UnmatchedJob }) {
  const label = RECOMMENDED_BY_LABEL[(job.agent_recommended_by ?? "").toLowerCase()];
  return label
    ? <span className="meta-pill agent-also-pill" title="An agent pushed this URL; it stayed on Unmatched">Also: {label}</span>
    : null;
}

function Channel({ job }: { job: UnmatchedJob }) {
  const ch = jobChannel(job);
  return ch ? <span className={`channel-chip ${ch.cls}`} title={ch.title}>{ch.label}</span> : null;
}

function Location({ job }: { job: UnmatchedJob }) {
  return job.location ? <span className="row-loc" title={job.location}>{job.location}</span> : null;
}

function Via({ job, className = "row-via" }: { job: UnmatchedJob; className?: string }) {
  const via = viaText(job);
  return via ? <span className={className}>via {via}</span> : null;
}

/** Up to six items under a label (bullets the AI sometimes adds are stripped). */
function TagList({ label, items, cls }: { label: string; items: string[] | null | undefined; cls: string }) {
  const rows = (items ?? []).slice(0, 6).map((t) => String(t ?? "").replace(/^[\s•●·▪◦]+/, "").trim()).filter(Boolean);
  if (!rows.length) return null;
  return (
    <div>
      <div className="tag-label">{label}</div>
      <ul className="tag-list">{rows.map((t, i) => <li key={i} className={cls}>{t}</li>)}</ul>
    </div>
  );
}

export function UnmatchedCard({ job, expanded, flash, onToggle, onClose, onMark }: Props) {
  const score = job.match_score ?? 0;
  const reason = (job.disqualification_reason ?? "").trim();
  const summary = (job.summary ?? "").trim();
  const gate = job.match_gate ?? "";
  const canApply = job.user_status === "watchlist";
  const applicants = applicantsRow(job);
  const posted = postedAgo(job.posted_at);
  const scraped = formatApplicants(job.applicants);
  const agentReason = (job.agent_recommend_reason ?? "").trim();
  const hasAnalysis = Boolean(reason || summary || job.what_youll_do?.matched?.length
    || job.what_youll_do?.unmatched?.length || job.missing_requirements?.length);

  return (
    <div className={["card", expanded ? "expanded" : "", flash ? "open-flash" : ""].filter(Boolean).join(" ")} id={`card-${job._id}`}>
      <div
        className="card-row" role="button" tabIndex={0} aria-expanded={expanded} onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(); }
        }}
      >
        <span className="row-chevron">▸</span>
        <ScoreRing score={score} />
        <div className="row-main">
          <div className="row-title">{job.title || "(No Title)"}</div>
          <div className="row-sub">
            <span className="row-company">{job.company}</span>
            <Location job={job} />
            <Via job={job} />
            <span className="row-applicants" title={applicants.title} hidden={!applicants.label}>{applicants.label}</span>
          </div>
        </div>
        <div className="row-meta">
          <GatePill gate={gate} />
          <AgentAlso job={job} />
          <Channel job={job} />
          <span className={canApply ? "status-pill s-watchlist" : "status-pill s-unmatched"}>{canApply ? "Can Apply" : "Unmatched"}</span>
          {job.link ? (
            <a className="row-open" href={safeUrl(job.link)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>Open</a>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="card-body">
          <button
            type="button" className="panel-close" aria-label="Close details" title="Close (Esc)"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          >
            ×
          </button>
          <div className="card-header">
            <div className="card-title-block">
              <div className="card-title">{job.title || "(No Title)"}</div>
              <div className="card-company">{job.company}<Location job={job} /><Via job={job} className="row-via card-via" /></div>
            </div>
            <ScoreRing score={score} large />
          </div>

          <div className="card-meta">
            <Channel job={job} />
            <GatePill gate={gate} />
            <AgentAlso job={job} />
            {job.matched_at ? <span className="meta-pill" title="Matched on">Matched {job.matched_at}</span> : null}
            {posted ? <span className="meta-pill" title={`Published by the employer on ${posted.date}`}>{posted.label}</span> : null}
            {scraped ? <span className="meta-pill" title="Applicant count when the job was scraped">{scraped}</span> : null}
            {job.recommendation ? <span className="meta-pill">{job.recommendation}</span> : null}
          </div>

          {reason ? <div className="reason-box"><strong>Why it was rejected</strong>{reason}</div> : null}
          {agentReason ? <div className="agent-reason"><strong>Why the agent recommended this</strong>{agentReason}</div> : null}
          {summary && summary !== reason ? <div className="card-summary">{summary}</div> : null}
          <ScoreParts reasons={job.match_reasons} />
          {!hasAnalysis ? (
            <div className="card-summary">This match has not saved detailed analysis yet. Run matcher again to write full analysis.</div>
          ) : null}

          <Breakdown title="What you'll do" section={job.what_youll_do} openGaps={false} />
          <Breakdown title="What they're looking for" section={job.what_theyre_looking_for} openGaps={false} />
          <TagList label="Missing requirements" items={job.missing_requirements} cls="bd-no" />
          <TagList label="Red flags" items={job.red_flags} cls="bd-no" />
          <TagList label="Company & stack" items={reasonsWithoutScore(job.match_reasons)} cls="" />

          <a className="btn-apply" href={safeUrl(job.link)} target="_blank" rel="noopener">View Original</a>

          <div className="status-row">
            <select
              className={canApply ? "status-select s-watchlist" : "status-select"} aria-label="Can apply?" data-id={job._id}
              value={canApply ? "watchlist" : ""} onChange={(e) => onMark(e.target.value as "" | "watchlist")}
            >
              <option value="">Not marked</option>
              <option value="watchlist">Can apply</option>
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
