"use client";
/** The Overview tab: pipeline rail, daily heatmap, flow charts, journey, locations (same order as before). */
import { useOverview } from "@/lib/tracker/queries";
import type { Stats } from "@/lib/tracker/types";
import { SankeyBoard, WeeklyBoard } from "./FlowBoards";
import { Heatmap } from "./Heatmap";
import { Journey } from "./Journey";
import { Locations } from "./Locations";
import { Rail } from "./Rail";

interface Props {
  open: boolean;
  stats: Stats | null;
  /** Phone double-tap on a heatmap day: show that day's applications in the Jobs list. */
  onOpenAppliedDay: (day: string) => void;
}

export function OverviewView({ open, stats, onOpenAppliedDay }: Props) {
  const { daily, locations, flow, journey } = useOverview(open);
  return (
    <div id="overviewView" className="tracker-view overview" role="tabpanel" aria-labelledby="tabOverview" hidden={!open}>
      {open ? (
        <>
          <Rail stats={stats} />
          <Heatmap days={daily.data?.days ?? []} onOpenAppliedDay={onOpenAppliedDay} />
          <SankeyBoard sankey={flow.data?.sankey} />
          <WeeklyBoard weekly={flow.data?.weekly} />
          <Journey data={journey.data} />
          <Locations data={locations.data} />
        </>
      ) : null}
    </div>
  );
}
