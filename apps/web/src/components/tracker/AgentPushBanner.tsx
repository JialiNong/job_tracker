"use client";
/**
 * Today's agent pushes (Berlin day) above the Tracker list: per agent how many
 * jobs were sent, saved, skipped and failed, every failed URL with its reason,
 * and saved cards whose Indeed link still needs fixing. Hidden when no agent
 * pushed today; the server only returns today's rows, so it clears at midnight.
 */
import { RECOMMENDED_BY_LABEL } from "@/lib/tracker/format";
import { useAgentPushes } from "@/lib/tracker/queries";

const agentLabel = (agent: string) => RECOMMENDED_BY_LABEL[agent.toLowerCase()] ?? agent;
const jobLabel = (title: string, company: string) => [title, company].filter(Boolean).join(" — ");

export function AgentPushBanner() {
  const { data } = useAgentPushes();
  if (!data || !data.agents.length) return null;
  const problems = data.failures.length + data.needs_link.length;

  return (
    <section className={`agent-push-banner${problems ? " has-problems" : ""}`} aria-label="Today's agent pushes">
      <div className="apb-summary">
        <strong>{problems ? "Agent push needs a look" : "Agent pushes today"}</strong>
        {data.agents.map((a) => (
          <span key={a.agent} className="apb-agent" title={`Last push ${a.last_at}${a.runs > 1 ? ` · ${a.runs} pushes` : ""}`}>
            {agentLabel(a.agent)}: {a.received} sent · {a.saved} saved · {a.skipped} already stored
            {a.failed ? <> · <span className="apb-failed">{a.failed} failed</span></> : null}
          </span>
        ))}
      </div>
      {data.needs_link.length ? (
        <div className="apb-block">
          <div className="apb-heading">Saved, but the Indeed link has no job id — paste the viewjob link on the card</div>
          <ul>
            {data.needs_link.map((j) => (
              <li key={j.card_id}>
                {/* A full load, so the existing ?open= deep link finds the card on any page */}
                <a href={`/?open=${j.card_id}`}>{jobLabel(j.title, j.company) || j.url}</a>
                <span className="apb-muted"> · {agentLabel(j.agent)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.failures.length ? (
        <div className="apb-block">
          <div className="apb-heading">Not saved</div>
          <ul>
            {data.failures.map((f, i) => (
              <li key={`${f.url}-${i}`}>
                <a href={f.url} target="_blank" rel="noopener noreferrer">{jobLabel(f.title, f.company) || f.url}</a>
                <span className="apb-muted"> · {agentLabel(f.agent)} {f.at.slice(11)} · {f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
