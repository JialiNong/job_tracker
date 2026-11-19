"use client";
/**
 * Daily activity: ~3 months of week columns and a detail panel for one day.
 * Desktop: hover shows a day, click opens that day's applications in a new
 * tab. Phone: tap shows a day, double-tap opens its applications here.
 * Cells shrink to fit the panel width (--cal-cell).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { useElementSize } from "@/components/hooks/useElementSize";
import { useMediaQuery, useTouchUi } from "@/components/hooks/useMediaQuery";
import { type DayStats, activityLevel, activityScore, heatmapWeeks } from "@/lib/tracker/overview";

const DOUBLE_TAP_MS = 400;
const DOW = ["", "Mon", "", "Wed", "", "Fri", ""];

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const appliedDayUrl = (day: string) => `/?applied=${encodeURIComponent(day)}`;
const agentDayUrl = (day: string) =>
  `/unmatched?agent=1&date_from=${encodeURIComponent(day)}&date_to=${encodeURIComponent(day)}`;

function dayHeading(day: string) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === localDay(now)) return `Today · ${day}`;
  if (day === localDay(yesterday)) return `Yesterday · ${day}`;
  return day;
}

/** The default day: today if it is in range, else the last day with any activity. */
function defaultDay(days: DayStats[]): string {
  const today = localDay(new Date());
  if (days.some((d) => d.date === today)) return today;
  return [...days].reverse().find((d) => activityScore(d) > 0 || d.german_filtered > 0)?.date ?? "";
}

export function Heatmap({ days, onOpenAppliedDay }: { days: DayStats[]; onOpenAppliedDay: (day: string) => void }) {
  const touch = useTouchUi();
  const wide = useMediaQuery("(min-width: 901px)");
  const phone = useMediaQuery("(max-width: 768px)");
  const [bodyRef, body] = useElementSize<HTMLDivElement>();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState<number | undefined>(undefined);
  const [picked, setPicked] = useState("");
  const lastTap = useRef({ day: "", at: 0 });

  const weeks = heatmapWeeks(days);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const max = Math.max(0, ...days.map(activityScore));
  const selected = picked || defaultDay(days);
  const detail = byDate.get(selected);

  // Cell size: fit the weeks into the width left next to the detail panel.
  // Gaps and widths come from the live CSS (they change at the breakpoints).
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const bodyEl = bodyRef.current;
    if (!section || !bodyEl || !body.width || !weeks.length) return;
    const px = (el: Element | null, prop: string, fallback: number) =>
      (el && Number.parseFloat(getComputedStyle(el).getPropertyValue(prop))) || fallback;
    const wrap = section.querySelector(".cal-wrap");
    const stacked = getComputedStyle(bodyEl).flexDirection === "column";
    const detailW = stacked ? 0 : section.querySelector(".cal-detail")?.getBoundingClientRect().width ?? 0;
    const dowW = section.querySelector(".cal-dow")?.getBoundingClientRect().width ?? 16;
    const available = bodyEl.clientWidth - detailW - (stacked ? 0 : px(bodyEl, "gap", 10)) - dowW - px(wrap, "gap", 8);
    const fitted = Math.floor((available - (weeks.length - 1) * px(section, "--cal-gap", 2)) / weeks.length);
    const maxCell = wide ? 26 : stacked ? 24 : phone ? 16 : 18; // full 26px cells on desktop when there is room
    setCellSize(fitted >= 8 ? Math.min(fitted, maxCell) : undefined);
  }, [body.width, weeks.length, wide, phone, bodyRef]);

  const onCell = (day: string, data: DayStats) => {
    setPicked(day);
    if (!touch) {
      if (data.applied) window.open(appliedDayUrl(day), "_blank", "noopener");
      return;
    }
    const now = Date.now();
    if (data.applied && lastTap.current.day === day && now - lastTap.current.at < DOUBLE_TAP_MS) {
      lastTap.current = { day: "", at: 0 };
      onOpenAppliedDay(day);
      return;
    }
    lastTap.current = { day, at: now };
  };

  const agentN = detail?.agent_unmatched ?? 0;
  return (
    <div ref={sectionRef} className="cal-section panel" id="calSection" style={cellSize ? ({ "--cal-cell": `${cellSize}px` } as React.CSSProperties) : undefined}>
      <div className="cal-header">
        <h2 className="cal-title">
          Daily activity <span>last 3 months{touch ? <span className="cal-hint-touch"> · tap a day, double-tap for applications</span> : null}</span>
        </h2>
        <div className="cal-legend">
          Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`swatch l${l}`} />)} More
        </div>
      </div>
      <div className="cal-body" ref={bodyRef}>
        <div className="cal-wrap">
          <div className="cal-dow" aria-hidden="true">
            <span className="spacer" />
            {DOW.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="cal-months" id="calMonths">
            {weeks.map((week) => (
              <div className="cal-month-col" key={week.cells[0]!.date}>
                <div className="cal-month-label">{week.monthLabel}</div>
                <div className="cal-week">
                  {week.cells.map(({ date, data }) => {
                    if (!data) return <button key={date} type="button" className="cal-cell empty" disabled tabIndex={-1} />;
                    const stats = `${date}: ${data.title_clicked} clicked, ${data.german_filtered} german, ${data.ai_matched} matched, ${data.applied} applied`;
                    const hint = data.applied ? (touch ? " · tap for details, double-tap for applications" : " · click to open that day's applications") : touch ? " · tap for details" : "";
                    const cls = ["cal-cell", `l${activityLevel(activityScore(data), max)}`, data.applied ? "has-applied" : "", date === selected ? "selected" : ""].filter(Boolean).join(" ");
                    return (
                      <button
                        key={date} type="button" className={cls} data-date={date} title={stats + hint}
                        onMouseEnter={() => setPicked(date)} onClick={() => onCell(date, data)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="cal-detail" id="calDetail">
          <div className={detail ? "cal-detail-date" : "cal-detail-date muted"} id="calDetailDate">
            {detail ? dayHeading(selected) : touch ? "Tap a day · double-tap for applications" : "Hover or click a day"}
          </div>
          <div className="cal-metrics">
            {([["m-clicked", "title_clicked", "Opened"], ["m-german", "german_filtered", "Not in English"],
              ["m-matched", "ai_matched", "AI matched"], ["m-applied", "applied", "Applied (incl. rejected)"]] as const).map(([cls, key, label]) => (
              <div className={`cal-metric ${cls}`} key={key}>
                <div className="m-num">{detail ? detail[key] : "–"}</div>
                <div className="m-label">{label}</div>
              </div>
            ))}
          </div>
          {detail?.applied ? (
            <a className="cal-detail-link" href={appliedDayUrl(selected)} target="_blank" rel="noopener">View applications</a>
          ) : null}
          {agentN ? (
            <a className="cal-detail-link cal-agent-unmatched" href={agentDayUrl(selected)} target="_blank" rel="noopener">
              Agent recommended, still Unmatched ({agentN} {agentN === 1 ? "job" : "jobs"})
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
