"use client";
/**
 * Application flow (Sankey, one current path per application) and weekly
 * applications by platform. Hover (or tap) a band / week to read its count;
 * a click pins it until clicked again.
 */
import { useEffect, useState } from "react";
import { useElementSize } from "@/components/hooks/useElementSize";
import { useMediaQuery, useTouchUi } from "@/components/hooks/useMediaQuery";
import {
  type FlowPick, type SankeyData, type Week, describeFlowPick, describeWeek, fmtCount, layoutSankey, weeklyGeometry,
} from "@/lib/tracker/overview";

/**
 * The entrance animation plays once per visit: after it (or 1.8s), the root
 * gets .has-revealed, which the CSS uses to stop replaying it on re-renders
 * and resizes.
 */
function useRevealed(drawn: boolean) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!drawn || revealed) return;
    const timer = setTimeout(() => setRevealed(true), 1800);
    return () => clearTimeout(timer);
  }, [drawn, revealed]);
  return revealed;
}

/** Hover shows, click pins (and a second click on the same thing unpins). */
function usePick<T>(same: (a: T, b: T) => boolean) {
  const [pick, setPick] = useState<T | null>(null);
  const [sticky, setSticky] = useState(false);
  return {
    pick,
    hover: (next: T | null) => { if (!sticky) setPick(next); },
    click: (next: T) => {
      if (sticky && pick && same(pick, next)) { setSticky(false); setPick(null); return; }
      setSticky(true);
      setPick(next);
    },
  };
}

const samePick = (a: FlowPick, b: FlowPick) =>
  a.kind === b.kind && (a.kind === "node" ? a.id === (b as typeof a).id
    : a.source === (b as typeof a).source && a.target === (b as typeof a).target);

