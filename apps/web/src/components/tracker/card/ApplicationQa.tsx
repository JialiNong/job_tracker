"use client";
/** Questions asked in the application form and the answers given. */
import { useState } from "react";
import { api } from "@/lib/tracker/api";
import { useTrackerWrite } from "@/lib/tracker/queries";
import type { Job } from "@/lib/tracker/types";
import { useSavedFlash } from "./useSavedFlash";

interface Pair {
  key: string; // stable React key for a row being edited (rows have no id of their own)
  question: string;
  answer: string;
}

const pair = (question = "", answer = ""): Pair => ({ key: crypto.randomUUID(), question, answer });

export function ApplicationQa({ job }: { job: Job }) {
  const [items, setItems] = useState<Pair[]>(() =>
    job.application_qa.length ? job.application_qa.map((qa) => pair(qa.question, qa.answer)) : [pair()]);
  const [saved, flash] = useSavedFlash();

  const update = (key: string, change: Partial<Pair>) =>
    setItems((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));
  // Removing the last pair leaves one empty pair to type into
  const remove = (key: string) =>
    setItems((list) => (list.length > 1 ? list.filter((p) => p.key !== key) : [pair()]));

  const write = useTrackerWrite((qa: { question: string; answer: string }[]) => api.setApplicationQa(job._id, qa), {
    success: "Application Q&A saved", failure: "Q&A save failed", noRefetch: true,
  });
  const save = () => write.mutate(
    items.map((p) => ({ question: p.question.trim(), answer: p.answer.trim() })).filter((p) => p.question || p.answer),
    { onSuccess: flash },
  );

  return (
    <div className="qa-wrap">
      <div className="qa-label">Application Q&amp;A</div>
      <div className="qa-list">
        {items.map((p) => (
          <div className="qa-item" key={p.key}>
            <div className="qa-item-header">
              <input
                className="qa-question" type="text" aria-label="Question" placeholder="Question asked in the application…"
                value={p.question} onChange={(e) => update(p.key, { question: e.target.value })}
              />
              <button type="button" className="qa-remove" title="Remove" aria-label="Remove question" onClick={() => remove(p.key)}>×</button>
            </div>
            <textarea
              className="qa-answer" rows={2} aria-label="Answer" placeholder="Your answer…"
              value={p.answer} onChange={(e) => update(p.key, { answer: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="qa-actions">
        <button type="button" className="btn-add-qa" onClick={() => setItems((list) => [...list, pair()])}>+ Add question</button>
        <button type="button" className={saved ? "btn-save saved" : "btn-save"} data-id={job._id} onClick={save}>
          {saved ? "Saved ✓" : "Save Q&A"}
        </button>
      </div>
    </div>
  );
}
