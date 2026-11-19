/* Shared by Tracker and Unmatched (ES module).
   Card chrome lives in static/css/shared/job_list.css: score ring, row
   (title / company / location / via), channel chip, breakdown, toast,
   details sheet. Escaping / link helpers are in ./html.js. */
import { escHtml } from './html.js';
import { filterPopOpen, syncOverlayLock } from './shell.js';

export const TOUCH_UI = !!window.matchMedia?.('(hover: none)').matches;
export const POINT_VERB = TOUCH_UI ? 'tap' : 'hover';
if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-point-verb]').forEach(el => { el.textContent = POINT_VERB; });
}

export let currentLayout = (typeof localStorage !== 'undefined' && localStorage.getItem('jobLayout')) || 'compact';

export const SOURCE_BADGE = {
  ats:            { label: 'ATS',           title: 'Company careers page (ATS board)' },
  arbeitsagentur: { label: 'Bundesagentur', title: 'Bundesagentur für Arbeit Jobsuche API' },
  arbeitnow:      { label: 'Arbeitnow API', title: 'Arbeitnow job board API' },
  adzuna:         { label: 'Adzuna API',    title: 'Adzuna job search API' },
};
export const BOARD_LABEL = { linkedin: 'LinkedIn', indeed: 'Indeed' };
export const RECOMMENDED_BY_LABEL = {
  claude: 'Claude',
  cursor: 'Cursor',
  gemini: 'Gemini',
  gpt: 'GPT',
};
export const ORIGIN_PILL = {
  pipeline: { label: 'Scraper', title: 'Found by the LinkedIn / Indeed scraper' },
  manual:   { label: 'Log job', title: 'Logged by hand via Log Job' },
};


export function showToast(msg, type = 'ok', ms = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => { t.className = 'toast'; }, ms);
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatGroupDate(dateStr) {
  if (!dateStr) return 'Unknown Date';
  const today = formatDate(new Date());
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const yesterday = formatDate(yd);
  if (dateStr === today) return `Today · ${dateStr}`;
  if (dateStr === yesterday) return `Yesterday · ${dateStr}`;
  return dateStr;
}

export function groupJobsByDate(jobs) {
  const groups = new Map();
  jobs.forEach(job => {
    const dateStr = (job.matched_at || '').split(' ')[0] || 'Unknown Date';
    if (!groups.has(dateStr)) groups.set(dateStr, []);
    groups.get(dateStr).push(job);
  });
  return [...groups.entries()];
}

export function currentDateRange() {
  const presetEl = document.getElementById('timePreset');
  if (!presetEl) return { from: '', to: '' };
  const preset = presetEl.value;
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'custom') {
    return {
      from: document.getElementById('dateFrom').value,
      to:   document.getElementById('dateTo').value,
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === 'today') return { from: formatDate(today), to: formatDate(today) };
  const from = new Date(today);
  from.setDate(today.getDate() - (Number(preset) - 1));
  return { from: formatDate(from), to: formatDate(today) };
}

export function consumeOpenJobId(path = '/') {
  const params = new URLSearchParams(location.search);
  const id = (params.get('open') || '').trim();
  if (!id) return '';
  params.delete('open');
  const qs = params.toString();
  history.replaceState({}, '', qs ? `${path}?${qs}` : path);
  return id;
}

/* ── Score ring ──────────────────────────────────────────────────── */

export function scoreCls(score) {
  if (score == null || score === '') return 'score-pending';
  if (score >= 8)  return 'score-hi';
  if (score >= 6)  return 'score-mid';
  return 'score-lo';
}

export function hasAiScore(job) {
  return job && job.match_score != null && job.match_score !== '';
}

function formatScoreBadge(job) {
  if (!hasAiScore(job)) return '—';
  const n = Number(job.match_score);
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function scoreRingPct(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n * 10));
}

