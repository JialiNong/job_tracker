"use client";
/** Card title, company (click = filter by it) and location, with an inline editor. */
import { useRef, useState } from "react";
import { api } from "@/lib/tracker/api";
import { viaText } from "@/lib/tracker/format";
import { useTrackerWrite } from "@/lib/tracker/queries";
import type { Job } from "@/lib/tracker/types";
import { useTracker } from "../TrackerContext";

export function TitleBlock({ job }: { job: Job }) {
  const tracker = useTracker();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: job.title, company: job.company, location: job.location });
  const titleInput = useRef<HTMLInputElement>(null);
  const via = viaText(job);

  const open = () => {
    setForm({ title: job.title, company: job.company, location: job.location });
    setEditing(true);
    requestAnimationFrame(() => titleInput.current?.select());
  };

  const save = useTrackerWrite((info: typeof form) => api.setInfo(job._id, info), {
    success: "Job info updated", failure: "Update failed",
  });

  const field = (name: keyof typeof form, placeholder: string, ref?: typeof titleInput) => (
    <input
      ref={ref} className="info-input" data-field={name} value={form[name]} placeholder={placeholder}
      aria-label={placeholder} onChange={(e) => setForm({ ...form, [name]: e.target.value })}
    />
  );

  return (
    <div className="card-title-block">
      <div className="info-view" style={editing ? { display: "none" } : undefined}>
        <div className="card-title">
          <span className="card-title-text" tabIndex={-1}>{job.title || "(No Title)"}</span>
          <button className="edit-info-btn" onClick={(e) => { e.stopPropagation(); open(); }} title="Edit title / company / location">Edit</button>
        </div>
        <div className="card-company">
          {job.company ? (
            <button
              type="button" className="company-link" title="Add this company to the search filter"
              onClick={(e) => { e.stopPropagation(); tracker.filterByCompany(job.company); }}
            >
              {job.company}
            </button>
          ) : null}
          {job.location ? <span className="row-loc" title={job.location}>{job.location}</span> : null}
          {via ? <span className="card-via">via {via}</span> : null}
        </div>
      </div>
      <div className={editing ? "info-edit active" : "info-edit"}>
        {field("title", "Job Title", titleInput)}
        <div className="info-edit-row">
          {field("company", "Company")}
          {field("location", "Location")}
        </div>
        <div className="info-action-row">
          <button
            className="info-save-btn" disabled={save.isPending}
            onClick={() => save.mutate(form, { onSuccess: () => setEditing(false) })}
          >
            {save.isPending ? "⏳" : "✓ Save"}
          </button>
          <button className="info-cancel-btn" onClick={() => setEditing(false)}>✕ Cancel</button>
        </div>
      </div>
    </div>
  );
}
