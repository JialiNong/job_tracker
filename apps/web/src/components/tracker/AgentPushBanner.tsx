"use client";
/**
 * Today's agent pushes (Berlin day) above the Tracker list. A summary line per
 * agent, then every pushed job by where it ended up: link to fix, not saved,
 * saved now, already on the Tracker (with how it got there), on Unmatched
 * (with the matcher's score), waiting for the matcher, in Timeouts. Each job
 * links to the posting and opens its card. Hidden when no agent pushed today;
 * the server only returns today's rows, so it clears at midnight.
 */
import type { ReactNode } from "react";
import { GATE_LABELS, RECOMMENDED_BY_LABEL } from "@/lib/tracker/format";
import { useAgentPushes } from "@/lib/tracker/queries";
import type { AgentPushesToday } from "@/lib/tracker/types";

type Item = AgentPushesToday["items"][number];

const agentLabel = (agent: string) => RECOMMENDED_BY_LABEL[agent.toLowerCase()] ?? agent;
const jobLabel = (title: string, company: string, url: string) => [title, company].filter(Boolean).join(" — ") || url;

const ORIGIN_LABEL: Record<string, string> = {
  pipeline: "found by the scraper", api: "found by an API source", manual: "logged by hand", agent: "pushed by an agent earlier",
};

const SECTIONS: { outcome: Item["outcome"]; title: string; hint: string; sampleHint?: string }[] = [
  { outcome: "saved", title: "Saved", hint: "New on the Tracker, AI pending", sampleHint: "New on the Tracker (Run AI is off on this demo)" },
  { outcome: "tracker", title: "Already on the Tracker", hint: "Not saved again" },
  { outcome: "unmatched", title: "On Unmatched", hint: "The matcher scored it below the cut-off; the agent still liked it" },
  { outcome: "awaiting_match", title: "Waiting for the matcher", hint: "Scraped, not scored yet" },
  { outcome: "timeout", title: "In Timeouts", hint: "The detail page did not load when scraped" },
];

function itemDetail(item: Item): string {
  const parts: string[] = [];
  if (item.outcome === "tracker" && ORIGIN_LABEL[item.origin]) parts.push(ORIGIN_LABEL[item.origin]!);
  if (item.match_score != null) parts.push(`score ${item.match_score}`);
  // Only a gate that stopped the job ("scored" just means the AI ran)
  if (GATE_LABELS[item.match_gate]) parts.push(GATE_LABELS[item.match_gate]!);
  return parts.join(" · ");
}

function Section({ title, hint, count, children, warn = false }: {
  title: string; hint: string; count: number; children: ReactNode; warn?: boolean;
}) {
  if (!count) return null;
  return (
    <details className={`apb-block${warn ? " apb-warn" : ""}`} open>
      <summary><span className="apb-heading">{title} ({count})</span> <span className="apb-muted">· {hint}</span></summary>
      <ul>{children}</ul>
    </details>
  );
}

/** Posting link (new tab) plus, when stored, a link that opens its card. */
function JobLine({ title, company, url, openPath, extra }: {
  title: string; company: string; url: string; openPath: string | null; extra: string;
}) {
  return (
    <li>
      <a href={url} target="_blank" rel="noopener noreferrer">{jobLabel(title, company, url)}</a>
      {/* A full load, so the existing ?open= deep link finds the card on any page */}
      {openPath && openPath !== "/" ? <> · <a href={openPath}>Open card</a></> : null}
      {extra ? <span className="apb-muted"> · {extra}</span> : null}
    </li>
  );
}

export function AgentPushBanner() {
  const { data, error } = useAgentPushes();
  if (error) {
    return (
      <section className="agent-push-banner has-error" role="alert">
        <strong>Agent push summary unavailable</strong>
        <span className="apb-muted"> · {error.message || "the server returned an error"}. Pushed jobs are still saved.</span>
      </section>
    );
  }
  if (!data || !data.agents.length) return null;
  const problems = data.failures.length + data.needs_link.length;
  const sample = !!data.sample;

  return (
    <section
      className={`agent-push-banner${problems ? " has-problems" : ""}${sample ? " is-sample" : ""}`}
      aria-label={sample ? "Sample agent pushes (demo)" : "Today's agent pushes"}
    >
      <div className="apb-summary">
        <strong>
          {sample
            ? "Sample agent pushes (demo)"
            : problems
              ? "Agent push needs a look"
              : "Agent pushes today"}
        </strong>
        {sample ? (
          <span className="apb-sample">Fictional summary — live agent ingest is off on this demo</span>
        ) : null}
        {data.agents.map((a) => (
          <span key={a.agent} className="apb-agent" title={`Last push ${a.last_at}${a.runs > 1 ? ` · ${a.runs} pushes` : ""}`}>
            {agentLabel(a.agent)}: {a.received} sent · {a.saved} saved · {a.skipped} already stored
            {a.failed ? <> · <span className="apb-failed">{a.failed} failed</span></> : null}
          </span>
        ))}
      </div>
      <Section
        title="Fix the link"
        hint={sample
          ? "Sample row — fictional short link; no card to open on this demo"
          : "Saved, but the Indeed link has no job id: paste the viewjob link on the card"}
        count={data.needs_link.length} warn
      >
        {data.needs_link.map((j) => (
          // Sample rows have no real card in the demo DB — posting link only.
          <JobLine
            key={j.card_id} title={j.title} company={j.company} url={j.url}
            openPath={sample ? null : `/?open=${j.card_id}`} extra={agentLabel(j.agent)}
          />
        ))}
      </Section>
      <Section title="Not saved" hint="The tracker could not store these" count={data.failures.length} warn>
        {data.failures.map((f, i) => (
          <JobLine
            key={`${f.url}-${i}`} title={f.title} company={f.company} url={f.url} openPath={null}
            extra={`${agentLabel(f.agent)} ${f.at.slice(11)} · ${f.message}`}
          />
        ))}
      </Section>
      {SECTIONS.map((s) => {
        const items = data.items.filter((i) => i.outcome === s.outcome);
        return (
          <Section key={s.outcome} title={s.title} hint={sample && s.sampleHint ? s.sampleHint : s.hint} count={items.length}>
            {items.map((i) => (
              <JobLine
                key={i.open_path || i.url} title={i.title} company={i.company} url={i.url} openPath={i.open_path}
                extra={[itemDetail(i), i.agents.map(agentLabel).join(", ")].filter(Boolean).join(" · ")}
              />
            ))}
          </Section>
        );
      })}
    </section>
  );
}
