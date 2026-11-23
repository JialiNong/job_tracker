"use client";
/**
 * Application progress: the timeline track, "+ Step" buttons, Undo, and the
 * "Other" side status. Every Undo asks first (a leftover click after Save
 * used to drop a step). Clearing to Not applied / undoing the only Applied
 * step is the wipe. One timeline write at a time: a leftover click after
 * the time modal must not Undo the step that was just saved. The card cache
 * updates from the PATCH; chips refetch in the background.
 */
import { Fragment, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SIDE_STATUSES, statusFromTimeline } from "@tracker/core/status";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import { STATUS_LABEL } from "@/lib/tracker/format";
import { updateCachedJob, useTrackerWrite } from "@/lib/tracker/queries";
import {
  TIMELINE_LABEL, initialTimeFor, lineClass, nextActions, nodeTime, sortTimeline, stepClass,
  stepPrompt, timelineWithStep, toInputValue,
} from "@/lib/tracker/timeline";
import type { Job, TimelineItem } from "@/lib/tracker/types";

const SIDE_OPTIONS: [string, string][] = [
  ["unsuitable", "Unsuitable"],
  ["closed", "Closed (before applying)"],
  ["closed_no_reply", "Closed after applying, no reply"],
  ["prev_rejected", "Rejected before, skip this time"],
  ["too_many_questions", "Good fit, too many required questions"],
  ["repost", "Repost"],
  ["duplicate", "Duplicate"],
];

