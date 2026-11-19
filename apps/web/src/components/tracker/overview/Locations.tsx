"use client";
/** "Where you applied": places with 2+ applications as packed bubbles, sized by count. */
import { useEffect, useState } from "react";
import { useElementSize } from "@/components/hooks/useElementSize";
import { useMediaQuery, useTouchUi } from "@/components/hooks/useMediaQuery";
import { packBubbles } from "@/lib/tracker/overview";

interface Props {
  data: { total: number; locations: { name: string; count: number }[] } | undefined;
}

export function Locations({ data }: Props) {
  const touch = useTouchUi();
  const phone = useMediaQuery("(max-width: 768px)");
  const [rootRef, size] = useElementSize<HTMLDivElement>();
  const [open, setOpen] = useState("");

  // A click outside the bubbles closes the open one
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".loc-bubble")) setOpen(""); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const total = data?.total ?? 0;
  // Single-application places add clutter: chart places with 2+ only
  const places = (data?.locations ?? []).filter((l) => l.count >= 2).sort((a, b) => b.count - a.count);
  const verb = touch ? "tap" : "hover";

  let content: React.ReactNode = <div className="loc-empty">Loading…</div>;
  if (data && !places.length) {
    content = <div className="loc-empty">{total ? "No city with 2+ applications yet" : "No applied jobs yet"}</div>;
  } else if (data && size.width && size.height) {
    content = packBubbles(places, size.width, size.height, phone).map((b) => (
      <div
        key={b.name} className={open === b.name ? "loc-bubble is-open" : "loc-bubble"} role="button" tabIndex={0}
        aria-label={`${b.name}: ${b.count}`}
        style={{ "--size": `${b.r * 2}px`, "--bubble": b.color, "--bubble-ink": b.ink, left: b.x, top: b.y } as React.CSSProperties}
        onClick={() => setOpen(open === b.name ? "" : b.name)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === b.name ? "" : b.name); } }}
      >
        <span className="lb-name">{b.name}</span>
        <span className="lb-count">{b.count}</span>
      </div>
    ));
  }

  return (
    <div className="loc-section panel" id="locSection">
      <div className="loc-header">
        <h2 className="loc-title">Where you applied <span>{verb} for count</span></h2>
        <div className="loc-subtitle" id="locSubtitle">
          {total ? `${total} applied · ${verb} a bubble for count` : "Applied, rejected, interview and offer"}
        </div>
      </div>
      <div className={open ? "loc-bubbles has-open" : "loc-bubbles"} id="locBubbles" ref={rootRef}>{content}</div>
    </div>
  );
}
