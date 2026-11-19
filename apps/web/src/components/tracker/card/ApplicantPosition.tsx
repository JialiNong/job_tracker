"use client";
/** "Applicant # when I applied" (LinkedIn shows the count right after you apply). */
import { useState } from "react";
import { api } from "@/lib/tracker/api";
import { useTrackerWrite } from "@/lib/tracker/queries";
import type { Job } from "@/lib/tracker/types";
import { useSavedFlash } from "./useSavedFlash";

export function ApplicantPosition({ job }: { job: Job }) {
  const [value, setValue] = useState(job.applicant_position ? String(job.applicant_position) : "");
  const [saved, flash] = useSavedFlash();
  const write = useTrackerWrite((raw: string) => api.setApplicantPosition(job._id, raw), {
    success: (data) => (data.applicant_position ? `Saved: applicant #${data.applicant_position}` : "Applicant # cleared"),
    failure: "Not saved",
  });
  if (job.source.toLowerCase() !== "linkedin" && !job.applicant_position) return null;
  const save = () => write.mutate(value.trim(), { onSuccess: flash });

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
