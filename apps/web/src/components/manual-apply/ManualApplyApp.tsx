"use client";
/**
 * The Log Job page: paste job URLs, see where each is already stored, save
 * them to the Tracker. Port of static/js/manual_apply.js.
 *
 * "Save Link Only" runs on the server. "Scrape & Log Job" needs the browser
 * scraper, which only runs locally; this server answers 503 and the banner
 * says so.
 */
import { useEffect, useRef, useState } from "react";
import { PageSide } from "@/components/shell/PageNav";
import { type LogRun, type LookupResult, pagesApi } from "@/lib/pages/api";

type BannerType = "running" | "info" | "success" | "error";
interface Banner { type: BannerType; body: React.ReactNode }

interface Lookup {
  results: LookupResult[];
  hits: LookupResult[];
  misses: LookupResult[];
  trackerHits: LookupResult[];
  promotableHits: LookupResult[];
}

const POLL_MS = 1500;

/** Pasted text -> a URL: strips <…>, quotes and trailing punctuation; adds https:// when missing. */
function normalizePastedUrl(raw: string): string {
  let u = raw.trim();
  if (!u || u.startsWith("#")) return "";
  u = u.replace(/^<+|>+$/g, "").trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) u = u.slice(1, -1).trim();
  u = u.replace(/[.,;:)\]"']+$/g, "");
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u) ? u : `https://${u}`;
}

