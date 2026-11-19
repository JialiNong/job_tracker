"use client";
/**
 * Application Journey: one date axis from the first application to today
 * (or a later scheduled round), and one track per job that reached an
 * interview. A step shows its label and date on hover / focus; the "i"
 * button shows the company and title.
 */
import { useEffect, useState } from "react";
import type { Journey as JourneyData } from "@/lib/tracker/api";
import { axisPercent, monthDay } from "@/lib/tracker/overview";
import { stepClass, sortTimeline } from "@/lib/tracker/timeline";

interface Tip { text: string; x: number; y: number }
interface Pop { key: string; company: string; title: string; left: number; top: number }

export function Journey({ data }: { data: JourneyData | undefined }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);

  // A click anywhere else closes the company popover
  useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".jt-info, #jtCompanyPop")) setPop(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pop]);

  const showTip = (el: HTMLElement, text: string) => {
    setPop(null);
    const r = el.getBoundingClientRect();
    setTip({ text, x: r.left + r.width / 2, y: r.top });
  };

  const togglePop = (el: HTMLElement, company: string, title: string) => {
    const key = `${company}||${title}`;
    if (pop?.key === key) return setPop(null);
    const r = el.getBoundingClientRect();
    const width = 240; // the popover's max width; corrected against the window edges below
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - 8 - width);
    setPop({ key, company, title, left, top: r.bottom + 6 });
  };

  let body: React.ReactNode;
  if (!data) {
    body = <div className="journey-empty">Loading…</div>;
  } else if (!data.total_applied) {
    body = <div className="journey-empty">No applications recorded yet</div>;
  } else {
    const { start_date: start, end_date: end, today } = data;
    const todayPct = axisPercent(today, start, end);
    const showToday = today > start && today < end;
    body = (
      <div className="journey-panel">
        <div className="journey-overview">
          <div className="journey-axis">
            <div className="journey-scale">
              <div className="journey-axis-rail" />
              {showToday ? <div className="journey-axis-today" style={{ left: `${todayPct}%` }} /> : null}
              <span className="jo-endpoint start" />
              <span className="jo-endpoint end" />
              <span className="journey-axis-label start">{monthDay(start)}</span>
              <span className="journey-axis-label end">{monthDay(end)}</span>
            </div>
          </div>
          <div className="journey-overview-total">
            <div className="jot-num">{data.total_applied}</div>
            <div className="jot-label">applied</div>
          </div>
        </div>
        {data.tracks.length ? (
          <div className="journey-tracks">
            {data.tracks.map((track) => {
              const steps = sortTimeline(track.steps);
              return (
                <div className="journey-track" key={track.job_id}>
                  <div className="journey-plot">
                    <div className="journey-scale">
                      {steps.slice(0, -1).map((s, i) => {
                        const next = steps[i + 1]!;
                        const a = axisPercent(s.date, start, end);
                        const b = axisPercent(next.date, start, end);
                        const end_ = next.step === "rejected" ? " end-rejected" : next.step === "offer" ? " end-offer"
                          : next.step === "interview_cancelled" ? " end-cancelled" : "";
                        return <div key={`seg-${i}`} className={`jt-seg${end_}`} style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }} />;
                      })}
                      {steps.map((s, i) => {
                        const text = `${s.label} · ${monthDay(s.date)}`;
                        return (
                          <button
                            key={`node-${i}`} type="button" className={`jt-node ${stepClass(s.step)}`}
                            style={{ left: `${axisPercent(s.date, start, end)}%` }} aria-label={text}
                            onMouseEnter={(e) => showTip(e.currentTarget, text)} onMouseLeave={() => setTip(null)}
                            onFocus={(e) => showTip(e.currentTarget, text)} onBlur={() => setTip(null)}
                          >
                            <span className="jt-dot" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="journey-side">
                    <button
                      type="button" className={pop?.key === `${track.company}||${track.title}` ? "jt-info active" : "jt-info"}
                      title="Company info" aria-label="Company info"
                      onClick={(e) => togglePop(e.currentTarget, track.company, track.title)}
                    >
                      i
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className="journey-empty">No interview timelines yet</div>}
      </div>
    );
  }

  return (
    <div className="journey-section panel" id="journeySection">
      <h2 className="journey-title">Application journey <span>one line per company</span></h2>
      <div id="journeyRoot">{body}</div>
      <div className={tip ? "jt-floating-tip show" : "jt-floating-tip"} id="jtFloatingTip" style={tip ? { left: tip.x, top: tip.y } : undefined}>
        {tip?.text}
      </div>
      {pop ? (
        <div className="jt-company-pop show" id="jtCompanyPop" style={{ left: pop.left, top: pop.top }}>
          <div className="jcp-company">{pop.company || "Unknown"}</div>
          {pop.title ? <div className="jcp-title">{pop.title}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
