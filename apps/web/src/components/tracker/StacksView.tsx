"use client";
/**
 * Stacks tab: frameworks and tools named in each applied job's JD, grouped,
 * with how many of each group were rejected. Numbers come from the server's
 * cache (refreshed nightly); Recompute rebuilds it from every JD.
 */
import { useEffect, useState } from "react";
import { useRecomputeStacks, useStacks } from "@/lib/tracker/queries";
import { COPY, type Lang, SMALL_SAMPLE, type StacksCopy } from "@/lib/tracker/stacks-copy";
import type { StackRow, StackSummary } from "@/lib/tracker/types";

const LANG_KEY = "tracker.stacks.lang";
const GROUPS = ["frontend", "backend", "node", "non_node", "database", "deploy", "monitoring"];
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

function formatUpdated(iso: string | undefined, lang: Lang): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", today
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StackRowView({ row, label, sub, maxApplied, total, base, t }: {
  row: StackRow; label: string; sub: string; maxApplied: number; total: number; base: number; t: StacksCopy;
}) {
  const p = pct(row.rejected, row.applied);
  const tip = t.rowTip(label, row.applied, row.rejected, p, base);
  return (
    <li className="stk-row" title={tip}>
      <div className="stk-label"><strong>{label}</strong>{sub ? <small>{sub}</small> : null}</div>
      <div className="stk-share">
        <span className="stk-share-text"><b>{t.jobs(row.applied)}</b><span>{pct(row.applied, total)}%</span></span>
        <span className="stk-track"><i style={{ width: `${maxApplied ? (row.applied / maxApplied) * 100 : 0}%` }} /></span>
      </div>
      <div className="stk-rate" role="img" aria-label={tip}>
        <span className="stk-line" />
        <span className="stk-base" style={{ left: `${base}%` }} />
        <span className={row.applied < SMALL_SAMPLE ? "stk-dot small" : "stk-dot"} style={{ left: `${p}%` }} />
        <span className="stk-pct" style={{ left: `clamp(1.2rem, ${p}%, calc(100% - 1.2rem))` }}>{p}%</span>
      </div>
    </li>
  );
}

function GroupPanel({ group, summary, t }: { group: string; summary: StackSummary; t: StacksCopy }) {
  const copy = t.groups[group]!;
  const rows = (summary[group] as StackRow[] | undefined) ?? [];
  const base = pct(summary.rejected, summary.applied);
  const maxApplied = Math.max(0, ...rows.map((r) => r.applied));
  return (
    <section className="panel stacks-panel" data-group={group}>
      <h2 className="stk-title">{copy.title} <span>{copy.sub}</span></h2>
      <div className="stk-cols" aria-hidden="true">
        <span>{t.colGroup}</span><span>{t.colShare}</span>
        <span className="stk-scale"><span>{t.colRate} 0%</span><span>50%</span><span>100%</span></span>
      </div>
      <ul className="stk-list">
        {rows.length ? rows.map((row) => {
          const [label, sub] = copy.rows?.[row.key] ?? [row.label ?? row.key, ""];
          return <StackRowView key={row.key} row={row} label={label} sub={sub} maxApplied={maxApplied} total={summary.applied} base={base} t={t} />;
        }) : <li className="stk-empty muted">–</li>}
      </ul>
    </section>
  );
}

export function StacksView({ open }: { open: boolean }) {
  const stacks = useStacks(open);
  const recompute = useRecomputeStacks();
  const [range, setRange] = useState<"all" | "settled">("all");
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try { if (localStorage.getItem(LANG_KEY) === "zh") setLangState("zh"); } catch { /* storage blocked */ }
  }, []);
  const setLang = (next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* private mode: keep it for this visit */ }
  };

  const t = COPY[lang];
  const data = stacks.data;
  const days = data?.settled_after_days ?? 30;
  const summary = data?.[range];
  const updated = formatUpdated(data?.computed_at, lang);

  return (
    <div id="stacksView" className="tracker-view stacks" role="tabpanel" aria-labelledby="tabStacks" hidden={!open} lang={lang}>
      <section className="stacks-head panel">
        <div className="stacks-head-top">
          <div className="stacks-totals" id="stacksTotals">
            {summary ? (
              <>
                <b>{summary.applied}</b> {t.totals.applications} <span className="sep" />{" "}
                <b>{summary.rejected}</b> {t.totals.rejected} <span className="sep" />{" "}
                {t.totals.overallBefore} <b>{pct(summary.rejected, summary.applied)}%</b> {t.totals.overall}
              </>
            ) : <span className="muted">{stacks.isLoading || !open ? t.loading : t.failed}</span>}
          </div>
          <div className="stacks-controls">
            <div className="seg-toggle" role="group" id="stacksRange" aria-label="Applications">
              <button type="button" aria-pressed={range === "all"} onClick={() => setRange("all")}>{t.rangeAll}</button>
              <button type="button" aria-pressed={range === "settled"} onClick={() => setRange("settled")}>{t.rangeSettled(days)}</button>
            </div>
            <div className="seg-toggle" role="group" id="stacksLang" aria-label="Language">
              <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
              <button type="button" lang="zh" aria-pressed={lang === "zh"} onClick={() => setLang("zh")}>中文</button>
            </div>
          </div>
        </div>
        <div className="stacks-freshness">
          <span id="stacksUpdated">{updated ? t.updated(updated) : ""}</span>
          <button
            type="button" className="stacks-recompute" id="stacksRecompute" title={t.recomputeTip}
            disabled={recompute.isPending || stacks.isLoading} onClick={() => recompute.mutate()}
          >
            {recompute.isPending ? t.recomputing : t.recompute}
          </button>
        </div>
        <p className="stacks-intro" id="stacksIntro">{t.intro(days)}</p>
        <div className="stacks-key" id="stacksKey">
          <span><i className="k-dot" />{t.keyRate}</span>
          <span><i className="k-hollow" />{t.keySmall}</span>
          <span><i className="k-base" />{t.keyBase}</span>
        </div>
      </section>
      {summary ? GROUPS.map((g) => <GroupPanel key={g} group={g} summary={summary} t={t} />) : null}
      <p className="stacks-foot" id="stacksFoot">{t.foot}</p>
    </div>
  );
}
