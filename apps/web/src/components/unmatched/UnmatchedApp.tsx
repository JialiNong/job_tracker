"use client";
/**
 * The Unmatched page: postings the gates or the AI turned down. "Can apply"
 * puts one on the Tracker. Port of static/js/unmatched.js; filters and page
 * live in the URL like on the Tracker.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import { useQueryParams } from "@/components/hooks/useQueryParams";
import { LayoutToggle, PanelScrim, useEscapeClose, useLayout } from "@/components/list/listChrome";
import { PageSide } from "@/components/shell/PageNav";
import { useToast } from "@/components/ui/Toast";
import { type UnmatchedJob, type UnmatchedPage, pagesApi } from "@/lib/pages/api";
import { groupByDay, groupHeading, presetRange } from "@/lib/tracker/format";
import { UnmatchedCard } from "./UnmatchedCard";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 600;
const KEY = ["unmatched"] as const;

const DEFAULTS = {
  q: "", source: "all", gate: "all", time: "all", date_from: "", date_to: "",
  score: "all", score_min: "", score_max: "", can: "", agent: "", page: "1", open: "",
};

const SOURCES: [string, string][] = [
  ["all", "All Sources"], ["linkedin", "LinkedIn"], ["indeed", "Indeed"], ["ats", "ATS"],
  ["arbeitnow", "Arbeitnow API"], ["arbeitsagentur", "Bundesagentur"], ["adzuna", "Adzuna API"],
];
const GATES: [string, string][] = [
  ["all", "All gates"], ["german", "German required"], ["non_english", "Not English"],
  ["stack", "Non-JS backend required"], ["not_web_dev", "Not web development"], ["leadership", "Leadership role"],
  ["backend_heavy", "Backend-heavy"], ["too_many_years", "Too many years"], ["contract_or_location", "Contract / location"],
  ["incomplete_desc", "Unusable JD"], ["scored", "Scored below threshold"], ["ai_ml", "AI/ML reject (old runs)"],
];
const TIMES: [string, string][] = [
  ["all", "All Time"], ["today", "Today"], ["3", "Last 3 Days"], ["7", "Last 7 Days"], ["30", "Last 30 Days"], ["custom", "Custom Time"],
];
const SCORES: [string, string][] = [["all", "All Scores"], ["0-3", "0–3 Hard Reject"], ["4-6", "4–6 Weak Match"], ["custom", "Custom Score"]];

const truthy = (v: string) => ["1", "true", "yes"].includes(v.toLowerCase());

export function UnmatchedApp() {
  const [f, setParams, rawParams] = useQueryParams(DEFAULTS);
  const client = useQueryClient();
  const toast = useToast();
  // Old links: ?agent_recommended=1, and dates without a preset mean Custom Time
  const agentOnly = truthy(f.agent || rawParams.get("agent_recommended") || "");
  const time = f.time === "all" && (f.date_from || f.date_to) ? "custom" : f.time;
  const page = Math.max(1, Number.parseInt(f.page, 10) || 1);
  const set = (patch: Partial<Record<keyof typeof DEFAULTS, string | null>>) => setParams({ page: null, ...patch });

  // Search box: typed text now, the URL (and the request) once typing pauses
  const [searchText, setSearchText] = useState(f.q);
  useEffect(() => {
    if (searchText.trim() === f.q) return;
    const t = setTimeout(() => set({ q: searchText.trim() }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchText, f.q]); // eslint-disable-line react-hooks/exhaustive-deps -- set is recreated each render

  const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (f.source !== "all") query.set("source", f.source);
  if (f.gate !== "all") query.set("match_gate", f.gate);
  if (f.q) query.set("q", f.q);
  const dates = presetRange(time, f.date_from, f.date_to);
  if (dates.from) query.set("date_from", dates.from);
  if (dates.to) query.set("date_to", dates.to);
  const scores = f.score === "0-3" ? ["0", "3"] : f.score === "4-6" ? ["4", "6"]
    : f.score === "custom" ? [f.score_min, f.score_max] : ["", ""];
  if (scores[0]) query.set("score_min", scores[0]);
  if (scores[1]) query.set("score_max", scores[1]);
  if (f.can) query.set("user_status", "watchlist");
  if (agentOnly) query.set("agent_recommended", "1");

  const list = useQuery({
    queryKey: [...KEY, "list", query.toString()],
    queryFn: ({ signal }) => pagesApi.unmatched(query, signal),
    placeholderData: keepPreviousData,
  });
  const countOf = (extra: Record<string, string>) => ({
    queryKey: [...KEY, "count", extra],
    queryFn: () => pagesApi.unmatched(new URLSearchParams({ page_size: "1", ...extra })),
    select: (d: UnmatchedPage) => d.total,
  });
  const watchlistCount = useQuery(countOf({ user_status: "watchlist" }));
  const agentCount = useQuery(countOf({ agent_recommended: "1" }));

  // ── Open card, deep link ?open=<id> ──────────────────────────────────
  const [expandedId, setExpandedId] = useState("");
  const closeCard = () => setExpandedId("");
  const [layout, setLayout] = useLayout(closeCard);
  useEscapeClose(!!expandedId, closeCard);
  const [flashId, setFlashId] = useState("");
  const openId = f.open;
  const onPage = !!list.data?.jobs.some((j) => j._id === openId);
  const pinned = useQuery({
    queryKey: [...KEY, "job", openId],
    queryFn: () => pagesApi.unmatchedJob(openId),
    enabled: !!openId && !!list.data && !onPage,
    retry: false,
  });
  const openHandled = useRef(false);
  useEffect(() => {
    if (!openId || openHandled.current || !list.data) return;
    if (!onPage && !pinned.data && !pinned.error) return; // still loading the pinned card
    openHandled.current = true;
    if (pinned.error) {
      toast(pinned.error.message || "Job not found on Unmatched", "err");
      return;
    }
    setExpandedId(openId);
    setFlashId(openId);
    setTimeout(() => setFlashId(""), 2800);
    requestAnimationFrame(() => document.getElementById(`card-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    toast("Opened unmatched job");
  }, [openId, onPage, list.data, pinned.data, pinned.error, toast]);

  // ── Can apply ────────────────────────────────────────────────────────
  const mark = useMutation({
    mutationFn: ({ id, value }: { id: string; value: "" | "watchlist" }) => pagesApi.setUnmatchedStatus(id, value),
    onMutate: ({ id, value }) => {
      // Show the new mark at once; the refetch below confirms it
      const patch = (j: UnmatchedJob) => (j._id === id ? { ...j, user_status: value } : j);
      client.setQueriesData<UnmatchedPage>({ queryKey: [...KEY, "list"] }, (d) => d && { ...d, jobs: d.jobs.map(patch) });
      client.setQueryData<UnmatchedJob>([...KEY, "job", id], (j) => j && patch(j));
    },
    onSuccess: (data, { value }) => {
      if (value !== "watchlist") toast("Mark removed");
      else if (data.copy_error) toast(`Marked but failed to add to the Tracker: ${data.copy_error}`, "err");
      else toast('Marked as "Can apply" — added to the Tracker');
    },
    onError: () => toast("Mark failed", "err"),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });

  const data = list.data;
  const jobs = data?.jobs ?? null;
  const pinnedJob = openId && !onPage && pinned.data ? pinned.data : null;
  const card = (job: UnmatchedJob) => (
    <UnmatchedCard
      key={job._id} job={job} expanded={expandedId === job._id} flash={flashId === job._id}
      onToggle={() => setExpandedId(expandedId === job._id ? "" : job._id)} onClose={closeCard}
      onMark={(value) => mark.mutate({ id: job._id, value })}
    />
  );

  let content: React.ReactNode;
  if (list.error) content = <div className="empty"><h2>Loading Failed</h2><p>{list.error.message}</p></div>;
  else if (jobs === null) content = <div className="spinner" />;
  else if (!jobs.length && !pinnedJob) {
    content = (
      <div className="empty">
        <h2>No Unmatched Jobs</h2>
        <p>Try a different time or score filter, or wait for the next AI matching round.</p>
      </div>
    );
  } else {
    content = groupByDay(jobs).map(([day, group]) => (
      <Fragment key={day}>
        <div className="date-group-header">
          <span>{groupHeading(day)}</span>
          <span className="dg-count">{group.length} jobs</span>
        </div>
        {(group as UnmatchedJob[]).map(card)}
      </Fragment>
    ));
  }

  return (
    <div className="app">
      <PageSide active="unmatched" />
      <main className="main">
        <div className="page-head">
          <div>
            <h1>Unmatched jobs</h1>
            <p>Jobs the gates or the AI turned down. Mark one as Can apply to copy it to the Tracker.</p>
          </div>
          <div className="page-actions">
            <button className="ui-btn" onClick={() => void client.invalidateQueries({ queryKey: KEY })}>Refresh</button>
          </div>
        </div>

        <div className="toolbar">
          <label className="search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <input
              type="search" id="searchInput" value={searchText} onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search title, company or rejection reason" aria-label="Search title, company or rejection reason"
            />
          </label>
          <FilterPopover
            changed={[f.source !== "all", f.gate !== "all", time !== "all", f.score !== "all"].filter(Boolean).length}
            onPick={(key, value, extra) => set({ [key]: value, ...extra })}
            closeOn={(key, value) => !((key === "time" || key === "score") && value === "custom")}
          >
            {(pick) => (
              <>
                <Select label="Source" id="sourceFilter" value={f.source} options={SOURCES} onChange={(v) => pick("source", v)} />
                <Select label="Why it was rejected" id="gateFilter" value={f.gate} options={GATES} onChange={(v) => pick("gate", v)} />
                <Select label="Matched" id="timePreset" value={time} options={TIMES}
                  onChange={(v) => pick("time", v, v === "custom" ? {} : { date_from: null, date_to: null })} />
                <div className={time === "custom" ? "filter-group filter-dates" : "filter-group filter-dates hidden-filter"} id="customDateGroup">
                  <input type="date" aria-label="From date" value={f.date_from} onChange={(e) => set({ time: "custom", date_from: e.target.value })} />
                  <span>to</span>
                  <input type="date" aria-label="To date" value={f.date_to} onChange={(e) => set({ time: "custom", date_to: e.target.value })} />
                </div>
                <Select label="Score" id="scorePreset" value={f.score} options={SCORES}
                  onChange={(v) => pick("score", v, v === "custom" ? {} : { score_min: null, score_max: null })} />
                <div className={f.score === "custom" ? "filter-group" : "filter-group hidden-filter"} id="customScoreGroup">
                  <input type="number" min="0" max="6.9" step="0.5" placeholder="Min" aria-label="Minimum score"
                    defaultValue={f.score_min} onChange={(e) => set({ score_min: e.target.value })} />
                  <span>–</span>
                  <input type="number" min="0" max="6.9" step="0.5" placeholder="Max" aria-label="Maximum score"
                    defaultValue={f.score_max} onChange={(e) => set({ score_max: e.target.value })} />
                </div>
              </>
            )}
          </FilterPopover>
          <button type="button" className={f.can ? "watchlist-chip active" : "watchlist-chip"} onClick={() => set({ can: f.can ? null : "1" })}>
            <span className="watchlist-dot" />
            <span>Can apply</span>
            <b className="watchlist-count">{watchlistCount.data ? `(${watchlistCount.data})` : ""}</b>
          </button>
          <button
            type="button" className={agentOnly ? "watchlist-chip agent-chip active" : "watchlist-chip agent-chip"}
            onClick={() => set({ agent: agentOnly ? null : "1" })}
          >
            <span className="agent-dot" />
            <span>Agent recommended</span>
            <b className="watchlist-count">{agentCount.data ? `(${agentCount.data})` : ""}</b>
          </button>
          <LayoutToggle layout={layout} onLayout={setLayout} />
          <span className="count-label">
            {data ? `Total ${data.total} · Newest First · Threshold ${Number(data.threshold || 7).toFixed(1)}` : ""}
          </span>
        </div>

        <div className={`job-grid layout-${layout}`} id="jobGrid">
          {pinnedJob ? (
            <>
              <div className="open-job-banner">Opened from URL (not on this page/filter) — <strong>{pinnedJob.title}</strong></div>
              {card(pinnedJob)}
            </>
          ) : null}
          {content}
        </div>

        {data ? <Pager page={data.page} pages={data.pages} total={data.total} onPage={(p) => setParams({ page: String(p) })} /> : null}
      </main>
      <PanelScrim open={!!expandedId} onClose={closeCard} />
    </div>
  );
}

function Select({ label, id, value, options, onChange }: {
  label: string; id: string; value: string; options: [string, string][]; onChange: (value: string) => void;
}) {
  return (
    <label>{label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

type Pick = (key: string, value: string, extra?: Record<string, string | null>) => void;

/** "Filters" button + popover; closes on outside click, Esc, or a pick (except a Custom choice). */
function FilterPopover({ changed, onPick, closeOn, children }: {
  changed: number;
  onPick: Pick;
  closeOn: (key: string, value: string) => boolean;
  children: (pick: Pick) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const pick: Pick = (key, value, extra = {}) => {
    onPick(key, value, extra);
    if (closeOn(key, value)) { setOpen(false); buttonRef.current?.focus(); }
  };
  return (
    <div className="filter-pop" ref={wrapRef}>
      <button
        ref={buttonRef} type="button" className="ui-btn" id="filterBtn" aria-expanded={open} aria-controls="filterPop"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        {changed ? `Filters (${changed})` : "Filters"}
      </button>
      <div className="pop" id="filterPop" hidden={!open}>{children(pick)}</div>
    </div>
  );
}

/** Previous · 1 … 4 5 [6] 7 8 … 20 · Next (markup from the old page). */
function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  if (!total) return <div className="pager" id="pager" />;
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, page + 2);
  const go = (p: number) => { onPage(p); window.scrollTo({ top: 0 }); };
  return (
    <div className="pager" id="pager">
      <button disabled={page <= 1} onClick={() => go(page - 1)}>Previous</button>
      {start > 1 ? <><button className="page-btn" onClick={() => go(1)}>1</button><span className="page-info">…</span></> : null}
      {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
        <button key={p} className={p === page ? "page-btn active" : "page-btn"} onClick={() => go(p)}>{p}</button>
      ))}
      {end < pages ? <><span className="page-info">…</span><button className="page-btn" onClick={() => go(pages)}>{pages}</button></> : null}
      <button disabled={page >= pages} onClick={() => go(page + 1)}>Next</button>
      <span className="page-info">Page {page} / {pages}</span>
    </div>
  );
}