export function ProgressBlock({ job }: { job: Job }) {
  const dialog = useDialog();
  const toast = useToast();
  const client = useQueryClient();
  const id = job._id;
  const timeline = sortTimeline(job.application_timeline);
  const sideValue = SIDE_STATUSES.includes(job.status) ? job.status : "";
  // Closing the time modal can deliver a second click onto Undo; one in-flight
  // timeline write at a time so an empty undo cannot overwrite + Rejected.
  const writing = useRef(false);

  /** Send a whole timeline; refuse to call it saved if the server dropped a step. */
  const saveTimeline = useTrackerWrite(async ({ next }: { next: TimelineItem[]; done: string }) => {
    const sent = sortTimeline(next).map(({ step, at }) => ({ step, at }));
    const saved = await api.setTimeline(id, sent);
    if ((saved.application_timeline ?? []).length < sent.length) throw new Error("The server did not keep every step");
    updateCachedJob(client, id, (row) => ({
      ...row,
      status: saved.status,
      applied_at: saved.applied_at,
      application_timeline: saved.application_timeline ?? [],
    }));
    return saved;
  }, { success: (_saved, { done }) => done, failure: "Progress not saved" });

  const setStatus = useTrackerWrite(async (status: string) => {
    const result = await api.setStatus(id, status);
    updateCachedJob(client, id, (row) => ({
      ...row,
      status,
      ...(status === "pending"
        ? { application_timeline: [], applied_at: null, applicant_position: null }
        : {}),
    }));
    return result;
  }, {
    success: (_r, status) => `Status updated to "${STATUS_LABEL[status] ?? status}"`,
    failure: "Status update failed",
  });

  const runTimeline = (args: { next: TimelineItem[]; done: string }) => {
    saveTimeline.mutate(args, { onSettled: () => { writing.current = false; } });
  };

  const addStep = async (step: string) => {
    if (writing.current) return;
    writing.current = true;
    const label = TIMELINE_LABEL[step] ?? step;
    const at = await dialog.askTime({
      title: `Record: ${label}`, hint: stepPrompt(step), initial: initialTimeFor(step, timeline),
    });
    if (!at) { writing.current = false; return; }
    runTimeline({ next: timelineWithStep(timeline, step, at), done: `Recorded ${label} · ${at}` });
  };

  const editStep = async (index: number) => {
    if (writing.current) return;
    writing.current = true;
    const event = timeline[index];
    if (!event) { writing.current = false; return; }
    const label = TIMELINE_LABEL[event.step] ?? event.step;
    const at = await dialog.askTime({
      title: `Edit time: ${label}`, hint: "Update the date and time for this step", initial: toInputValue(event.at),
    });
    if (!at) { writing.current = false; return; }
    runTimeline({ next: timeline.map((e, i) => (i === index ? { ...e, at } : e)), done: `Updated ${label} · ${at}` });
  };

  const undo = async () => {
    if (writing.current || !timeline.length) return;
    // A side-status job keeps its Applied record; only later steps can be undone
    if (sideValue && timeline.length === 1 && timeline[0]!.step === "applied") {
      toast("Application record is kept for this status");
      return;
    }
    writing.current = true;
    const removed = timeline[timeline.length - 1]!;
    const label = TIMELINE_LABEL[removed.step] ?? removed.step;
    // Undoing the only Applied step is the same wipe as Reset Not Applied
    const wipingApplied = timeline.length === 1 && removed.step === "applied";
    const ok = await dialog.confirm(wipingApplied
      ? {
          title: "Remove Applied?",
          hint: "This resets the card to Not applied and deletes the apply date. To record a rejection, use + Rejected instead.",
          confirmLabel: "Remove",
          danger: true,
        }
      : {
          title: `Undo ${label}?`,
          hint: `This removes ${label} from the progress track. Earlier steps stay.`,
          confirmLabel: "Undo",
          danger: true,
        });
    if (!ok) { writing.current = false; return; }
    runTimeline({ next: timeline.slice(0, -1), done: `↩ Undid ${label}` });
  };

  const setSide = async (value: string) => {
    if (writing.current || value === sideValue) return;
    if (value === "pending") {
      const ok = await dialog.confirm({
        title: "Reset to Not applied?",
        hint: "This clears the application date and the whole progress track. If they turned you down, use + Rejected instead — that keeps the history.",
        confirmLabel: "Reset",
        danger: true,
      });
      if (!ok) return;
    }
    // "—" goes back to the status the timeline gives
    const status = value || statusFromTimeline(timeline, "");
    if (status) setStatus.mutate(status);
  };

  return (
    <div className="progress-wrap" id={`progress-${id}`} onClick={(e) => e.stopPropagation()}>
      <div className="progress-title">Application progress</div>
      <div className="progress-track">
        {timeline.length ? timeline.map((event, i) => {
          const time = nodeTime(event.at);
          const next = timeline[i + 1];
          return (
            <Fragment key={`${event.step}-${event.at}-${i}`}>
              <button
                type="button" className={`progress-node ${stepClass(event.step)}`} title="Click to edit time"
                disabled={saveTimeline.isPending}
                onClick={() => void editStep(i)}
              >
                <div className="node-label">{TIMELINE_LABEL[event.step] ?? event.label ?? event.step}</div>
                <div className="node-dot" />
                <div className="node-time">{time ? <>{time[0]}<br />{time[1]}</> : event.at || "—"}</div>
              </button>
              {next ? <div className={lineClass(next.step)} /> : null}
            </Fragment>
          );
        }) : <div className="progress-empty">No application yet — record when you applied below</div>}
      </div>
      <div className="progress-actions">
        {nextActions(timeline).map((a) => (
          <button key={a.step} type="button" className={`progress-btn ${a.cls}`} disabled={saveTimeline.isPending} onClick={() => void addStep(a.step)}>
            {a.label}
          </button>
        ))}
        {timeline.length ? <button type="button" className="progress-btn btn-undo" disabled={saveTimeline.isPending} onClick={() => void undo()}>↩ Undo</button> : null}
      </div>
      <div className="progress-side">
        <label className="progress-side-label" htmlFor={`side-${id}`}>Other</label>
        <select
          className="status-side-select" id={`side-${id}`} data-id={id} value={sideValue}
          disabled={saveTimeline.isPending || setStatus.isPending}
          onChange={(e) => void setSide(e.target.value)}
        >
          <option value="">—</option>
          {SIDE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="pending">Clear application (Not applied)</option>
        </select>
      </div>
    </div>
  );
}