/** job object (Tracker) or a raw 0–10 number (Unmatched). */
export function scoreRingHtml(jobOrScore, { size = '' } = {}) {
  const fromJob = jobOrScore != null && typeof jobOrScore === 'object';
  const has = fromJob ? hasAiScore(jobOrScore) : Number.isFinite(Number(jobOrScore));
  const raw = has ? Number(fromJob ? jobOrScore.match_score : jobOrScore) : null;
  const pct = has ? scoreRingPct(raw) : 0;
  const label = fromJob ? formatScoreBadge(jobOrScore)
    : (!has ? '—' : (raw % 1 === 0 ? String(raw) : raw.toFixed(1)));
  const cls = scoreCls(has ? raw : null);
  const sizeCls = size ? ` ${size}` : '';
  const title = has
    ? (fromJob
      ? `Match score ${label} of 10, from Run AI on this site`
      : `Match score ${label} of 10`)
    : (fromJob ? 'No AI match score yet' : 'No score');
  return `
    <div class="score-ring ${cls}${sizeCls}" role="img" aria-label="${escHtml(title)}" title="${escHtml(title)}">
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle class="score-ring-track" cx="18" cy="18" r="15.5" fill="none" pathLength="100" />
        <circle class="score-ring-fill" cx="18" cy="18" r="15.5" fill="none" pathLength="100"
                stroke-linecap="round" stroke-dasharray="${pct} 100" />
      </svg>
      <span class="score-ring-num">${escHtml(label)}</span>
    </div>`;
}

export function renderBreakdown(title, section, { autoOpenGaps = false } = {}) {
  if (!section) return '';
  const matched = Array.isArray(section.matched) ? section.matched : [];
  const unmatched = Array.isArray(section.unmatched) ? section.unmatched : [];
  if (!matched.length && !unmatched.length) return '';
  const total = matched.length + unmatched.length;
  const items = [
    ...matched.map(t => `<li class="bd-ok">✓ ${escHtml(t)}</li>`),
    ...unmatched.map(t => `<li class="bd-no">✗ ${escHtml(t)}</li>`),
  ].join('');
  const openAttr = autoOpenGaps && unmatched.length ? ' open' : '';
  return `
    <details class="breakdown"${openAttr}>
      <summary><span>${title}</span><span class="bd-count">${matched.length}/${total} matched</span></summary>
      <ul class="bd-list">${items}</ul>
    </details>`;
}

/* ── Fit tags: stack match + company business at a glance ───────── */

const PRODUCT_TYPE_LABEL = {
  b2b_saas: 'B2B SaaS',
  b2c_ecommerce_marketplace: 'E-commerce / marketplace',
  consumer_app: 'Consumer app',
  fintech: 'Fintech',
  other_software_product: 'Software product',
  agency_consulting_outsourcing: 'Agency / consulting',
  staffing_recruiter: 'Staffing / recruiter',
  hardware_industrial_automotive: 'Hardware / industrial',
  public_sector_research: 'Public sector / research',
};
const MARKETS_LABEL = {
  global: 'Global customers',
  europe: 'European customers',
  dach: 'DACH customers',
  germany_only: 'Germany-only customers',
};

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map(v => String(v || '').trim())
    .filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}

/** Business tags from the AI company lookup (no extra model call). */
export function businessTags(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const tags = [];
  const vertical = String(p.vertical || '').trim();
  if (vertical && vertical.toLowerCase() !== 'unclear') tags.push({ text: vertical, title: p.business });
  if (PRODUCT_TYPE_LABEL[p.product_type]) tags.push({ text: PRODUCT_TYPE_LABEL[p.product_type] });
  if (MARKETS_LABEL[p.markets]) tags.push({ text: MARKETS_LABEL[p.markets], title: p.markets_detail });
  if (p.is_recruiter_for_other_company) tags.push({ text: 'Via recruiter', warn: true });
  return tags;
}

/**
 * Tag strip under the AI result: green = stack the CV covers, red = stack
 * the posting asks for that the CV lacks, neutral = company business.
 * Jobs scored before stack_matched existed get a Re-run AI hint instead.
 */
