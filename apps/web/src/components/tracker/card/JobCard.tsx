"use client";
/**
 * One Tracker card: the row, and the details panel when expanded. The list
 * decides which card is open (one at a time).
 */
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import { needsAi, normalizeHighlights, safeUrl } from "@/lib/tracker/format";
import { useTrackerWrite } from "@/lib/tracker/queries";
import { isAppliedLike } from "@/lib/tracker/timeline";
import type { Job } from "@/lib/tracker/types";
import { useTracker } from "../TrackerContext";
import { AgentReason, FitTags, LocalAi } from "./AiResult";
import { ApplicantPosition } from "./ApplicantPosition";
import { ApplicationQa } from "./ApplicationQa";
import { CardMeta } from "./CardMeta";
import { CardRow } from "./CardRow";
import { CompanyHistory } from "./CompanyHistory";
import { Description } from "./Description";
import { Highlights } from "./Highlights";
import { Notes } from "./Notes";
import { ProgressBlock } from "./ProgressBlock";
import { ReplaceLink } from "./ReplaceLink";
import { ScoreRing } from "./ScoreRing";
import { TitleBlock } from "./TitleBlock";

interface Props {
  job: Job;
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
  flash?: boolean;
}

export function JobCard({ job, expanded, onToggle, onClose, flash }: Props) {
  const tracker = useTracker();
  // Read straight from the cached card: a highlight edit updates the cache optimistically
  const highlights = normalizeHighlights(job.highlights);
  const selected = tracker.isSelected(job._id);

  const className = ["card", "has-fetch-select",
    highlights.length ? "has-highlights" : "", selected ? "fetch-selected" : "",
    expanded ? "expanded" : "", flash ? "open-flash" : ""].filter(Boolean).join(" ");

  return (
    <div className={className} id={`card-${job._id}`}>
      <label
        className="card-select-wrap" onClick={(e) => e.stopPropagation()}
        title={needsAi(job) ? "Select for batch Fetch details / Run AI / Delete" : "Select for batch Delete"}
      >
        <input
          type="checkbox" className="card-select" checked={selected}
          onChange={(e) => tracker.toggleSelected(job._id, e.target.checked)}
        />
      </label>
      <CardRow job={job} highlights={highlights} expanded={expanded} onToggle={onToggle} />
      {expanded ? (
        <CardBody job={job} highlights={highlights} onClose={onClose} />
      ) : null}
    </div>
  );
}

function CardBody({ job, highlights, onClose }: { job: Job; highlights: string[]; onClose: () => void }) {
  const applied = isAppliedLike(job.status, job.application_timeline);
  return (
    <div className="card-body" id={`body-${job._id}`} role="region" aria-label="Job details">
      <button
        type="button" className="panel-close" aria-label="Close details" title="Close (Esc)"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        ×
      </button>
      <div className="card-split">
        <div className="card-split-match">
          <div className="card-header">
            <TitleBlock job={job} />
            <ScoreRing score={job.match_score} large />
          </div>
          <CardMeta job={job} highlights={highlights} />
          <CompanyHistory job={job} />
          <div className="progress-panel">
            <ProgressBlock job={job} />
            <ApplicantPosition job={job} />
            <Notes job={job} />
          </div>
          <div className="card-actions-row">
            <a className={applied ? "btn-apply btn-applied" : "btn-apply"} href={safeUrl(job.link)} target="_blank" rel="noopener">
              {applied ? "View posting" : "Apply"}
            </a>
            <PipelineButtons job={job} />
          </div>
          <AgentReason job={job} />
          <LocalAi job={job} />
          <FitTags job={job} />
          <Description jobId={job._id} />
        </div>
        <div className="card-split-track">
          <ApplicationQa job={job} />
          <Highlights jobId={job._id} highlights={highlights} />
          <ReplaceLink job={job} />
          <div className="card-danger-row">
            <DeleteButton job={job} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Run AI / Fetch job details need the pipeline (OpenAI, Chrome), which moves
 * to the new stack in phase 3 together with the task-state redesign.
 */
function PipelineButtons({ job }: { job: Job }) {
  const toast = useToast();
  const notYet = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast("Run AI / Fetch details are not on the new backend yet — use the current Tracker", "err", 4000);
  };
  const aiPending = needsAi(job);
  return (
    <>
      <button
        type="button" className={aiPending ? "btn-run-ai ai-pending-btn" : "btn-run-ai"} onClick={notYet}
        title="Run AI matching — uses the stored JD when it is complete, otherwise scrapes the job page in Chrome first"
      >
        {aiPending ? "Run AI" : "Re-run AI"}
      </button>
      {job.details_missing || job.can_fetch_details ? (
        <button
          type="button" className="btn-fetch-details" onClick={notYet}
          title="Scrape title, company, location, and description (no AI matching)"
        >
          Fetch job details
        </button>
      ) : null}
    </>
  );
}

function DeleteButton({ job }: { job: Job }) {
  const dialog = useDialog();
  const remove = useTrackerWrite(() => api.deleteJob(job._id), { success: "Job deleted", failure: "Delete failed" });

  const confirmAndDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await dialog.confirm({
      title: "Delete this job?",
      hint: "Removes the posting and its Tracker card. It will not come back unless scraped again.",
      detail: job.title || "this job",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) remove.mutate(undefined);
  };

  return (
    <button
      type="button" className="delete-job-btn" disabled={remove.isPending} onClick={confirmAndDelete}
      title="Delete this job permanently"
    >
      Delete job
    </button>
  );
}
