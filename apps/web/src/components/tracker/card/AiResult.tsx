/** The AI match: agent's reason, summary + breakdowns (or top reasons), and fit tags. */
import { fitTags, formatScoreDelta, hasAiScore, reasonsWithoutScore, scoreParts } from "@/lib/tracker/format";
import type { BreakdownSection, Job } from "@/lib/tracker/types";
import { ScoreRing } from "./ScoreRing";

export function Breakdown({ title, section, openGaps = true }: {
  title: string;
  section: BreakdownSection | null | undefined;
  /** Start open when something is missing (the Tracker); Unmatched starts closed. */
  openGaps?: boolean;
}) {
  const matched = section?.matched ?? [];
  const unmatched = section?.unmatched ?? [];
  if (!matched.length && !unmatched.length) return null;
  return (
    // Open by default when something is missing: the gaps are what matter
    <details className="breakdown" open={openGaps && unmatched.length > 0}>
      <summary>
        <span>{title}</span>
        <span className="bd-count">{matched.length}/{matched.length + unmatched.length} matched</span>
      </summary>
      <ul className="bd-list">
        {matched.map((t, i) => <li key={`ok-${i}`} className="bd-ok">✓ {t}</li>)}
        {unmatched.map((t, i) => <li key={`no-${i}`} className="bd-no">✗ {t}</li>)}
      </ul>
    </details>
  );
}

export function AgentReason({ job }: { job: Job }) {
  const reason = job.recommend_reason.trim();
  if (!reason) return null;
  return (
    <div className="recommend-reason">
      <span className="recommend-reason-label">Why AI recommends this</span>{reason}
    </div>
  );
}

export function LocalAi({ job }: { job: Job }) {
  const hasBreakdown = Boolean(
    job.what_youll_do?.matched?.length || job.what_youll_do?.unmatched?.length
    || job.what_theyre_looking_for?.matched?.length || job.what_theyre_looking_for?.unmatched?.length,
  );
  const reasons = hasBreakdown ? [] : reasonsWithoutScore(job.match_reasons).slice(0, 3);
  if (!hasAiScore(job) && !job.summary && !hasBreakdown && !reasons.length) return null;
  return (
    <div className="ai-local">
      {hasAiScore(job) || job.summary ? (
        <div className="ai-local-lead">
          {hasAiScore(job) ? <ScoreRing score={job.match_score} large /> : null}
          {job.summary ? <div className="card-summary">{job.summary}</div> : null}
        </div>
      ) : null}
      <Breakdown title="What you'll do" section={job.what_youll_do} />
      <Breakdown title="What they're looking for" section={job.what_theyre_looking_for} />
      {reasons.length ? <ul className="ai-match-reasons">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
    </div>
  );
}

/** How the score adds up: one chip per term of the matcher's "Score: …" line. */
export function ScoreParts({ reasons }: { reasons: string[] | null | undefined }) {
  const parts = scoreParts(reasons);
  if (!parts.length) return null;
  return (
    <div className="score-parts">
      <span className="score-parts-label">Score</span>
      <div className="score-parts-chips">
        {parts.map((p, i) => {
          const cls = p.delta === null || p.delta < 0 ? "sp-down" : p.base ? "" : "sp-up";
          return (
            <span key={i} className={`score-part ${cls}`.trim()} title={p.raw}>
              {p.label}
              {p.delta !== null ? <b>{p.base ? p.delta.toFixed(1) : formatScoreDelta(p.delta)}</b> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function FitTags({ job }: { job: Job }) {
  const tags = fitTags(job);
  const hasScore = scoreParts(job.match_reasons).length > 0;
  if (!tags && !hasScore) return null;
  return (
    <div className="fit-tags">
      <ScoreParts reasons={job.match_reasons} />
      {!tags ? null : tags.matched.length || tags.missing.length ? (
        <div className="fit-row">
          <span className="fit-label">Stack</span>
          <div className="fit-chips">
            {tags.matched.map((t) => <span key={`ok-${t}`} className="fit-tag fit-ok" title="On your CV">{t}</span>)}
            {tags.missing.map((t) => <span key={`gap-${t}`} className="fit-tag fit-gap" title="Asked for, not on your CV">{t}</span>)}
          </div>
        </div>
      ) : tags.rerunHint ? (
        <div className="fit-row">
          <span className="fit-label">Stack</span>
          <span className="fit-hint">Re-run AI to see which stack you match</span>
        </div>
      ) : null}
      {tags?.business.length ? (
        <div className="fit-row">
          <span className="fit-label">Business</span>
          <div className="fit-chips">
            {tags.business.map((t) => (
              <span key={t.text} className={`fit-tag ${t.warn ? "fit-warn" : "fit-biz"}`} title={t.title}>{t.text}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