const parseUrlLines = (raw: string) => raw.split("\n").map(normalizePastedUrl).filter((u) => /^https?:\/\//i.test(u));

function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function lineClass(line: string): string | undefined {
  const l = line.trim();
  if (l.startsWith("Saved to the Tracker") || l.startsWith("Marked the existing")) return "ok";
  if (l.startsWith("Already on the Tracker") || l.startsWith("Same posting")) return "info";
  if (/fail/i.test(l) && !/^Saved \d+/.test(l)) return "err";
  if (l.startsWith("[") && l.includes("/")) return "head";
  return undefined;
}

function stageLabel(h: LookupResult): string {
  if (h.stage === "tracker" || h.on_tracker) return "Already on Tracker";
  if (h.stage === "awaiting_match") return "Scraped, awaiting AI — not on Tracker (use Scrape & Log to add)";
  if (h.stage === "unmatched") {
    const score = h.match_score != null ? ` · score ${Number(h.match_score).toFixed(1)}` : "";
    return `Scored Unmatched${score} — not on Tracker (use Scrape & Log to add)`;
  }
  if (h.stage === "timeout") return "Timeout review — not on Tracker yet";
  return h.collection || "DB";
}

function TitleCompany({ hit }: { hit: LookupResult }) {
  return <><strong>{hit.title || "job"}</strong>{hit.company ? ` · ${hit.company}` : ""}</>;
}

function Spinner() {
  return <div className="spinner" />;
}

export function ManualApplyApp() {
  const [status, setStatus] = useState<"pending" | "applied">("pending");
  const [appliedDate, setAppliedDate] = useState("");
  const [recommendedBy, setRecommendedBy] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [urlText, setUrlText] = useState("");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[] | null>(null); // null: the log panel is hidden
  const [counts, setCounts] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const lookupSeq = useRef(0);
  const lastLookupKey = useRef("");
  const lookupTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Applied date defaults to today in the browser's calendar (set after mount: no SSR mismatch)
  useEffect(() => setAppliedDate(todayIsoDate()), []);
  useEffect(() => () => { clearTimeout(lookupTimer.current); clearTimeout(pollTimer.current); }, []);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const lookup = async (urls: string[], autoOpen: boolean): Promise<Lookup | null> => {
    if (!urls.length) return null;
    const key = urls.join("\n");
    if (key === lastLookupKey.current && !autoOpen) return null;
    const seq = ++lookupSeq.current;
    setBanner({ type: "running", body: <><Spinner /> Checking if URL already exists…</> });
    try {
      const { results } = await pagesApi.lookup(urls);
      if (seq !== lookupSeq.current) return null;
      const hits = results.filter((r) => r.found);
      const out: Lookup = {
        results, hits, misses: results.filter((r) => !r.found),
        trackerHits: hits.filter((h) => h.on_tracker), promotableHits: hits.filter((h) => !h.on_tracker),
      };
      lastLookupKey.current = key;
      if (!hits.length) {
        setBanner({ type: "info", body: <>New URL(s) — not in DB yet. Use <strong>Scrape &amp; Log</strong> or <strong>Save Link Only</strong>.</> });
        return out;
      }
      // One URL already on the Tracker: open its card (on paste only; submitting
      // must still run so Applied can update it). Cards without details stay here.
      if (autoOpen && urls.length === 1 && out.trackerHits.length === 1 && !out.misses.length) {
        const hit = out.trackerHits[0]!;
        if (hit.needs_scrape || hit.details_missing || hit.ai_pending) {
          setBanner({
            type: "info",
            body: (
              <>
                Already on Tracker without details: <TitleCompany hit={hit} /> — use <strong>Scrape &amp; Log</strong> to
                fetch + AI, or Run AI on the card.
                {hit.open_path ? <> <a className="btn-open" href={hit.open_path}>Open card →</a></> : null}
              </>
            ),
          });
          return out;
        }
        setBanner({ type: "success", body: <>Already in Tracker: <TitleCompany hit={hit} /> — opening…</> });
        if (hit.open_path) setTimeout(() => { window.location.href = hit.open_path!; }, 350);
        return out;
      }
      const parts: React.ReactNode[] = [];
      if (out.trackerHits.length) parts.push(`${out.trackerHits.length} already on Tracker`);
      if (out.promotableHits.length) {
        parts.push(<>{out.promotableHits.length} already scraped but <strong>not on Tracker</strong> — use Scrape &amp; Log or Save Link Only to add</>);
      }
      if (out.misses.length) parts.push(`${out.misses.length} new`);
      setBanner({
        type: "info",
        body: (
          <>
            {parts.map((p, i) => <span key={i}>{i ? ". " : ""}{p}</span>)}.
            <div className="exist-list">
              {hits.map((h) => (
                <div className="exist-row" key={h.url}>
                  <div>
                    <div>{h.title || h.job_id || "Job"}{h.company ? ` · ${h.company}` : ""}</div>
                    <div className="exist-meta">{stageLabel(h)}</div>
                  </div>
                  {h.open_path ? <a className="btn-open" href={h.open_path}>Open →</a> : null}
                </div>
              ))}
            </div>
          </>
        ),
      });
      return out;
    } catch (err) {
      if (seq === lookupSeq.current) setBanner({ type: "error", body: `Lookup error: ${(err as Error).message}` });
      return null;
    }
  };

  const scheduleLookup = (text: string, autoOpen: boolean) => {
    clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(() => {
      const urls = parseUrlLines(text);
      if (!urls.length) {
        setBanner((b) => (b && (b.type === "info" || b.type === "running") ? null : b));
        return;
      }
      void lookup(urls, autoOpen);
    }, autoOpen ? 80 : 450);
  };

  const clearForm = () => {
    clearTimeout(lookupTimer.current);
    clearTimeout(pollTimer.current);
    lookupSeq.current += 1;
    lastLookupKey.current = "";
    setUrlText(""); setTitle(""); setCompany(""); setLocation(""); setRecommendedBy("");
    setStatus("pending"); setAppliedDate(todayIsoDate());
    setBanner(null); setLog(null); setCounts(""); setBusy(false);
  };

  const finish = (run: LogRun, lines: string[], submitted: { status: string; linkOnly: boolean }) => {
    setBusy(false);
    const label = submitted.status === "applied" ? "Applied" : "Not Applied";
    const mode = submitted.linkOnly ? " (link-only, AI pending)" : "";
    const fatal = lines.find((l) => /Fatal error/.test(l));
    const parts: string[] = [];
    if (run.done_count > 0) parts.push(`${run.done_count} saved as ${label}${mode}`);
    if (run.skip_count > 0) parts.push(`${run.skip_count} already on Tracker (skipped)`);
    if (run.fail_count > 0) parts.push(`${run.fail_count} failed`);
    if (run.done_count === 0 && (run.fail_count > 0 || fatal) && run.skip_count === 0) {
      setBanner({ type: "error", body: fatal ?? `All ${run.fail_count || 1} URL(s) failed. Check the log above.` });
    } else if (run.done_count === 0 && run.skip_count > 0 && run.fail_count === 0) {
      setBanner({ type: "error", body: `All ${run.skip_count} URL(s) already on Tracker — nothing saved.` });
    } else if (!parts.length) {
      setBanner({ type: "error", body: "Nothing was saved. Check the log above." });
    } else {
      setBanner({
        type: "success",
        body: <>Done — {parts.join(", ")}.{run.done_count > 0 ? <> <a href="/" style={{ color: "var(--accent)" }}>View Matched →</a></> : null}</>,
      });
    }
  };

  /** Read the run's log until it stops; only lines after the ones shown are fetched. */
  const poll = (lines: string[], submitted: { status: string; linkOnly: boolean }) => {
    pagesApi.logStatus(lines.length).then((run) => {
      const all = [...lines, ...run.log];
      setLog(all);
      setCounts(`${run.done_count} saved, ${run.skip_count} skipped, ${run.fail_count} failed`);
      if (run.running) pollTimer.current = setTimeout(() => poll(all, submitted), POLL_MS);
      else finish(run, all, submitted);
    }).catch(() => {
      pollTimer.current = setTimeout(() => poll(lines, submitted), POLL_MS); // transient network error
    });
  };

  const submit = async (linkOnly: boolean) => {
    if (!urlText.trim()) { alert("Please enter at least one URL."); return; }
    let urls = parseUrlLines(urlText);
    if (!urls.length) { alert("No valid URLs found."); return; }

    // Never auto-open here: Applied must still update an existing card
    const looked = await lookup(urls, false);
    if (looked) {
      const toApply = status === "applied" ? looked.trackerHits.map((h) => h.url) : [];
      const toRefresh = linkOnly ? [] : looked.trackerHits.filter((h) => h.needs_scrape || h.details_missing || h.ai_pending).map((h) => h.url);
      const actionable = [...new Set([...looked.misses.map((m) => m.url), ...looked.promotableHits.map((h) => h.url), ...toApply, ...toRefresh])];
      if (!actionable.length) return; // all on the Tracker already, nothing to mark applied
      urls = actionable;
    }

    const submitted = { status, linkOnly };
    const label = status === "applied" ? "Applied" : "Not Applied";
    setBanner({ type: "running", body: <><Spinner /> {linkOnly ? "Saving link(s)" : "Scraping"} {urls.length} URL(s) as {label}…</> });
    setBusy(true);
    setLog([]);
    setCounts("");
    try {
      await pagesApi.logJobs({
        urls, status, mode: linkOnly ? "link_only" : "scrape", recommended_by: recommendedBy,
        applied_date: status === "applied" ? appliedDate : "", title: title.trim(), company: company.trim(), location: location.trim(),
      });
      poll([], submitted);
    } catch (err) {
      setBanner({ type: "error", body: (err as Error).message || "Failed to start" });
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <PageSide active="log" />
      <main className="main">
        <div className="page">
          <div className="page-head">
            <div>
              <h1>Log a job</h1>
              <p className="subtitle">
                Paste one job URL per line: LinkedIn, Indeed, or any company careers page.
                If a URL is already on the Tracker, pasting it opens that card, and submitting with <strong>Applied</strong> updates it.
              </p>
            </div>
          </div>

          <section className="form-panel" aria-label="Job details">
            <div className="options-row">
              <div className="option-group">
                <label htmlFor="jobStatus">Status</label>
                <select id="jobStatus" className="option-input" value={status} onChange={(e) => setStatus(e.target.value as "pending" | "applied")}>
                  <option value="pending">Not Applied</option>
                  <option value="applied">Applied</option>
                </select>
              </div>
              <div id="appliedDateGroup" className={status === "applied" ? "visible" : undefined}>
                <label htmlFor="appliedDate">Applied on <span className="label-hint">· blank = today</span></label>
                <input type="date" id="appliedDate" className="option-input" value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} />
              </div>
              <div className="option-group">
                <label htmlFor="recommendedBy">Recommended by AI agent</label>
                <select id="recommendedBy" className="option-input" value={recommendedBy} onChange={(e) => setRecommendedBy(e.target.value)}>
                  <option value="">None</option>
                  <option value="claude">Claude</option>
                  <option value="cursor">Cursor</option>
                  <option value="gemini">Gemini</option>
                  <option value="gpt">GPT</option>
                </select>
              </div>
            </div>

            <div className="options-row identity-row">
              {([["jobTitle", "Job title", title, setTitle, 200], ["jobCompany", "Company name", company, setCompany, 160],
                ["jobLocation", "Location / address", location, setLocation, 200]] as const).map(([id, label, value, setValue, max]) => (
                <div className="option-group" key={id}>
                  <label htmlFor={id}>{label}</label>
                  <input
                    type="text" id={id} className="option-input option-text" maxLength={max} placeholder="Optional" autoComplete="off"
                    value={value} onChange={(e) => setValue(e.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="option-group url-group">
              <label htmlFor="urlBox">Job URLs</label>
              <textarea
                id="urlBox" className="url-box" value={urlText}
                placeholder={"https://www.linkedin.com/jobs/view/1234567890/\nhttps://de.indeed.com/viewjob?jk=abcdef123456\nhttps://careers.example.com/jobs/frontend-engineer"}
                onChange={(e) => { setUrlText(e.target.value); scheduleLookup(e.target.value, false); }}
                onPaste={(e) => {
                  // The pasted text is not in the box yet: look up what it will hold
                  const el = e.currentTarget;
                  const pasted = e.clipboardData.getData("text");
                  const next = el.value.slice(0, el.selectionStart) + pasted + el.value.slice(el.selectionEnd);
                  scheduleLookup(next, true);
                }}
              />
            </div>

            <div className="btn-row">
              <button id="submitBtn" className="btn btn-primary" disabled={busy} onClick={() => void submit(false)}>Scrape &amp; Log Job</button>
              <button id="linkOnlyBtn" className="btn btn-secondary" disabled={busy} onClick={() => void submit(true)}>Save Link Only</button>
              <button id="clearBtn" className="btn btn-clear" type="button" onClick={clearForm}>Clear</button>
            </div>
          </section>

          <div id="statusBanner" className={banner ? `status-banner ${banner.type}` : "status-banner"}>{banner?.body}</div>

          <div id="logWrap" className={log ? "log-wrap visible" : "log-wrap"}>
            <div className="log-header">
              <span>Live progress</span>
              <span id="logCounter">{counts}</span>
            </div>
            <div id="logBody" className="log-body" ref={logRef}>
              {(log ?? []).map((line, i) => <div key={i}><span className={lineClass(line)}>{line}</span></div>)}
            </div>
          </div>

          <details className="tip">
            <summary>How logging works</summary>
            <ul>
              <li><strong>Scrape &amp; Log</strong> opens the job page in debug Chrome, saves the details and runs AI. It needs the local scraper, so it only works on the app running on your computer.</li>
              <li><strong>Save Link Only</strong> needs no Chrome. The card waits for AI until you click <strong>Run AI</strong> or <strong>Fetch job details</strong> on the Tracker.</li>
              <li>Default status is <strong>Not Applied</strong>. Switch to Applied when you already applied; notes and timeline on an existing card stay.</li>
              <li><strong>Job title / Company / Location</strong> are saved on the Tracker card (also with Save Link Only). A later scrape only fills fields you left blank.</li>
              <li><strong>Recommended by AI agent</strong> tags the card (Claude, Cursor, Gemini, GPT). Agent-recommended cards get <strong>Fetch job details</strong> (scrape only, no AI).</li>
              <li>URL formats: LinkedIn <code>https://www.linkedin.com/jobs/view/JOB_ID/</code>, Indeed <code>https://de.indeed.com/viewjob?jk=JOB_KEY</code>, other sites: the job detail URL.</li>
            </ul>
          </details>
        </div>
      </main>
    </div>
  );
}