export function fitTagsHtml(job) {
  const labels = job && typeof job.job_labels === 'object' && job.job_labels ? job.job_labels : {};
  const hasStackLists = Array.isArray(labels.stack_matched) || Array.isArray(labels.stack_missing);
  const matched = cleanList(labels.stack_matched);
  const missing = cleanList(labels.stack_missing);
  const business = businessTags(job && job.company_profile);
  const scored = Object.keys(labels).length > 0;
  if (!matched.length && !missing.length && !business.length && !scored) return '';

  const chip = (cls, t) => `<span class="fit-tag ${cls}"${t.title ? ` title="${escHtml(t.title)}"` : ''}>${escHtml(t.text)}</span>`;
  const stackChips = [
    ...matched.map(text => chip('fit-ok', { text, title: 'On your CV' })),
    ...missing.map(text => chip('fit-gap', { text, title: 'Asked for, not on your CV' })),
  ].join('');
  let stackRow = '';
  if (stackChips) {
    stackRow = `<div class="fit-row"><span class="fit-label">Stack</span><div class="fit-chips">${stackChips}</div></div>`;
  } else if (scored && !hasStackLists) {
    stackRow = `<div class="fit-row"><span class="fit-label">Stack</span><span class="fit-hint">Re-run AI to see which stack you match</span></div>`;
  }
  const businessRow = business.length
    ? `<div class="fit-row"><span class="fit-label">Business</span><div class="fit-chips">${business.map(t => chip(t.warn ? 'fit-warn' : 'fit-biz', t)).join('')}</div></div>`
    : '';
  if (!stackRow && !businessRow) return '';
  return `<div class="fit-tags">${stackRow}${businessRow}</div>`;
}

/* ── Channel / via / applicants ──────────────────────────────────── */

