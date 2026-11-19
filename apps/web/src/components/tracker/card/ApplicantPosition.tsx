"use client";
/** "Applicant # when I applied" (LinkedIn shows the count right after you apply). */
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import type { Job } from "@/lib/tracker/types";
import { useTracker } from "../TrackerContext";
import { useSavedFlash } from "./useSavedFlash";

export function ApplicantPosition({ job }: { job: Job }) {
  const tracker = useTracker();
  const toast = useToast();
  const [value, setValue] = useState(job.applicant_position ? String(job.applicant_position) : "");
  const [saved, flash] = useSavedFlash();
  if (job.source.toLowerCase() !== "linkedin" && !job.applicant_position) return null;

  const save = async () => {
    try {
      const data = await api.setApplicantPosition(job._id, value.trim());
      flash();
      toast(data.applicant_position ? `Saved: applicant #${data.applicant_position}` : "Applicant # cleared");
      await tracker.afterWrite(job._id);
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };

  return (
    <div className="applicant-pos-wrap" onClick={(e) => e.stopPropagation()}>
      <div className="panel-heading">Applicant # when I applied</div>
      <div className="ap-row">
        <input
          type="number" min={1} step={1} inputMode="numeric" className="applicant-pos-input"
          aria-label="Applicant number when I applied" placeholder="e.g. 25" value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        />
        <button type="button" className="btn-save" onClick={save}>{saved ? "Saved ✓" : "Save"}</button>
      </div>
      <span className="ap-hint">
        {job.applicants ? `When scraped: ${job.applicants}. ` : ""}Read the LinkedIn applicant count right after you apply.
      </span>
    </div>
  );
}
