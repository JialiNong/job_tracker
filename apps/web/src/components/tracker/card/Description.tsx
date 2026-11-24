"use client";
/** The original job description: loaded the first time it is opened, copyable, editable. */
import { useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import { useTrackerWrite } from "@/lib/tracker/queries";

const EMPTY = "No description saved.";

export function Description({ jobId }: { jobId: string }) {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null); // null = not loaded yet
  const [status, setStatus] = useState("Expand to load…");
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editReady, setEditReady] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const load = async (): Promise<string> => {
    if (text !== null) return text;
    setStatus("Loading…");
    try {
      const loaded = (await api.getDescription(jobId)).description;
      setText(loaded);
      return loaded;
    } catch (err) {
      setStatus(`Failed to load: ${(err as Error).message}`);
      return "";
    }
  };

  const copy = async () => {
    const full = (await load()).trim();
    if (!full) return toast("No description saved for this job", "err");
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast(`Copied description (${full.length} chars)`);
    } catch {
      toast("Copy failed: Clipboard blocked", "err");
    }
  };

  const openEdit = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const details = (e.currentTarget as HTMLElement).closest("details");
    if (details) details.open = true;
    const current = text ?? "";
    setDraft(current);
    setEditing(true);
    setEditReady(text !== null);
    requestAnimationFrame(() => textarea.current?.focus());
    if (text !== null) return;
    const loaded = await load();
    setDraft((prev) => (prev === current ? loaded : prev));
    setEditReady(true);
  };

  const save = useTrackerWrite((description: string) => api.setDescription(jobId, description), {
    success: "Original description saved", failure: "Save failed", noRefetch: true,
  });

  return (
    <details
      className={editing ? "job-description editing" : "job-description"}
      onToggle={(e) => {
        const open = (e.target as HTMLDetailsElement).open;
        if (open) void load();
        else if (editing) setEditing(false);
      }}
    >
      <summary>
        <span>Original description</span>
        <span className="jd-actions">
          <button
            type="button" className="jd-copy-btn" title="Copy the full original description"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copy(); }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button" className="jd-edit-btn" title="Paste a description the scraper missed"
            onClick={(e) => { void openEdit(e); }}
          >
            Edit
          </button>
        </span>
      </summary>
      <div className="job-description-body">{text === null ? status : text || EMPTY}</div>
      <div className="jd-edit" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textarea}
          className="jd-edit-textarea"
          aria-label="Original job description"
          placeholder="Paste the job description from the posting…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="info-action-row">
          <button
            type="button" className="info-save-btn jd-save-btn" disabled={save.isPending || !editReady}
            onClick={() => save.mutate(draft, { onSuccess: (res) => {
              setText(res.description);
              setEditing(false);
            } })}
          >
            {save.isPending ? "⏳" : "✓ Save"}
          </button>
          <button type="button" className="info-cancel-btn jd-cancel-btn" onClick={() => setEditing(false)}>
            ✕ Cancel
          </button>
        </div>
      </div>
    </details>
  );
}
