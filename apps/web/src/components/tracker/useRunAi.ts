"use client";
/**
 * Run AI from the browser: one card, or the selected cards one after another
 * (each a POST /api/jobs/<id>/run-ai that runs to the end on the server).
 * Flask ran batches in a server thread; a serverless function cannot, so
 * the page drives the sequence and shows the progress itself.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { type RunAiResult, api } from "@/lib/tracker/api";
import { GATE_LABELS } from "@/lib/tracker/format";
import { invalidateTracker } from "@/lib/tracker/queries";

export interface BatchRow extends RunAiResult { id: string; label: string }
export interface BatchProgress {
  running: boolean;
  total: number;
  current: number;
  rows: BatchRow[];
}

const gateText = (gate?: string) => GATE_LABELS[gate ?? ""] || gate || "";

export function useRunAi() {
  const toast = useToast();
  const client = useQueryClient();
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [banner, setBanner] = useState<{ text: string; type: "ok" | "err" } | null>(null);

  const mark = (id: string, on: boolean) => setRunning((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const runOne = async (id: string) => {
    if (batch?.running) return toast("Wait for the batch Run AI to finish", "err");
    mark(id, true);
    const result = await api.runAi(id);
    mark(id, false);
    if (!result.ok) return toast(`Run AI failed: ${result.error}`, "err", result.needs_local_scrape ? 6000 : 3000);
    if (result.match_gate && result.match_gate !== "scored") {
      toast(`Hard fail: ${gateText(result.match_gate)} — see the card for the quoted reason.`, "err");
    } else {
      toast(`AI done${result.match_score != null ? ` score ${result.match_score}/10` : ""}`);
    }
    await invalidateTracker(client);
  };

  /** Selected cards in order; one failure does not stop the rest. */
  const runBatch = async (items: { id: string; label: string }[]) => {
    if (batch?.running || !items.length) return;
    setBanner(null);
    const rows: BatchRow[] = [];
    setBatch({ running: true, total: items.length, current: 0, rows: [] });
    for (const [i, item] of items.entries()) {
      setBatch({ running: true, total: items.length, current: i + 1, rows: [...rows] });
      mark(item.id, true);
      rows.push({ ...(await api.runAi(item.id)), id: item.id, label: item.label });
      mark(item.id, false);
    }
    const done = rows.filter((r) => r.ok).length;
    const failed = rows.length - done;
    setBatch({ running: false, total: items.length, current: items.length, rows });
    const text = `Run AI finished — ${done} updated${failed ? `, ${failed} failed` : ""}`;
    setBanner({ text, type: failed ? "err" : "ok" });
    toast(text, failed ? "err" : "ok", 8000);
    await invalidateTracker(client);
  };

  return {
    runOne,
    runBatch,
    isRunning: (id: string) => running.has(id),
    batch,
    banner,
    dismissBanner: () => setBanner(null),
  };
}

/** The progress list under the batch bar (markup from the old page). */
export function batchRowText(r: BatchRow): string {
  const score = r.match_score != null ? ` · ${r.match_score}/10` : "";
  const via = r.ok && r.used_stored_jd ? " · stored JD" : "";
  const gate = r.ok && r.match_gate && r.match_gate !== "scored" ? ` — stopped at ${gateText(r.match_gate)}, not scored` : "";
  const err = r.error ? ` — ${r.error}` : "";
  return `${r.ok ? "✓" : "✗"} ${r.title || r.label || r.id}${score}${via}${gate}${err}`;
}