export function SankeyBoard({ sankey }: { sankey: SankeyData | undefined }) {
  const touch = useTouchUi();
  const phone = useMediaQuery("(max-width: 760px)");
  const [rootRef, root] = useElementSize<HTMLDivElement>();
  const { pick, hover, click } = usePick<FlowPick>(samePick);
  const hint = touch ? "Tap a band for the count" : "Hover a band for the count";
  const height = phone ? 220 : 268;
  const revealed = useRevealed(!!sankey?.total && root.width >= 40);

  let chart: React.ReactNode = <div className="flow-empty">Loading…</div>;
  let caption = hint;
  if (sankey && !sankey.total) {
    chart = <div className="flow-empty">No applications recorded yet</div>;
    caption = "Apply to a job to see the flow";
  } else if (sankey && root.width >= 40) {
    const width = Math.max(280, root.width);
    const layout = layoutSankey(sankey, width, height);
    const isOn = (node: string) => pick && (pick.kind === "node" ? pick.id === node : pick.source === node || pick.target === node);
    const linkOn = (s: string, t: string) => pick && (pick.kind === "node" ? pick.id === s || pick.id === t : pick.source === s && pick.target === t);
    caption = pick ? describeFlowPick(pick, sankey) : `${fmtCount(sankey.total)} jobs · ${hint}`;
    chart = (
      <svg
        className={pick ? "flow-chart is-picking" : "flow-chart"} viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet" role="img" aria-label="Application flow"
        onMouseLeave={() => { if (!touch) hover(null); }}
      >
        {layout.links.map((l) => {
          const p: FlowPick = { kind: "link", source: l.source, target: l.target, value: l.value };
          return (
            <path
              key={`${l.source}>${l.target}`} d={l.path} tabIndex={0} role="button"
              className={`flow-ribbon flow-tone-${l.tone}${linkOn(l.source, l.target) ? " is-on" : ""}`}
              aria-label={`${l.value} from ${l.source} to ${l.target}`}
              onMouseEnter={() => { if (!touch) hover(p); }} onFocus={() => hover(p)}
              onClick={(e) => { e.stopPropagation(); click(p); }}
            />
          );
        })}
        {layout.nodes.map((n) => {
          const p: FlowPick = { kind: "node", id: n.id };
          const left = n.column === 0 || n.id === "interview";
          const tx = left ? n.x - 8 : n.x + n.w + 8;
          const ty = n.y + n.h / 2;
          const stacked = n.h >= 22; // room for the count on its own line
          return (
            <g
              key={n.id} className={`flow-node flow-hit${isOn(n.id) ? " is-on" : ""}`} data-node={n.id}
              tabIndex={0} role="button" aria-label={`${n.label} ${n.value}`}
              onMouseEnter={() => { if (!touch) hover(p); }} onFocus={() => hover(p)}
              onClick={(e) => { e.stopPropagation(); click(p); }}
            >
              <rect className={`flow-node-rect flow-tone-${n.tone}`} x={n.x} y={n.y} width={n.w} height={n.h} />
              <text className="flow-label" x={tx} y={stacked ? ty - 6 : ty + 3} textAnchor={left ? "end" : "start"}>
                {stacked ? n.label : `${n.label} · ${fmtCount(n.value)}`}
              </text>
              {stacked ? <text className="flow-label-count" x={tx} y={ty + 8} textAnchor={left ? "end" : "start"}>{fmtCount(n.value)}</text> : null}
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div className="flow-section panel" id="flowSection">
      <h2 className="flow-title">Application flow <span>one path per job</span></h2>
      <div id="flowRoot" className={revealed ? "flow-root has-revealed" : "flow-root"} ref={rootRef}>{chart}</div>
      <p className="flow-caption" id="flowCaption">{caption}</p>
    </div>
  );
}

export function WeeklyBoard({ weekly }: { weekly: { weeks: Week[]; totals: Omit<Week, "week_start"> } | undefined }) {
  const touch = useTouchUi();
  const phone = useMediaQuery("(max-width: 760px)");
  const [rootRef, root] = useElementSize<HTMLDivElement>();
  const { pick, hover, click } = usePick<Week>((a, b) => a.week_start === b.week_start);
  const hint = touch ? "Tap a week for the split" : "Hover a week for the split";
  const weeks = weekly?.weeks ?? [];
  const hasData = weeks.length > 0 && (weekly?.totals.total ?? 0) > 0;
  const revealed = useRevealed(hasData && root.width > 0);

  let chart: React.ReactNode = <div className="flow-empty">Loading…</div>;
  let caption = hint;
  if (weekly && !hasData) {
    chart = <div className="flow-empty">No applications recorded yet</div>;
    caption = "Apply to a job to see weekly volume";
  } else if (weekly && root.width) {
    const g = weeklyGeometry(weeks, root.width, phone ? 220 : 268);
    const baseline = g.padT + g.bodyH;
    caption = pick ? describeWeek(pick) : `${describeWeek(null, weekly.totals)} · ${hint}`;
    chart = (
      <div className="weekly-scroll">
        <svg
          className={pick ? "weekly-chart is-picking" : "weekly-chart"} viewBox={`0 0 ${g.innerW} ${g.plotH}`}
          width={g.innerW} height={g.plotH} role="img" aria-label="Weekly applications by platform"
          onMouseLeave={() => { if (!touch) hover(null); }}
        >
          <defs>
            {g.bars.filter((b) => b.segs.length).map((b) => (
              <clipPath key={b.i} id={`wk-clip-${b.i}`}>
                <rect x={b.x} y={b.top} width={g.barW} height={Math.max(baseline - b.top, 1)} rx={3} ry={3} />
              </clipPath>
            ))}
          </defs>
          <line className="weekly-axis" x1={0} x2={g.innerW} y1={baseline} y2={baseline} />
          {/* Month labels sit outside the bars so dimming unpicked weeks leaves them readable */}
          {g.bars.filter((b) => b.monthLabel).map((b) => (
            <text key={`m-${b.i}`} className="weekly-month-label" x={b.x} y={12}>{b.monthLabel}</text>
          ))}
          {g.bars.map((b) => (
            <g
              key={b.week.week_start} className={pick?.week_start === b.week.week_start ? "weekly-bar is-on" : "weekly-bar"}
              data-week={b.week.week_start} style={{ "--wk-i": String(b.i) } as React.CSSProperties}
              tabIndex={0} role="button" aria-label={describeWeek(b.week)}
              onMouseEnter={() => { if (!touch) hover(b.week); }} onFocus={() => hover(b.week)}
              onClick={(e) => { e.stopPropagation(); click(b.week); }}
            >
              <rect className="weekly-hit" x={b.x - 1} y={g.padT} width={g.barW + 2} height={g.bodyH} fill="transparent" />
              <g
                className="weekly-stack" clipPath={b.segs.length ? `url(#wk-clip-${b.i})` : undefined}
                style={{ "--wk-i": String(b.i), transformOrigin: `${b.x + g.barW / 2}px ${baseline}px` } as React.CSSProperties}
              >
                {b.segs.length ? b.segs.map((s) => (
                  <rect key={s.key} className={`weekly-seg-${s.key}`} x={b.x} y={s.y} width={g.barW} height={s.h} />
                )) : <rect className="weekly-seg-other" x={b.x} y={baseline - 2} width={g.barW} height={2} rx={3} ry={3} opacity={0.45} />}
              </g>
              {g.slot >= 20 ? (
                <text className="weekly-week-label" x={b.x + g.barW / 2} y={g.plotH - 8} textAnchor="middle">
                  {Number(b.week.week_start.slice(8))}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div className="weekly-section panel" id="weeklySection">
      <div className="weekly-header">
        <h2 className="weekly-title">Weekly applications <span>by platform</span></h2>
        <div className="weekly-legend" id="weeklyLegend" hidden={!hasData}>
          <span className="weekly-swatch sw-linkedin" />LinkedIn
          <span className="weekly-swatch sw-indeed" />Indeed
          <span className="weekly-swatch sw-other" />Other
        </div>
      </div>
      <div id="weeklyRoot" className={revealed ? "weekly-root has-revealed" : "weekly-root"} ref={rootRef}>{chart}</div>
      <p className="flow-caption" id="weeklyCaption">{caption}</p>
    </div>
  );
}
