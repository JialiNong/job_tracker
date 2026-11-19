"use client";
/**
 * Manual highlight tags (★ Leipzig …). Optimistic: the new tags show at once
 * (written into the cached card), and are rolled back if the save fails.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import { HIGHLIGHT_PRESETS, MAX_HIGHLIGHTS, normalizeHighlights } from "@/lib/tracker/format";
import { invalidateTracker, trackerKeys, updateCachedJob } from "@/lib/tracker/queries";

export function Highlights({ jobId, highlights }: { jobId: string; highlights: string[] }) {
  const toast = useToast();
  const client = useQueryClient();
  const [input, setInput] = useState("");
  const has = (tag: string) => highlights.some((h) => h.toLowerCase() === tag.toLowerCase());

  const save = useMutation({
    mutationFn: ({ next }: { next: string[]; success: string; failure: string }) => api.setHighlights(jobId, next),
    onMutate: async ({ next }) => {
      await client.cancelQueries({ queryKey: trackerKeys.all }); // an older refetch must not overwrite this
      const before = highlights;
      updateCachedJob(client, jobId, (job) => ({ ...job, highlights: next }));
      return { before };
    },
    onError: (_err, { failure }, context) => {
      if (context) updateCachedJob(client, jobId, (job) => ({ ...job, highlights: context.before }));
      toast(failure, "err");
    },
    onSuccess: (data, { success }) => {
      updateCachedJob(client, jobId, (job) => ({ ...job, highlights: normalizeHighlights(data.highlights) }));
      toast(success);
    },
    onSettled: () => invalidateTracker(client), // the Highlights filter may now exclude this card
  });

  const add = (raw: string) => {
    const tag = raw.trim().slice(0, 40);
    if (!tag) return;
    if (has(tag)) return toast("Already highlighted", "err");
    if (highlights.length >= MAX_HIGHLIGHTS) return toast(`At most ${MAX_HIGHLIGHTS} highlights`, "err");
    save.mutate({ next: [...highlights, tag], success: `★ ${tag}`, failure: "Highlight save failed" });
  };

  const remove = (tag: string) => save.mutate({
    next: highlights.filter((h) => h.toLowerCase() !== tag.toLowerCase()),
    success: "Highlight removed",
    failure: "Highlight remove failed",
  });

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
