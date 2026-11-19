"use client";
/** Free-text notes. Kept in local state while typing; saved on the button. */
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import type { Job } from "@/lib/tracker/types";
import { useSavedFlash } from "./useSavedFlash";

export function Notes({ job }: { job: Job }) {
  const toast = useToast();
  const [notes, setNotes] = useState(job.notes);
  const [saved, flash] = useSavedFlash();

  const save = async () => {
    try {
      await api.setNotes(job._id, notes);
      flash();
      toast("Notes saved");
    } catch {
      toast("Notes save failed", "err");
    }
  };

  return (
    <div className="notes-wrap" onClick={(e) => e.stopPropagation()}>
      <div className="panel-heading">Notes</div>
      <textarea
        className="notes-textarea" aria-label="Notes" data-id={job._id} rows={2}
        placeholder="Rejected after interview, salary, or why you skipped it…"
        value={notes} onChange={(e) => setNotes(e.target.value)}
      />
      <button type="button" className={saved ? "btn-save saved" : "btn-save"} data-id={job._id} onClick={save}>
        {saved ? "Saved ✓" : "Save notes"}
      </button>
    </div>
  );
}
