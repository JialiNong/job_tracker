"use client";
/** The Timeouts page: title-qualified jobs whose description timed out. Port of static/js/timeouts.js. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryParams } from "@/components/hooks/useQueryParams";
import { PageSide } from "@/components/shell/PageNav";
import { useToast } from "@/components/ui/Toast";
import { type TimeoutJob, pagesApi } from "@/lib/pages/api";
import { safeUrl } from "@/lib/tracker/format";

const KEY = ["timeouts"] as const;

export function TimeoutsApp() {
  const [f, setParams] = useQueryParams({ source: "all", status: "open" });
  const client = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: [...KEY, f.source, f.status], queryFn: () => pagesApi.timeouts(f.source, f.status) });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "add" | "dismiss" }) =>
      action === "add" ? pagesApi.addTimeout(id) : pagesApi.dismissTimeout(id),
    onSuccess: (data, { action }) =>
      toast(action === "dismiss" ? "Dismissed" : "already" in data && data.already ? "Already on Tracker" : "Added to Tracker as Not Applied"),
    onError: (err: Error) => toast(err.message || "Failed", "err"),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });

  const data = list.data;
  return (
    <div className="app">
      <PageSide active="timeouts" />
      <main className="main">
        <div className="page-head">
          <div>
            <h1>Scrape timeouts</h1>
            <p className="hint">
              The title passed the scrape gates, but the job description did not load. Open the link, then add it to
              the Tracker as Not Applied if it is a real match.
            </p>
          </div>
        </div>

        <div className="toolbar">
          <select id="sourceFilter" aria-label="Source" value={f.source} onChange={(e) => setParams({ source: e.target.value })}>
            <option value="all">All sources</option>
            <option value="indeed">Indeed</option>
            <option value="linkedin">LinkedIn</option>
          </select>
          <select id="statusFilter" aria-label="Review status" value={f.status} onChange={(e) => setParams({ status: e.target.value })}>
            <option value="open">Open</option>
            <option value="added">Added to Tracker</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
          <span className="count-label" id="countLabel">{data ? `${data.total} ${data.total === 1 ? "job" : "jobs"}` : ""}</span>
        </div>

        <div className="list" id="list">
          {list.error ? <div className="empty">Loading failed: {list.error.message}</div>
            : data && !data.jobs.length ? <div className="empty">No timeout jobs in this filter. New ones appear after the next scrape.</div>
            : data?.jobs.map((job) => (
              <TimeoutCard key={job._id} job={job} busy={act.isPending} onAction={(action) => act.mutate({ id: job._id, action })} />
            ))}
        </div>
      </main>
    </div>
  );
}

function TimeoutCard({ job, busy, onAction }: { job: TimeoutJob; busy: boolean; onAction: (action: "add" | "dismiss") => void }) {
  return (
    <div className="card" data-id={job._id}>
      <div>
        <h3>{job.title}</h3>
        <div className="meta">
          <span className="pill">{(job.source || "").toUpperCase()}</span>
          {job.company ? <span>{job.company}</span> : null}
          {job.location ? <span>{job.location}</span> : null}
          {job.keyword ? <span>q={job.keyword}</span> : null}
          {job.created_at ? <span>{job.created_at}</span> : null}
          <span>Timed out {job.timeout_count}×</span>
        </div>
      </div>
      <div className="actions">
        <a className="btn btn-ok" href={safeUrl(job.link)} target="_blank" rel="noopener">Open job</a>
        {job.review_status === "open" ? (
          <>
            <button className="btn" disabled={busy} onClick={() => onAction("add")}>Add as Not Applied</button>
            <button className="btn btn-mute" disabled={busy} onClick={() => onAction("dismiss")}>Dismiss</button>
          </>
        ) : <span className="pill">{job.review_status}</span>}
      </div>
    </div>
  );
}
