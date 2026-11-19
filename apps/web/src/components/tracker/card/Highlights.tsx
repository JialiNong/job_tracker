"use client";
/**
 * Manual highlight tags (★ Leipzig …). Shown at once, saved in the
 * background, rolled back if the save fails.
 */
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import { HIGHLIGHT_PRESETS, MAX_HIGHLIGHTS, normalizeHighlights } from "@/lib/tracker/format";

interface Props {
  jobId: string;
  highlights: string[];
  onChange: (next: string[]) => void;
}

export function Highlights({ jobId, highlights, onChange }: Props) {
  const toast = useToast();
  const [input, setInput] = useState("");
  const has = (tag: string) => highlights.some((h) => h.toLowerCase() === tag.toLowerCase());

  const persist = async (next: string[], before: string[], success: string, failure: string) => {
    onChange(next);
    try {
      const data = await api.setHighlights(jobId, next);
      onChange(normalizeHighlights(data.highlights));
      toast(success);
    } catch {
      onChange(before);
      toast(failure, "err");
    }
  };

  const add = (raw: string) => {
    const tag = raw.trim().slice(0, 40);
    if (!tag) return;
    if (has(tag)) return toast("Already highlighted", "err");
    if (highlights.length >= MAX_HIGHLIGHTS) return toast(`At most ${MAX_HIGHLIGHTS} highlights`, "err");
    void persist([...highlights, tag], highlights, `★ ${tag}`, "Highlight save failed");
  };

  const remove = (tag: string) =>
    void persist(highlights.filter((h) => h.toLowerCase() !== tag.toLowerCase()), highlights,
      "Highlight removed", "Highlight remove failed");

  const addFromInput = () => {
    add(input);
    setInput("");
  };

  return (
    <div className="highlights-wrap" id={`highlights-${jobId}`} onClick={(e) => e.stopPropagation()}>
      <div className="highlights-label">Highlights</div>
      <div className="highlights-chips">
        {highlights.map((tag) => (
          <span className="hl-chip" key={tag}>
            ★ {tag}
            <button type="button" title="Remove" onClick={() => remove(tag)}>×</button>
          </span>
        ))}
      </div>
      <div className="highlights-add-row">
        {HIGHLIGHT_PRESETS.map((tag) => (
          <button key={tag} type="button" className={has(tag) ? "hl-preset active" : "hl-preset"} onClick={() => add(tag)}>
            {tag}
          </button>
        ))}
        <input
          className="hl-input" type="text" maxLength={40} placeholder="Custom tag…" aria-label="Custom highlight tag"
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFromInput(); } }}
        />
        <button type="button" className="hl-add-btn" onClick={addFromInput}>+ Add</button>
      </div>
    </div>
  );
}
