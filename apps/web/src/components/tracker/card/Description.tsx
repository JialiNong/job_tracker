"use client";
/** The original job description: loaded the first time it is opened, copyable. */
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";

const EMPTY = "No description saved.";

export function Description({ jobId }: { jobId: string }) {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null); // null = not loaded yet
  const [status, setStatus] = useState("Expand to load…");
  const [copied, setCopied] = useState(false);

  const load = async (): Promise<string> => {
    if (text !== null) return text;
    setStatus("Loading…");
    try {
      const loaded = (await api.getDescription(jobId)).description.trim();
      setText(loaded);
      return loaded;
    } catch (err) {
      setStatus(`Failed to load: ${(err as Error).message}`);
      return "";
    }
  };

  const copy = async () => {
    const full = await load();
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

  return (
    <details className="job-description" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void load(); }}>
      <summary>
        <span>Original description</span>
        <button
          type="button" className="jd-copy-btn" title="Copy the full original description"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copy(); }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </summary>
      <div className="job-description-body">{text === null ? status : text || EMPTY}</div>
    </details>
  );
}
