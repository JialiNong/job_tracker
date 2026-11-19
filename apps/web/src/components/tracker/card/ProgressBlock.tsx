"use client";
/**
 * Application progress: the timeline track, "+ Step" buttons, Undo, and the
 * "Other" side status. Every change is one API write, then the card reloads
 * from the server (TrackerContext.afterWrite), so the pill, the Apply button
 * and the counts all follow the saved data.
 */
import { Fragment } from "react";
import { SIDE_STATUSES, statusFromTimeline } from "@tracker/core/status";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import { STATUS_LABEL } from "@/lib/tracker/format";
import {
  TIMELINE_LABEL, initialTimeFor, lineClass, nextActions, nodeTime, sortTimeline, stepClass,
  stepPrompt, timelineWithStep, toInputValue,
} from "@/lib/tracker/timeline";
import type { Job, TimelineItem } from "@/lib/tracker/types";
import { useTracker } from "../TrackerContext";

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
  const tracker = useTracker();
  const dialog = useDialog();
  const toast = useToast();
  const id = job._id;
  const timeline = sortTimeline(job.application_timeline);
  const sideValue = SIDE_STATUSES.includes(job.status) ? job.status : "";

  /** Send a whole timeline; refuse to call it saved if the server dropped a step. */
  const saveTimeline = async (next: TimelineItem[]) => {
    const sent = sortTimeline(next).map(({ step, at }) => ({ step, at }));
    const saved = await api.setTimeline(id, sent);
    if ((saved.application_timeline ?? []).length < sent.length) {
      throw new Error("The server did not keep every step");
    }
    await tracker.afterWrite(id);
  };

  const addStep = async (step: string) => {
    const label = TIMELINE_LABEL[step] ?? step;
    const at = await dialog.askTime({
      title: `Record: ${label}`, hint: stepPrompt(step), initial: initialTimeFor(step, timeline),
    });
    if (!at) return;
    try {
      await saveTimeline(timelineWithStep(timeline, step, at));
      toast(`Recorded ${label} · ${at}`);
    } catch (err) {
      toast(`Failed to update progress: ${(err as Error).message}`, "err");
    }
  };

  const editStep = async (index: number) => {
    const event = timeline[index];
    if (!event) return;
    const label = TIMELINE_LABEL[event.step] ?? event.step;
    const at = await dialog.askTime({
      title: `Edit time: ${label}`, hint: "Update the date and time for this step", initial: toInputValue(event.at),
    });
    if (!at) return;
    try {
      await saveTimeline(timeline.map((e, i) => (i === index ? { ...e, at } : e)));
      toast(`Updated ${label} · ${at}`);
    } catch {
      toast("Failed to update time", "err");
    }
  };

  const undo = async () => {
    if (!timeline.length) return;
    // A side-status job keeps its Applied record; only later steps can be undone
    if (sideValue && timeline.length === 1 && timeline[0]!.step === "applied") {
      toast("Application record is kept for this status");
      return;
    }
    const removed = timeline[timeline.length - 1]!;
    try {
      await saveTimeline(timeline.slice(0, -1));
      toast(`↩ Undid ${TIMELINE_LABEL[removed.step] ?? removed.step}`);
    } catch {
      toast("Undo failed", "err");
    }
  };

  const setSide = async (value: string) => {
    // "—" goes back to the status the timeline gives
    const status = value || statusFromTimeline(timeline, "");
    if (!status) return;
    try {
      await api.setStatus(id, status);
      await tracker.afterWrite(id);
      toast(`Status updated to "${STATUS_LABEL[status] ?? status}"`);
    } catch {
      toast("Status update failed", "err");
    }
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
                onClick={() => editStep(i)}
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
          <button key={a.step} type="button" className={`progress-btn ${a.cls}`} onClick={() => addStep(a.step)}>
            {a.label}
          </button>
        ))}
        {timeline.length ? <button type="button" className="progress-btn btn-undo" onClick={undo}>↩ Undo</button> : null}
      </div>
      <div className="progress-side">
        <label className="progress-side-label" htmlFor={`side-${id}`}>Other</label>
        <select
          className="status-side-select" id={`side-${id}`} data-id={id} value={sideValue}
          onChange={(e) => setSide(e.target.value)}
        >
          <option value="">—</option>
          {SIDE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="pending">Reset Not Applied</option>
        </select>
      </div>
    </div>
  );
}
