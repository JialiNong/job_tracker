"use client";
/**
 * The Tracker page (Jobs view).
 *
 * - Filters and page number live in the URL (useFilters).
 * - Server data comes from TanStack Query (lib/tracker/queries.ts): the list
 *   page for the current filters, the sidebar counts, and a deep-linked card.
 *   Writes invalidate those queries, so everything shown follows the saved
 *   data; nothing is patched by hand.
 * - Local UI state here: the open card, "Select jobs", the search box text.
 */
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PanelScrim, useEscapeClose, useLayout } from "@/components/list/listChrome";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import { invalidateTracker, useJob, useJobPage, useStats } from "@/lib/tracker/queries";
import { AgentPushBanner } from "./AgentPushBanner";
import { BatchBar } from "./BatchBar";
import { type Filters, OPEN_VIEW_FILTERS, companyKey, toQuery } from "./filters";
import { JobList } from "./JobList";
import { OverviewView } from "./overview/OverviewView";
import { StacksView } from "./StacksView";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { TrackerContext } from "./TrackerContext";
import { useFilters } from "./useFilters";
import { useRunAi } from "./useRunAi";

const SEARCH_DEBOUNCE_MS = 600; // wait until typing pauses
const VIEWS = [
  { view: "jobs", tab: "tabJobs", panel: "jobsView", label: "Jobs" },
  { view: "overview", tab: "tabOverview", panel: "overviewView", label: "Overview" },
  { view: "stacks", tab: "tabStacks", panel: "stacksView", label: "Stacks" },
] as const;
type View = (typeof VIEWS)[number]["view"];
const BATCH_DELETE_MAX = 80; // the API's cap per request

