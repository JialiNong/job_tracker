"use client";
/** Floating bar while "Select jobs" is on: select all / clear, and Delete selected. */
interface Props {
  selectMode: boolean;
  count: number;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
}

export function BatchBar({ selectMode, count, busy, onSelectAll, onClear, onDelete }: Props) {
  return (
    <div className={selectMode ? "batch-fetch-bar select-mode" : "batch-fetch-bar"} id="batchFetchBar">
      <div className="bf-helpers">
        <span className="batch-fetch-meta" id="batchFetchMeta">{count} selected</span>
        <button type="button" className="batch-fetch-btn select-mode-only" onClick={onSelectAll} title="Select every card on this page">
          Select all on page
        </button>
        <button type="button" className="batch-fetch-btn" onClick={onClear}>Clear selection</button>
      </div>
      <span className="batch-sep" aria-hidden="true" />
      <div className="bf-actions">
        {/* Batch Fetch details / Run AI come with the pipeline in phase 3 */}
        <button type="button" className="btn-fetch-details" disabled title="Not on the new backend yet">Fetch details</button>
        <button type="button" className="btn-run-ai" disabled title="Not on the new backend yet">Run AI match</button>
        <button
          type="button" className="batch-fetch-btn batch-delete-btn select-mode-only" id="deleteSelectedBtn"
          disabled={busy || count === 0} onClick={onDelete} title="Permanently delete every selected job"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
