"use client";
/**
 * Floating bar while "Select jobs" is on (markup from templates/index.html):
 * select helpers, then Fetch details / Run AI match / Delete for the
 * selection; the batch progress list and the result banner below it.
 */
import { type BatchProgress, batchModeLabel, batchRowText } from "./useRunAi";

interface Props {
  selectMode: boolean;
  count: number;
  busy: boolean;
  onSelectAll: () => void;
  onSelectMissing: (kind: "missing" | "missing_ai") => void;
  onClear: () => void;
  onFetch: () => void;
  onRunAi: () => void;
  onDelete: () => void;
  batch: BatchProgress | null;
  banner: { text: string; type: "ok" | "err" } | null;
  onDismissBanner: () => void;
}

export function BatchBar(p: Props) {
  const batchRunning = !!p.batch?.running;
  return (
    <>
      <div className={p.selectMode ? "batch-fetch-bar select-mode" : "batch-fetch-bar"} id="batchFetchBar">
        <div className="bf-helpers">
          <span className="batch-fetch-meta" id="batchFetchMeta">{p.count} selected</span>
          <button type="button" className="batch-fetch-btn select-mode-only" id="selectAllVisibleBtn" onClick={p.onSelectAll} title="Select every card on this page">
            Select all on page
          </button>
          <button
            type="button" className="batch-fetch-btn" id="selectMissingBtn" onClick={() => p.onSelectMissing("missing")}
            title="Select jobs that still need details (all pages, current filters — including Applied)"
          >
            Select missing details
          </button>
          <button
            type="button" className="batch-fetch-btn" id="selectMissingAiBtn" onClick={() => p.onSelectMissing("missing_ai")}
            title="Select jobs with no AI result yet (all pages, current filters), then Run AI for selected"
          >
            Select missing AI result
          </button>
          <button type="button" className="batch-fetch-btn" id="clearFetchSelectBtn" onClick={p.onClear}>Clear selection</button>
        </div>
        <span className="batch-sep" aria-hidden="true" />
        <div className="bf-actions">
          <button
            type="button" className="btn-fetch-details" id="fetchSelectedBtn" disabled={batchRunning || p.count === 0}
            onClick={p.onFetch} title="Scrape title, company, location, and description only (no AI) — runs on your computer"
          >
            Fetch details
          </button>
          <button
            type="button" className="btn-run-ai" id="runAiSelectedBtn" disabled={batchRunning || p.count === 0}
            onClick={p.onRunAi} title="Run AI matching on the stored job description of each selected job"
          >
            Run AI match
          </button>
          <button
            type="button" className="batch-fetch-btn batch-delete-btn select-mode-only" id="deleteSelectedBtn"
            disabled={batchRunning || p.busy || p.count === 0} onClick={p.onDelete} title="Permanently delete every selected job"
          >
            Delete
          </button>
        </div>
      </div>
      <div className={p.banner ? `batch-fetch-banner ${p.banner.type}` : "batch-fetch-banner"} id="batchFetchBanner" hidden={!p.banner}>
        {p.banner ? <><span>{p.banner.text}</span><button type="button" onClick={p.onDismissBanner}>Dismiss</button></> : null}
      </div>
      <div className="batch-fetch-progress" id="batchFetchProgress" hidden={!p.batch}>
        {p.batch ? <BatchProgressList batch={p.batch} /> : null}
      </div>
    </>
  );
}

function BatchProgressList({ batch }: { batch: BatchProgress }) {
  const done = batch.rows.filter((r) => r.ok).length;
  const failed = batch.rows.length - done;
  return (
    <>
      <div className="bf-head">
        <span>{batch.running ? `${batchModeLabel(batch.mode)} ${Math.min(batch.current, batch.total)}/${batch.total}` : `Batch done — ${done} saved, ${failed} failed`}</span>
        <span>{done} ok · {failed} failed</span>
      </div>
      <div className="bf-list">
        {batch.rows.length
          ? batch.rows.map((r) => <div key={r.id} className={r.ok ? "bf-ok" : "bf-err"}>{batchRowText(r)}</div>)
          : "Starting…"}
      </div>
    </>
  );
}