export function TrackerApp() {
  const toast = useToast();
  const dialog = useDialog();
  const client = useQueryClient();
  const { filters, page, setFilters, setPage, dropParam } = useFilters();

  const list = useJobPage(toQuery(filters, page));
  const stats = useStats();

  // ── Tabs (?view=overview|stacks; Jobs is the default) ────────────────
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawView = searchParams.get("view");
  const view: View = rawView === "overview" || rawView === "stacks" ? rawView : "jobs";
  const showView = (next: View) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "jobs") params.delete("view"); else params.set("view", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = VIEWS.findIndex((v) => v.view === view);
    const next = e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1
      : (i + (e.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
    showView(VIEWS[next]!.view);
    document.getElementById(VIEWS[next]!.tab)?.focus();
  };

  // ── Search box: local while typing, written to the URL after a pause ──
  const [searchText, setSearchText] = useState(filters.q);
  const [lastUrlQ, setLastUrlQ] = useState(filters.q);
  if (filters.q !== lastUrlQ) {
    // The URL changed underneath (back button, a company link): show its text.
    // Adjusting state during render is React's recommended pattern for this.
    setLastUrlQ(filters.q);
    setSearchText(filters.q);
  }
  useEffect(() => {
    if (searchText === filters.q) return;
    const timer = setTimeout(() => setFilters({ q: searchText }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.q, setFilters]);

  // ── Open card and the ?open=<id> deep link ────────────────────────────
  const [expandedId, setExpandedId] = useState("");
  const closeCard = () => setExpandedId("");
  const [flashId, setFlashId] = useState("");
  const [openId] = useState(() => searchParams.get("open") ?? ""); // read once, then dropped from the URL
  const openHandled = useRef(false);
  const onPage = !!list.data?.jobs.some((j) => j._id === openId);
  const pinnedQuery = useJob(openId && list.data && !onPage ? openId : "");

  useEffect(() => {
    if (!openId || openHandled.current || !list.data) return;
    if (!onPage && !pinnedQuery.data && !pinnedQuery.error) return; // still loading the card
    openHandled.current = true;
    dropParam("open");
    if (pinnedQuery.error) return toast(pinnedQuery.error.message || "Job not found", "err");
    setExpandedId(openId);
    setFlashId(openId);
    setTimeout(() => setFlashId(""), 2800);
    requestAnimationFrame(() => document.getElementById(`card-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    toast("Opened matched job");
  }, [openId, onPage, list.data, pinnedQuery.data, pinnedQuery.error, dropParam, toast]);

  useEscapeClose(!!expandedId, closeCard);

  // ── Layout (remembered per browser) ───────────────────────────────────
  const [layout, setLayout] = useLayout(closeCard);

  // ── Select jobs ───────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await dialog.confirm({
      title: `Delete ${ids.length} selected job(s)?`,
      hint: "Removes the postings and their Tracker cards. They will not come back unless scraped or pushed again.",
      detail: ids.length > 1 ? `${ids.length} jobs` : "this job",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    let deleted = 0;
    try {
      for (let i = 0; i < ids.length; i += BATCH_DELETE_MAX) {
        deleted += (await api.batchDelete(ids.slice(i, i + BATCH_DELETE_MAX))).deleted;
      }
      toast(`${deleted} job(s) deleted`);
    } catch (err) {
      toast(`${(err as Error).message}${deleted ? ` (${deleted} deleted before the error)` : ""}`, "err");
    }
    setDeleting(false);
    setSelected(new Set());
    await invalidateTracker(client);
  };

  // ── Run AI (one card, or the selection one after another) ─────────────
  const runAi = useRunAi();
  const selectMissing = async (kind: "missing" | "missing_ai") => {
    setSelectMode(true);
    try {
      const { ids } = await api.fetchTargets(toQuery(filters, page), kind);
      const onThisPage = new Set((data?.jobs ?? []).map((j) => j._id));
      setSelected((prev) => new Set([...prev, ...ids]));
      const elsewhere = ids.filter((id) => !onThisPage.has(id)).length;
      const noun = kind === "missing" ? "missing-details" : "missing-AI";
      toast(ids.length ? `${ids.length} ${noun} job(s) selected${elsewhere ? ` (${elsewhere} on other pages)` : ""}` : `No ${noun} jobs`);
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  const runAiSelected = () => {
    const titles = new Map((data?.jobs ?? []).map((j) => [j._id, j.title]));
    void runAi.runBatch([...selected].map((id) => ({ id, label: titles.get(id) ?? id }))).then(() => setSelected(new Set()));
  };
  const fetchSelected = () => {
    const titles = new Map((data?.jobs ?? []).map((j) => [j._id, j.title]));
    void runAi.runBatch([...selected].map((id) => ({ id, label: titles.get(id) ?? id })), "fetch").then(() => setSelected(new Set()));
  };

  // ── Company filter (chips in the search box) ──────────────────────────
  const filterByCompany = (name: string) => {
    const company = name.trim();
    if (!company || filters.companies.some((c) => companyKey(c) === companyKey(company))) return;
    // The first company chip shows every job at that company, whatever the other filters were
    const reset: Partial<Filters> = filters.companies.length === 0 ? OPEN_VIEW_FILTERS : {};
    setFilters({ ...reset, companies: [...filters.companies, company] });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const data = list.data;
  const countLabel = data ? `Page ${data.page} of ${data.pages} (${data.total} total)` : "";
  const goToPage = (next: number) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <TrackerContext
      value={{
        filterByCompany,
        selectMode,
        isSelected: (id) => selected.has(id),
        toggleSelected: (id, on) => setSelected((s) => {
          const next = new Set(s);
          if (on) next.add(id); else next.delete(id);
          return next;
        }),
        runAi: (id) => void runAi.runOne(id),
        fetchDetails: (id) => void runAi.fetchOne(id),
        isRunningAi: runAi.isRunning,
        batchRunning: !!runAi.batch?.running,
      }}
    >
      <div className="app">
        <Sidebar stats={stats.data ?? null} status={filters.status} onStatus={(status) => setFilters({ status })} showStatuses={view === "jobs"} />
        <main className="main">
          <div className="page-head">
            <div className="tabs" role="tablist" aria-label="Tracker views" onKeyDown={onTabKey}>
              {VIEWS.map((v) => (
                <button
                  key={v.view} type="button" role="tab" id={v.tab} aria-controls={v.panel}
                  aria-selected={view === v.view} tabIndex={view === v.view ? 0 : -1} onClick={() => showView(v.view)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="page-actions">
              <button id="refreshBtn" className="ui-btn" onClick={() => void invalidateTracker(client)}>Refresh</button>
            </div>
          </div>
          <div id="jobsView" className="tracker-view" role="tabpanel" aria-labelledby="tabJobs" hidden={view !== "jobs"}>
            <AgentPushBanner />
            <Toolbar
              filters={filters} searchText={searchText} onSearchText={setSearchText} onChange={setFilters}
              onRemoveCompany={(name) => setFilters({ companies: filters.companies.filter((c) => companyKey(c) !== companyKey(name)) })}
              layout={layout} onLayout={setLayout}
              selectMode={selectMode}
              onSelectMode={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
              countLabel={countLabel}
            />
            <BatchBar
              selectMode={selectMode} count={selected.size} busy={deleting}
              onSelectAll={() => setSelected(new Set((data?.jobs ?? []).map((j) => j._id)))}
              onClear={() => setSelected(new Set())} onDelete={deleteSelected}
              onSelectMissing={(kind) => void selectMissing(kind)} onRunAi={runAiSelected} onFetch={() => void fetchSelected()}
              batch={runAi.batch} banner={runAi.banner} onDismissBanner={runAi.dismissBanner}
            />
            <JobList
              jobs={data ? data.jobs : null} error={list.error?.message ?? ""} layout={layout} selectMode={selectMode}
              expandedId={expandedId} onExpand={setExpandedId} flashId={flashId}
              pinned={!onPage && pinnedQuery.data ? pinnedQuery.data : null}
            />
            {data && data.pages > 1 ? (
              <div className="pagination" id="pagination" style={{ display: "flex" }}>
                <button type="button" className="pagination-btn" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous</button>
                <span className="page-info">Page {data.page} of {data.pages}</span>
                <button type="button" className="pagination-btn" disabled={page >= data.pages} onClick={() => goToPage(page + 1)}>Next</button>
              </div>
            ) : null}
          </div>
          <OverviewView
            open={view === "overview"} stats={stats.data ?? null}
            onOpenAppliedDay={(day) => {
              // Every job applied that day, whatever its status now
              setFilters({ ...OPEN_VIEW_FILTERS, companies: [], appliedOn: day }, { view: null });
            }}
          />
          <StacksView open={view === "stacks"} />
        </main>
      </div>
      <PanelScrim open={!!expandedId} onClose={closeCard} />
    </TrackerContext>
  );
}
