"use client";
/**
 * The Tracker page (Jobs view). Owns the list filters, the loaded page of
 * cards, the sidebar counts, the open card and "Select jobs".
 *
 * Data flow: filters + page -> GET /api/jobs. After any write a card asks
 * for afterWrite(id): the card is reloaded from the API (the server is the
 * source of truth), dropped if it no longer fits the status filter, and the
 * counts are reloaded. No counts are patched by hand on the client.
 */
import { matchesStatusFilter, type TrackerJob } from "@tracker/core/status";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/tracker/api";
import type { Job, JobPage, Stats } from "@/lib/tracker/types";
import { BatchBar } from "./BatchBar";
import { DEFAULT_FILTERS, type Filters, OPEN_VIEW_FILTERS, companyKey, toQuery, uniqueCompanies } from "./filters";
import { JobList } from "./JobList";
import { Sidebar } from "./Sidebar";
import { type Layout, Toolbar } from "./Toolbar";
import { TrackerContext, type TrackerActions } from "./TrackerContext";

const SEARCH_DEBOUNCE_MS = 600; // wait until typing pauses
const BATCH_DELETE_MAX = 80; // the API's cap per request

const fits = (job: Job, status: string) => matchesStatusFilter(job as unknown as TrackerJob, status);

export function TrackerApp() {
  const toast = useToast();
  const dialog = useDialog();

  // ── Filters and the URL (?company=…&applied=…) ────────────────────────
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false); // URL read; avoids loading the default list first
  const [openId, setOpenId] = useState(""); // ?open=<id> deep link, consumed once

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const companies = uniqueCompanies(params.getAll("company"));
    const applied = (params.get("applied") ?? "").trim();
    setOpenId((params.get("open") ?? "").trim());
    if (companies.length || /^\d{4}-\d{2}-\d{2}$/.test(applied)) {
      // A company / applied-day link shows every such job, whatever the status
      setFilters({ ...DEFAULT_FILTERS, ...OPEN_VIEW_FILTERS, companies, appliedOn: applied });
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("company");
    params.delete("applied");
    params.delete("open");
    filters.companies.forEach((name) => params.append("company", name));
    if (filters.appliedOn) params.set("applied", filters.appliedOn);
    const qs = params.toString();
    window.history.replaceState({}, "", qs ? `/?${qs}` : "/");
    const parts = [...filters.companies, filters.appliedOn && `Applied ${filters.appliedOn}`].filter(Boolean);
    document.title = parts.length ? `${parts.join(" · ")} · Job Tracker` : "Job Tracker";
  }, [ready, filters.companies, filters.appliedOn]);

  const changeFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);

  // Search waits for a pause in typing
  useEffect(() => {
    if (searchText === filters.q) return;
    const timer = setTimeout(() => changeFilters({ q: searchText }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.q, changeFilters]);

  // ── The list ──────────────────────────────────────────────────────────
  const [data, setData] = useState<JobPage | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0); // bump to load the same page again
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setData(null);
    setError("");
    api.listJobs(toQuery(filters, page), controller.signal)
      .then(setData)
      .catch((err: Error) => { if (err.name !== "AbortError") setError(err.message); });
    return () => controller.abort(); // a newer request replaces this one
  }, [ready, filters, page, reloadKey]);

  // ── Sidebar counts ────────────────────────────────────────────────────
  const [stats, setStats] = useState<Stats | null>(null);
  const refreshStats = useCallback(() => {
    api.stats().then(setStats).catch(() => {});
  }, []);
  useEffect(refreshStats, [refreshStats]);

  // ── Open card, deep link, layout ──────────────────────────────────────
  const [expandedId, setExpandedId] = useState("");
  const [flashId, setFlashId] = useState("");
  const [pinned, setPinned] = useState<Job | null>(null);
  const [layout, setLayoutState] = useState<Layout>("compact");
  useEffect(() => {
    try {
      if (localStorage.getItem("jobLayout") === "cards") setLayoutState("cards");
    } catch { /* storage blocked: keep the default */ }
  }, []);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    setExpandedId("");
    try { localStorage.setItem("jobLayout", next); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!openId || !data) return;
    const id = openId;
    setOpenId("");
    const show = () => {
      setExpandedId(id);
      setFlashId(id);
      setTimeout(() => setFlashId(""), 2800);
      requestAnimationFrame(() => document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      toast("Opened matched job");
    };
    if (data.jobs.some((j) => j._id === id)) return show();
    api.getJob(id)
      .then((job) => { setPinned(job); show(); })
      .catch((err: Error) => toast(err.message || "Job not found", "err"));
  }, [openId, data, toast]);

  // Esc closes the open card (not while typing, a dialog, or the filter popover is up)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !expandedId) return;
      if (document.querySelector(".tl-modal-backdrop")) return;
      const pop = document.getElementById("filterPop");
      if (pop && !pop.hidden) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      setExpandedId("");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expandedId]);

  // ── Select jobs ───────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    reload();
    refreshStats();
  };

  // ── What cards can ask for ────────────────────────────────────────────
  const statusRef = useRef(filters.status);
  statusRef.current = filters.status;

  const removeCard = useCallback((id: string) => {
    setData((d) => (d && { ...d, jobs: d.jobs.filter((j) => j._id !== id), total: Math.max(0, d.total - 1) }));
    setPinned((p) => (p?._id === id ? null : p));
    setSelected((s) => { const next = new Set(s); next.delete(id); return next; });
  }, []);

  const afterWrite = useCallback(async (id: string) => {
    try {
      const job = await api.getJob(id);
      if (!fits(job, statusRef.current)) {
        removeCard(id);
      } else {
        setData((d) => (d && { ...d, jobs: d.jobs.map((j) => (j._id === id ? job : j)) }));
        setPinned((p) => (p?._id === id ? job : p));
      }
    } catch {
      removeCard(id); // gone (deleted elsewhere)
    }
    refreshStats();
  }, [removeCard, refreshStats]);

  const filterByCompany = useCallback((name: string) => {
    const company = name.trim();
    if (!company) return;
    setFilters((f) => {
      if (f.companies.some((c) => companyKey(c) === companyKey(company))) return f;
      // First company chip: every job at that company, whatever the other filters were
      const reset = f.companies.length === 0 ? OPEN_VIEW_FILTERS : {};
      return { ...f, ...reset, companies: [...f.companies, company] };
    });
    if (filters.companies.length === 0) setSearchText(""); // the first chip resets the search too
    setPage(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [filters.companies.length]);

  const actions = useMemo<TrackerActions>(() => ({
    afterWrite,
    removeCard,
    refreshStats,
    filterByCompany,
    selectMode,
    isSelected: (id) => selected.has(id),
    toggleSelected: (id, on) => setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id); else next.delete(id);
      return next;
    }),
  }), [afterWrite, removeCard, refreshStats, filterByCompany, selectMode, selected]);

  const countLabel = data ? `Page ${data.page} of ${data.pages} (${data.total} total)` : "";

  return (
    <TrackerContext.Provider value={actions}>
      <div className="app">
        <Sidebar stats={stats} status={filters.status} onStatus={(status) => changeFilters({ status })} showStatuses />
        <main className="main">
          <div className="page-head">
            <div className="tabs" role="tablist" aria-label="Tracker views">
              <button type="button" role="tab" id="tabJobs" aria-selected="true">Jobs</button>
              {/* Overview and Stacks move to the new stack in phase 3 */}
            </div>
            <div className="page-actions">
              <button
                id="refreshBtn" className="ui-btn"
                onClick={() => { reload(); refreshStats(); }}
              >
                Refresh
              </button>
            </div>
          </div>
          <div id="jobsView" className="tracker-view" role="tabpanel" aria-labelledby="tabJobs">
            <Toolbar
              filters={filters} searchText={searchText} onSearchText={setSearchText} onChange={changeFilters}
              onRemoveCompany={(name) => changeFilters({ companies: filters.companies.filter((c) => companyKey(c) !== companyKey(name)) })}
              layout={layout} onLayout={setLayout}
              selectMode={selectMode}
              onSelectMode={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
              countLabel={countLabel}
            />
            <BatchBar
              selectMode={selectMode} count={selected.size} busy={deleting}
              onSelectAll={() => setSelected(new Set((data?.jobs ?? []).map((j) => j._id)))}
              onClear={() => setSelected(new Set())} onDelete={deleteSelected}
            />
            <JobList
              jobs={data ? data.jobs : null} error={error} layout={layout} selectMode={selectMode}
              expandedId={expandedId} onExpand={setExpandedId} flashId={flashId} pinned={pinned}
            />
            {data && data.pages > 1 ? (
              <div className="pagination" id="pagination" style={{ display: "flex" }}>
                <button type="button" className="pagination-btn" disabled={page <= 1}
                  onClick={() => { setPage(page - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Previous</button>
                <span className="page-info">Page {data.page} of {data.pages}</span>
                <button type="button" className="pagination-btn" disabled={page >= data.pages}
                  onClick={() => { setPage(page + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Next</button>
              </div>
            ) : null}
          </div>
        </main>
      </div>
      <PanelScrim open={!!expandedId} onClose={() => setExpandedId("")} />
    </TrackerContext.Provider>
  );
}

/**
 * Below 1080px the details panel is a sheet over the list: a scrim behind it
 * closes it, and the page behind does not scroll (html.ui-lock).
 */
function PanelScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1080px)");
    const update = () => setStacked(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const show = open && stacked;
  useEffect(() => {
    if (!show) return;
    const y = window.scrollY;
    document.documentElement.classList.add("ui-lock");
    document.body.style.top = `-${y}px`;
    return () => {
      document.documentElement.classList.remove("ui-lock");
      document.body.style.top = "";
      window.scrollTo(0, y);
    };
  }, [show]);
  return <div id="panelScrim" className="panel-scrim" hidden={!show} role="button" aria-label="Close details" onClick={onClose} />;
}