function jobHost(job) {
  try { return new URL(job.link || '').hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

export function jobChannel(job) {
  const rec = RECOMMENDED_BY_LABEL[String(job.recommended_by || '').toLowerCase()];
  if (rec) return { cls: 'ch-ai', label: rec, title: `Recommended by ${rec}` };
  const src = String(job.source || '').toLowerCase();
  const api = SOURCE_BADGE[src];
  if (api) return { cls: `ch-api ch-${src}`, label: api.label.replace(/ API$/, ''), title: api.title };
  if (job.origin === 'manual' || (src === 'manual' && !job.origin)) {
    return { cls: 'ch-manual', label: ORIGIN_PILL.manual.label, title: ORIGIN_PILL.manual.title };
  }
  if (job.origin === 'pipeline' || BOARD_LABEL[src]) {
    return { cls: 'ch-scraper', label: ORIGIN_PILL.pipeline.label, title: ORIGIN_PILL.pipeline.title };
  }
  return src ? { cls: 'ch-other', label: src, title: '' } : null;
}

export function channelChipHtml(job) {
  const ch = jobChannel(job);
  if (!ch) return '';
  return `<span class="channel-chip ${escHtml(ch.cls)}" title="${escHtml(ch.title)}">${escHtml(ch.label)}</span>`;
}

function sourceViaLabel(job) {
  const src = String((job && job.source) || '').toLowerCase();
  if (BOARD_LABEL[src]) return BOARD_LABEL[src];
  const api = SOURCE_BADGE[src];
  if (api) return api.label.replace(/ API$/, '');
  return '';
}

export function jobViaText(job) {
  const named = sourceViaLabel(job);
  if (named) return named;
  const ch = jobChannel(job);
  if (ch && (ch.cls === 'ch-ai' || ch.cls === 'ch-manual')) return jobHost(job);
  return '';
}

export function rowViaHtml(job, extraClass) {
  const text = jobViaText(job);
  if (!text) return '';
  const cls = extraClass ? `row-via ${extraClass}` : 'row-via';
  return `<span class="${cls}">via ${escHtml(text)}</span>`;
}

export function formatApplicantsLabel(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const first = text.match(
    /be among the first\s+([\d,]+)\s+applicants?|sei unter den ersten\s+([\d,]+)|geh[öo]ren sie zu den ersten\s+([\d,]+)/i
  );
  if (first) return `first ${first[1] || first[2] || first[3]}`;
  if (/be an early applicant/i.test(text)) return 'early applicant';
  const over = text.match(/(?:over|über)\s+([\d,]+)\+?\s+(?:applicants?|bewerber(?:innen)?)/i);
  if (over) return `${over[1]}+ applicants`;
  const n = text.match(/([\d,]+)\+?\s+(?:applicants?|bewerber(?:innen)?)/i);
  if (n) return `${n[1]} applicants`;
  if (/applicant|bewerber/i.test(text) && text.length <= 48) return text;
  return '';
}

export function rowApplicantsHtml(job) {
  const pos = job.applicant_position;
  const scraped = formatApplicantsLabel(job.applicants);
  const label = pos ? `#${pos} at apply` : scraped;
  const title = pos
    ? `You were roughly applicant #${pos} when you applied`
    : (scraped ? 'Applicant count when the job was scraped' : '');
  return `<span class="row-applicants" data-row-applicants title="${escHtml(title)}"${label ? '' : ' hidden'}>${escHtml(label)}</span>`;
}

export function applicantsMetaPillHtml(job) {
  const label = formatApplicantsLabel(job.applicants);
  if (!label) return '';
  return `<span class="meta-pill" title="Applicant count when the job was scraped">${escHtml(label)}</span>`;
}

// Employer's publish date (API sources: ATS boards, Bundesagentur …)
export function postedPillHtml(job) {
  const raw = String(job.posted_at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [y, m, d] = raw.split('-').map(Number);
  const posted = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today - posted) / 86400000);
  const rel = days <= 0 ? 'today'
    : days === 1 ? 'yesterday'
    : days < 30 ? `${days}d ago`
    : days < 365 ? `${Math.floor(days / 30)}mo ago`
    : `${Math.floor(days / 365)}y ago`;
  return `<span class="meta-pill" title="Published by the employer on ${escHtml(raw)}">Posted ${rel}</span>`;
}

/* ── Layout / details sheet ────────────────────────────────────────
   Tracker: one open card, scrim on stacked view, focus .card-title-text.
   Unmatched list expands inline — set data-scrim="cards" data-collapse="cards"
   data-focus-title=".card-title" on #jobGrid. */

function jobGridEl() {
  return document.getElementById('jobGrid');
}

function jobListOpt(name, fallback) {
  const v = jobGridEl()?.dataset[name];
  return (v == null || v === '') ? fallback : v;
}

function stackedDetails() {
  return window.matchMedia('(max-width: 1080px)').matches;
}

function ensurePanelScrim() {
  let el = document.getElementById('panelScrim');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'panelScrim';
  el.className = 'panel-scrim';
  el.hidden = true;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Close details');
  el.addEventListener('click', () => {
    const open = document.querySelector('#jobGrid .card.expanded');
    if (open) setCardOpen(open, false, { focus: true });
  });
  document.body.appendChild(el);
  return el;
}

export function syncPanelScrim() {
  const scrim = ensurePanelScrim();
  const sel = jobListOpt('scrim', 'all') === 'cards'
    ? '#jobGrid.layout-cards .card.expanded'
    : '#jobGrid .card.expanded';
  const open = document.querySelector(sel);
  scrim.hidden = !(open && stackedDetails());
  syncOverlayLock();
}

export function setCardOpen(card, open, { focus = false } = {}) {
  card.classList.toggle('expanded', open);
  const row = card.querySelector('.card-row');
  if (row) row.setAttribute('aria-expanded', String(open));
  syncPanelScrim();
  if (!focus) return;
  const titleSel = jobListOpt('focusTitle', '.card-title-text');
  const target = open ? card.querySelector(titleSel) : row;
  target?.focus({ preventScroll: true });
}

export function collapseOtherCards(keep) {
  document.querySelectorAll('#jobGrid .card.expanded').forEach(c => {
    if (c !== keep) setCardOpen(c, false);
  });
}

export function closeCardPanel(btn) {
  const card = btn.closest('.card');
  if (card) setCardOpen(card, false, { focus: true });
}

export function toggleCardExpand(rowEl) {
  const card = rowEl.closest('.card');
  if (!card) return;
  const open = !card.classList.contains('expanded');
  const collapseMode = jobListOpt('collapse', 'always');
  if (collapseMode === 'always' || currentLayout === 'cards') collapseOtherCards(card);
  const focusOnOpen = collapseMode === 'always' || currentLayout === 'cards';
  setCardOpen(card, open, { focus: open && focusOnOpen });
}

export function setLayout(mode) {
  currentLayout = mode;
  localStorage.setItem('jobLayout', mode);
  const grid = jobGridEl();
  if (!grid) return;
  grid.classList.toggle('layout-compact', mode === 'compact');
  grid.classList.toggle('layout-cards', mode === 'cards');
  document.querySelectorAll('#layoutToggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === mode);
  });
  grid.querySelectorAll('.card.expanded').forEach(c => setCardOpen(c, false));
  syncPanelScrim();
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.tl-modal-backdrop')) return;
    if (filterPopOpen()) return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const open = document.querySelectorAll('#jobGrid .card.expanded');
    if (!open.length) return;
    open.forEach(card => setCardOpen(card, false, { focus: true }));
  });
  window.matchMedia('(max-width: 1080px)').addEventListener('change', syncPanelScrim);
}
