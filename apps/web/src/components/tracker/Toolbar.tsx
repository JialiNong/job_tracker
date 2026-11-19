"use client";
/** Search (with company chips), the Filters popover, and the list toggles above the job list. */
import { useEffect, useRef, useState } from "react";
import { type Filters, changedFilterCount } from "./filters";

export type Layout = "compact" | "cards";

interface Props {
  filters: Filters;
  searchText: string;
  onSearchText: (text: string) => void;
  onChange: (patch: Partial<Filters>) => void;
  onRemoveCompany: (name: string) => void;
  layout: Layout;
  onLayout: (layout: Layout) => void;
  selectMode: boolean;
  onSelectMode: () => void;
  countLabel: string;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

export function Toolbar(props: Props) {
  const { filters, onChange } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="toolbar">
      <label className="search">
        <SearchIcon />
        <div className="search-field" id="searchField" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) inputRef.current?.focus(); }}>
          <span className="search-chips" id="companyFilterChips">
            {filters.companies.map((name) => (
              <span className="search-chip" key={name} title={`Jobs at ${name}`}>
                <span className="cfc-name">{name}</span>
                <button
                  type="button" title={`Remove ${name}`} aria-label={`Remove ${name}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onRemoveCompany(name); }}
                />
              </span>
            ))}
          </span>
          <input
            ref={inputRef} type="search" id="searchInput" aria-label="Search title or company"
            placeholder={filters.companies.length ? "Search titles, or click a company to add" : "Search title or company"}
            value={props.searchText} onChange={(e) => props.onSearchText(e.target.value)}
            onKeyDown={(e) => {
              // Backspace in an empty box removes the last company chip
              if (e.key === "Backspace" && !props.searchText && filters.companies.length) {
                e.preventDefault();
                props.onRemoveCompany(filters.companies[filters.companies.length - 1]!);
              }
            }}
          />
        </div>
      </label>
      <FilterPopover filters={filters} onChange={onChange} />
      <button
        type="button" id="highlightsFilter" title="Show manually highlighted jobs only"
        className={filters.highlightsOnly ? "filter-highlights active" : "filter-highlights"}
        onClick={() => onChange({ highlightsOnly: !filters.highlightsOnly })}
      >
        ★ Highlights
      </button>
      <button
        type="button" id="selectModeBtn" title="Show checkboxes to pick jobs for Delete / Fetch details / Run AI"
        className={props.selectMode ? "ui-btn batch-fetch-btn active" : "ui-btn batch-fetch-btn"}
        onClick={props.onSelectMode}
      >
        {props.selectMode ? "Done selecting" : "Select jobs"}
      </button>
      <div className="layout-toggle" id="layoutToggle">
        {(["compact", "cards"] as const).map((mode) => (
          <button
            key={mode} type="button" data-layout={mode} className={props.layout === mode ? "active" : undefined}
            title={mode === "compact" ? "List with a details panel" : "Cards: score, title, company, location — tap for a details sheet"}
            onClick={() => props.onLayout(mode)}
          >
            {mode === "compact" ? "List" : "Cards"}
          </button>
        ))}
      </div>
      {filters.appliedOn ? (
        <span className="company-filter-chip" id="appliedFilterChip" title="Jobs applied or reapplied on this day">
          Applied <span className="cfc-name" id="appliedFilterName">{filters.appliedOn}</span>
          <button type="button" title="Clear applied-day filter" aria-label="Clear applied-day filter" onClick={() => onChange({ appliedOn: "" })}>×</button>
        </span>
      ) : null}
      <span className="count-label" id="countLabel">{props.countLabel}</span>
    </div>
  );
}

const SELECTS: { key: "source" | "origin" | "country" | "timePreset"; label: string; title?: string; options: [string, string][] }[] = [
  { key: "source", label: "Source", options: [["all", "All Sources"], ["linkedin", "LinkedIn"], ["indeed", "Indeed"], ["ats", "ATS"], ["arbeitnow", "Arbeitnow API"], ["arbeitsagentur", "Bundesagentur"], ["adzuna", "Adzuna API"]] },
  { key: "origin", label: "Added by", title: "How the job got onto the Tracker", options: [["all", "All Origins"], ["pipeline", "Scraper"], ["api", "API sources"], ["manual", "Log Job (manual)"], ["agent", "AI agent"]] },
  { key: "country", label: "Region", options: [["germany", "Germany"], ["europe", "Europe (excl. Germany)"], ["remote", "Remote (global)"], ["all", "All Countries"]] },
  { key: "timePreset", label: "Matched", options: [["all", "All Time"], ["today", "Today"], ["3", "Last 3 Days"], ["7", "Last 7 Days"], ["30", "Last 30 Days"], ["custom", "Custom Time"]] },
];

/** "Filters" button + popover. Closes on outside click, Esc, or picking a value (except Custom Time). */
function FilterPopover({ filters, onChange }: { filters: Filters; onChange: (patch: Partial<Filters>) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const changed = changedFilterCount(filters);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (key: (typeof SELECTS)[number]["key"], value: string) => {
    onChange({ [key]: value });
    if (!(key === "timePreset" && value === "custom")) { setOpen(false); buttonRef.current?.focus(); }
  };

  return (
    <div className="filter-pop" ref={wrapRef}>
      <button
        ref={buttonRef} type="button" className="ui-btn" id="filterBtn" aria-expanded={open} aria-controls="filterPop"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        {changed ? `Filters (${changed})` : "Filters"}
      </button>
      <div className="pop" id="filterPop" hidden={!open}>
        {SELECTS.map((s) => (
          <label key={s.key}>{s.label}
            <select id={`${s.key === "timePreset" ? "timePreset" : `${s.key}Filter`}`} title={s.title}
              value={filters[s.key]} onChange={(e) => pick(s.key, e.target.value)}>
              {s.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        ))}
        <div className={filters.timePreset === "custom" ? "filter-group filter-dates" : "filter-group filter-dates hidden-filter"} id="customDateGroup">
          <input type="date" id="dateFrom" aria-label="From date" value={filters.dateFrom} onChange={(e) => onChange({ dateFrom: e.target.value })} />
          <span>to</span>
          <input type="date" id="dateTo" aria-label="To date" value={filters.dateTo} onChange={(e) => onChange({ dateTo: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
