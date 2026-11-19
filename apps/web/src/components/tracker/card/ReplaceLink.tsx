"use client";
/** Swap a closed posting's URL for the live one (then Fetch job details scrapes it). */
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import type { Job } from "@/lib/tracker/types";
import { useTracker } from "../TrackerContext";
import { useSavedFlash } from "./useSavedFlash";

export function ReplaceLink({ job }: { job: Job }) {
  const tracker = useTracker();
  const toast = useToast();
  const [link, setLink] = useState(job.link);
  const [busy, setBusy] = useState(false);
  const [saved, flash] = useSavedFlash();

  const save = async () => {
    const raw = link.trim();
    if (!raw) return toast("Paste a job URL", "err");
    setBusy(true);
    try {
      const data = await api.replaceLink(job._id, raw);
      flash();
      toast(data.unchanged ? "Link is already this URL" : "Link updated — Fetch job details to scrape the new page");
      await tracker.afterWrite(job._id);
    } catch (err) {
      toast((err as Error).message || "Update failed", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="replace-link-wrap" onClick={(e) => e.stopPropagation()}>
      <div className="panel-heading">Replace posting link</div>
      <div className="rl-row">
        <input
          type="text" className="replace-link-input" inputMode="url" autoComplete="off" spellCheck={false}
          aria-label="Replacement job URL" placeholder="https://company.com/jobs/…" value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        />
        <button type="button" className="btn-save" disabled={busy} onClick={save}>
          {busy ? "⏳" : saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      <span className="rl-hint">If the original posting is closed, paste the live company-page URL, save, then Fetch job details.</span>
    </div>
  );
}
