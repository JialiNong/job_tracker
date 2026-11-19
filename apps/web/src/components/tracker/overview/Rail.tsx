"use client";
/**
 * Pipeline rail: one bar, to scale, where the full width is every opened job.
 * Not in English | in English, not matched | AI matched, with Applied inside
 * matched, Got interview inside Applied, Offer inside Got interview. Volume
 * parts are a share of opened jobs; interview and offer a share of Applied.
 *
 * A part too narrow for its text shows the text under the bar instead: that
 * needs a measurement after layout (useLayoutEffect, before paint).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useElementSize } from "@/components/hooks/useElementSize";
import { useMediaQuery } from "@/components/hooks/useMediaQuery";
import type { Stats } from "@/lib/tracker/types";

const fmt = (n: number) => n.toLocaleString("en-US");
function pctOf(n: number, of: number, unit: string) {
  if (!of) return `0% of ${unit}`;
  const p = (n / of) * 100;
  return `${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}% of ${unit}`;
}
const share = (n: number, of: number) => (of ? `${(n / of) * 100}%` : "0%");

type Key = "german" | "english" | "matched" | "applied" | "interview" | "offer";

export function Rail({ stats }: { stats: Stats | null }) {
  const f = stats?.funnel;
  const opened = f?.title_clicked ?? 0;
  const german = f?.german_filtered ?? 0;
  const matched = f?.ai_matched ?? 0;
  const applied = f?.applied ?? 0;
  const appliedSlice = Math.min(applied, matched);
  const interviewed = Math.min(f?.interviewed ?? 0, applied);
  const offer = Math.min(f?.offer ?? 0, applied);
  // Manually logged / API jobs can push "matched" past the English count: clamp
  const englishRest = Math.max(opened - german - matched, 0);
  const total = german + englishRest + matched;

  const parts: Record<Key, { count: number; label: string; pct: string; width: string; title?: string }> = {
    german: { count: german, label: "Skipped, not in English", pct: pctOf(german, total, "opened"), width: share(german, total) },
    english: { count: englishRest, label: "In English, not matched", pct: pctOf(englishRest, total, "opened"), width: share(englishRest, total) },
    matched: { count: matched, label: "AI matched", pct: pctOf(matched, total, "opened"), width: share(matched, total) },
    applied: { count: appliedSlice, label: "Applied (incl. rejected)", pct: pctOf(applied, total, "opened"), width: share(appliedSlice, matched) },
    interview: {
      count: interviewed, label: "Got interview", pct: pctOf(interviewed, applied, "applied"),
      width: share(interviewed, appliedSlice || applied), title: "Invite, a round, or offer — including jobs later marked rejected",
    },
    offer: { count: offer, label: "Offer", pct: pctOf(offer, applied, "applied"), width: share(offer, interviewed) },
  };

  const [barRef, barSize] = useElementSize<HTMLDivElement>();
  const compact = useMediaQuery("(max-width: 760px)");
  const [narrow, setNarrow] = useState<Set<Key>>(new Set());
  const segRefs = useRef(new Map<Key, HTMLDivElement>());

  useLayoutEffect(() => {
    const next = new Set<Key>();
    for (const [key, seg] of segRefs.current) {
      if (parts[key].count === 0) continue;
      const label = seg.querySelector<HTMLElement>(":scope > .seg-label");
      const inner = seg.querySelector<HTMLElement>(":scope > .seg");
      if (!label) continue;
      const room = seg.clientWidth - (inner && !inner.hidden ? inner.offsetWidth : 0);
      const need = Math.max(...[...label.children].map((c) => (c as HTMLElement).offsetWidth)) + 24;
      if (compact || need > room) next.add(key);
    }
    if (parts.offer.count === 0) next.add("offer"); // Offer is always listed, even at 0
    setNarrow((prev) => (prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next));
  }, [barSize.width, compact, stats]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (key: Key, withIds: boolean) => (
    <>
      <span className="funnel-num" id={withIds ? `f-${key}` : undefined}>{stats ? fmt(parts[key].count) : "–"}</span>
      <span className="funnel-label">{parts[key].label}</span>
      {parts[key].pct ? <span className="funnel-pct">{parts[key].pct}</span> : null}
    </>
  );
  const seg = (key: Key, children?: ReactNode) => (
    <div
      className={narrow.has(key) ? `seg seg-${key} narrow` : `seg seg-${key}`} data-key={key}
      ref={(el) => { if (el) segRefs.current.set(key, el); else segRefs.current.delete(key); }}
      style={{ width: parts[key].width }} hidden={parts[key].count === 0} title={parts[key].title}
    >
      <div className="seg-label">{label(key, true)}</div>
      {children}
    </div>
  );

  return (
    <section className="funnel-bar" id="funnelBar" aria-label="Pipeline">
      <div className="rail-head">
        <span className="rail-total" id="f-clicked">{stats ? fmt(opened) : "–"}</span>
        <span className="rail-total-label">jobs opened after the title check. The bar below is all of them, to scale.</span>
      </div>
      <div className="rail-bar" id="railBar" ref={barRef}>
        {seg("german")}
        {seg("english")}
        {seg("matched", seg("applied", seg("interview", seg("offer"))))}
      </div>
      <div className="rail-outside" id="railOutside">
        {(["german", "english", "matched", "applied", "interview", "offer"] as Key[]).filter((k) => narrow.has(k)).map((key) => (
          <div key={key} className={`rail-out rail-out-${key}`}><span className="sw" />{label(key, false)}</div>
        ))}
      </div>
    </section>
  );
}
