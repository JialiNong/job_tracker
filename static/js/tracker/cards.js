/* Tracker job cards: HTML for one matched job and its details panel.
   ES module. Shared chrome is in ../shared/job_list.js. */
import { escHtml, safeUrl } from '../shared/html.js';
import { applicantsMetaPillHtml, BOARD_LABEL, channelChipHtml, formatApplicantsLabel, hasAiScore, jobViaText, ORIGIN_PILL, postedPillHtml, RECOMMENDED_BY_LABEL, renderBreakdown, rowApplicantsHtml, scoreRingHtml, showToast, SOURCE_BADGE } from '../shared/job_list.js';
import { renderReplaceLinkBlock } from './card-actions.js';
import { companyPageUrl } from './index.js';
import { HIGHLIGHT_PRESETS, jobHighlights, selectedDeleteOnlyIds, selectedFetchIds, state, STATUS_LABEL } from './state.js';
import { isAppliedLike, renderProgressBlock, statusPillHtml } from './timeline.js';
function needsAiHint(job) {
  return Boolean(job.ai_pending) || !hasAiScore(job) || !job.summary;
}

function isMissingDetails(job) {
  if (!job) return false;
  if (job.details_missing) return true;
  const title = String(job.title || '');
  if (title.startsWith('(Link only)')) return true;
  if (job.ai_pending && !job.details_fetched_at) return true;
  return false;
}

function canFetchDetails(job) {
  const recKey = String((job && job.recommended_by) || '').toLowerCase();
  return isMissingDetails(job)
    || Boolean(job && job.can_fetch_details)
    || Boolean(RECOMMENDED_BY_LABEL[recKey]);
}

function renderAgentReason(job) {
  const reason = String(job.recommend_reason || '').trim();
  if (!reason) return '';
  return `<div class="recommend-reason"><span class="recommend-reason-label">Why AI recommends this</span>${escHtml(reason)}</div>`;
}

function renderLocalAiBlock(job, doSection, lookingSection, matchReasons) {
  const hasLocal = hasAiScore(job) || job.summary || doSection || lookingSection || matchReasons;
  if (!hasLocal) return '';
  const ring = hasAiScore(job) ? scoreRingHtml(job, { size: 'score-lg' }) : '';
  const summary = job.summary
    ? `<div class="card-summary">${escHtml(job.summary)}</div>`
    : '';
  const lead = (ring || summary)
    ? `<div class="ai-local-lead">${ring}${summary}</div>`
    : '';
  return `
    <div class="ai-local">
      ${lead}
      ${doSection}
      ${lookingSection}
      ${matchReasons ? `<ul class="ai-match-reasons">${matchReasons}</ul>` : ''}
    </div>`;
}

function renderOriginalDescription(job) {
  return `
      <details class="job-description" data-job-id="${job._id}" ontoggle="loadJobDescription(this)">
        <summary>
          <span>Original description</span>
          <button type="button" class="jd-copy-btn" data-job-id="${job._id}"
                  onclick="event.preventDefault(); event.stopPropagation(); copyJobDescription(this)"
                  title="Copy the full original description">Copy</button>
        </summary>
        <div class="job-description-body" data-loaded="0">Expand to load…</div>
      </details>`;
}

export function normalizeHighlights(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const tag = String(item || '').trim().slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

export function highlightBadgesHtml(highlights) {
  if (!highlights.length) return '';
  return highlights.map(tag =>
    `<span class="highlight-badge" title="${escHtml(tag)}">★ ${escHtml(tag)}</span>`
  ).join('');
}

/* source "manual" just means "not LinkedIn / Indeed"; for agent pushes
   show the job site's domain instead so it does not read as Log Job. */
function sourcePillHtml(job) {
  const source = String(job.source || '');
  // LinkedIn / Indeed are the board, shown as small "via …" on the second
  // line. They are not a channel next to ATS, Log job, or an agent.
  if (BOARD_LABEL[source.toLowerCase()]) return '';
  if (source === 'manual' && RECOMMENDED_BY_LABEL[String(job.recommended_by || '').toLowerCase()]) {
    let host = '';
    try { host = new URL(job.link || '').hostname.replace(/^www\./, ''); } catch (e) {}
    return host
      ? `<span class="meta-pill source-pill site-pill" title="${escHtml(job.link || '')}">${escHtml(host)}</span>`
      : '';
  }
  const badge = sourceBadgeHtml(job);
  if (badge) return badge;
  return `<span class="meta-pill source-pill">${escHtml(source)}</span>`;
}
function sourceBadgeHtml(job) {
  const key = String(job.source || '').toLowerCase();
  const badge = SOURCE_BADGE[key];
  if (!badge) return '';
  let host = '';
  try { host = new URL(job.link || '').hostname.replace(/^www\./, ''); } catch (e) {}
  const title = badge.title + (host ? ` · ${host}` : '');
  return `<span class="meta-pill source-badge src-${escHtml(key)}" title="${escHtml(title)}">${escHtml(badge.label)}</span>`;
}

function originPillHtml(job) {
  const pill = ORIGIN_PILL[String(job.origin || '')];
  if (!pill) return '';
  return `<span class="meta-pill origin-pill origin-${escHtml(job.origin)}" title="${escHtml(pill.title)}">${escHtml(pill.label)}</span>`;
}

function recommendedByBadge(job) {
  const key = String(job.recommended_by || '').toLowerCase();
  const label = RECOMMENDED_BY_LABEL[key];
  if (!label) return '';
  const reason = String(job.recommend_reason || '').trim();
  const title = `Recommended by ${label}` + (reason ? ` — ${reason}` : '');
  return `<span class="meta-pill recommended-pill" title="${escHtml(title)}">${escHtml(label)}</span>`;
}

function rowChannelHtml(job) {
  const chip = channelChipHtml(job);
  return chip
    ? `<span class="row-channel">${chip}</span>`
    : '<span class="row-channel"></span>';
}
function rowSubHtml(job) {
  const viaText = jobViaText(job);
  const history = Array.isArray(job.company_history) ? job.company_history : [];
  let seen = '';
  if (history.length) {
    const total = job.company_history_total || history.length;
    const { applied, rejected } = companyHistoryFlags(history);
    const cls = rejected ? ' seen-rejected' : (applied ? ' seen-applied' : '');
    seen = `<span class="row-seen${cls}" title="${escHtml(`Seen ${total} other job(s) at this company: ${companyHistorySummary(history)}`)}">seen ${total}× before</span>`;
  }
  return `
        <div class="row-sub">
          <span class="row-company">${escHtml(job.company || '')}</span>
          <span class="row-loc" title="${escHtml(job.location || '')}">${escHtml(job.location || '')}</span>
          ${viaText ? `<span class="row-via">via ${escHtml(viaText)}</span>` : ''}
          ${rowApplicantsHtml(job)}
          ${seen}
        </div>`;
}

export function renderHighlightChips(highlights) {
  return highlights.map(tag => `
    <span class="hl-chip">
      ★ ${escHtml(tag)}
      <button type="button" title="Remove" data-tag="${escHtml(tag)}" onclick="removeHighlight(this)">×</button>
    </span>
  `).join('');
}

function renderHighlightsBlock(job) {
  const id = job._id;
  const highlights = normalizeHighlights(job.highlights);
  jobHighlights[id] = highlights.slice();
  const presets = HIGHLIGHT_PRESETS.map(tag => {
    const active = highlights.some(h => h.toLowerCase() === tag.toLowerCase());
    return `<button type="button" class="hl-preset${active ? ' active' : ''}"
              data-preset="${escHtml(tag)}"
              onclick="addHighlightPreset('${id}', this.dataset.preset)">${escHtml(tag)}</button>`;
  }).join('');
  return `
    <div class="highlights-wrap" data-id="${id}" id="highlights-${id}" onclick="event.stopPropagation()">
      <div class="highlights-label">Highlights</div>
      <div class="highlights-chips" data-chips>${renderHighlightChips(highlights)}</div>
      <div class="highlights-add-row">
        ${presets}
        <input class="hl-input" type="text" maxlength="40" placeholder="Custom tag…" aria-label="Custom highlight tag"
               onkeydown="if(event.key==='Enter'){event.preventDefault();addHighlightFromInput('${id}');}" />
        <button type="button" class="hl-add-btn" onclick="addHighlightFromInput('${id}')">+ Add</button>
      </div>
    </div>
  `;
}

/* ── Company history (other Tracker jobs at the same company) ────── */
export function companyHistoryStatus(item) {
  const progress = item.progress || '';
  if (progress === 'rejected') return { label: 'Rejected', cls: 'st-rejected' };
  if (progress === 'screening') return { label: 'Screening', cls: 'st-screening' };
  if (progress === 'interview') return { label: 'Interview', cls: 'st-interview' };
  if (progress === 'interview_cancelled') return { label: 'Interview cancelled', cls: 'st-cancelled' };
  if (progress === 'offer') return { label: 'Offer', cls: 'st-offer' };
  if (progress === 'applied') {
    if (item.status === 'closed_no_reply') return { label: 'Applied · closed, no reply', cls: 'st-applied' };
    return { label: 'Applied · no reply yet', cls: 'st-applied' };
  }
  return { label: STATUS_LABEL[item.status] || 'Not applied', cls: '' };
}

function companyHistorySummary(history) {
  const counts = {};
  history.forEach(item => {
    const { label } = companyHistoryStatus(item);
    const key = label.startsWith('Applied') ? 'Applied (no reply)' : label;
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(' · ');
}

function companyHistoryFlags(history) {
  const applied = history.some(h => h.progress);
  const rejected = history.some(h => h.progress === 'rejected' || h.status === 'prev_rejected');
  return { applied, rejected };
}

function renderCompanyHistory(job) {
  const history = Array.isArray(job.company_history) ? job.company_history : [];
  if (!history.length) return '';
  const total = job.company_history_total || history.length;
  const { rejected } = companyHistoryFlags(history);
  const rows = history.slice(0, 5).map(item => {
    const st = companyHistoryStatus(item);
    const dates = [];
    if (item.applied_at) dates.push(`applied ${item.applied_at}`);
    if (item.progress && item.progress !== 'applied' && item.last_step_at) {
      dates.push(`${st.label.toLowerCase()} ${item.last_step_at}`);
    }
    if (!dates.length && item.matched_at) dates.push(`seen ${item.matched_at}`);
    if (item.applicant_position) dates.push(`#${item.applicant_position} applicant`);
    return `
      <li data-history-id="${escHtml(item._id || '')}">
        <span class="ch-status ${st.cls}">${escHtml(st.label)}</span>
        <span class="ch-title">${escHtml(item.title || '(No Title)')}</span>
        <span class="ch-dates">${escHtml(dates.join(' · '))}</span>
      </li>`;
  }).join('');
  return `
    <div class="company-history${rejected ? ' seen-rejected' : ''}" onclick="event.stopPropagation()">
      <div class="ch-head">You've seen this company before — ${total} other job${total === 1 ? '' : 's'}
        <span class="ch-summary">(${escHtml(companyHistorySummary(history))})</span>
      </div>
      <ul>${rows}</ul>
      <a class="ch-all" href="${escHtml(companyPageUrl(job.company))}" target="_blank" rel="noopener"
         title="Open in a new tab">Show all jobs at ${escHtml(job.company || '')} ↗</a>
    </div>`;
}

/** Company name (click → filter to that company) + location. */
export function cardCompanyHtml(company, location) {
  const name = String(company || '');
  const link = name
    ? `<button type="button" class="company-link" title="Add this company to the search filter"
               onclick="event.stopPropagation(); filterByCompany(${escHtml(JSON.stringify(name))})">${escHtml(name)}</button>`
    : '';
  const loc = location
    ? `<span class="row-loc" title="${escHtml(location)}">${escHtml(location)}</span>`
    : '';
  return `${link}${loc}`;
}

/* ── Applicant position at apply time (LinkedIn) ─────────────────── */
function applicantPosPillHtml(job) {
  const pos = job.applicant_position;
  return `<span class="meta-pill applicant-pos-pill" data-applicant-pos-pill
                title="You were roughly applicant #${pos || ''} when you applied"
                ${pos ? '' : 'hidden'}>#${escHtml(pos || '')} at apply</span>`;
}

function renderApplicantPositionBlock(job) {
  const isLi = String(job.source || '').toLowerCase() === 'linkedin';
  if (!isLi && !job.applicant_position) return '';
  const id = job._id;
  const scraped = job.applicants ? `When scraped: ${job.applicants}. ` : '';
  return `
    <div class="applicant-pos-wrap" data-id="${id}" onclick="event.stopPropagation()">
      <div class="panel-heading">Applicant # when I applied</div>
      <div class="ap-row">
        <input type="number" min="1" step="1" inputmode="numeric" class="applicant-pos-input" aria-label="Applicant number when I applied"
               value="${escHtml(job.applicant_position || '')}" placeholder="e.g. 25"
               onkeydown="if(event.key==='Enter'){event.preventDefault();saveApplicantPosition('${id}');}" />
        <button type="button" class="btn-save" onclick="saveApplicantPosition('${id}', this)">Save</button>
      </div>
      <span class="ap-hint">${escHtml(scraped)}Read the LinkedIn applicant count right after you apply.</span>
    </div>`;
}

export function setApplicantPositionUI(id, value) {
  const card = document.getElementById(`card-${id}`);
  if (!card) return;
  const input = card.querySelector('.applicant-pos-input');
  if (input) input.value = value || '';
  const pill = card.querySelector('[data-applicant-pos-pill]');
  if (pill) {
    pill.hidden = !value;
    pill.textContent = value ? `#${value} at apply` : '';
    pill.title = value ? `You were roughly applicant #${value} when you applied` : '';
  }
  const row = card.querySelector('[data-row-applicants]');
  if (row) {
    const scraped = formatApplicantsLabel(card.dataset.applicants || '');
    const label = value ? `#${value} at apply` : scraped;
    row.hidden = !label;
    row.textContent = label || '';
    row.title = value
      ? `You were roughly applicant #${value} when you applied`
      : (scraped ? 'Applicant count when the job was scraped' : '');
  }
}

export async function saveApplicantPosition(id, btn) {
  const card = document.getElementById(`card-${id}`);
  const input = card && card.querySelector('.applicant-pos-input');
  if (!input) return;
  const raw = input.value.trim();
  try {
    const res = await fetch(`/api/jobs/${id}/applicant-position`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ applicant_position: raw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    setApplicantPositionUI(id, data.applicant_position);
    if (btn) {
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save'; }, 2000);
    }
    showToast(data.applicant_position ? `Saved: applicant #${data.applicant_position}` : 'Applicant # cleared');
  } catch (err) {
    showToast('' + err.message, 'err');
  }
}

/* ── Render card ─────────────────────────────────────────────────── */
export function renderCard(job) {
  const status = job.status || 'pending';
  const aiHint = needsAiHint(job);
  const doSection = renderBreakdown("What you'll do", job.what_youll_do, { autoOpenGaps: true });
  const lookingSection = renderBreakdown("What they're looking for", job.what_theyre_looking_for, { autoOpenGaps: true });
  const hasBreakdown = Boolean(doSection || lookingSection);
  const matchReasons = hasBreakdown
    ? ''
    : (job.match_reasons || []).slice(0, 3).map(r => `<li>${escHtml(r)}</li>`).join('');
  const highlights = normalizeHighlights(job.highlights);
  const highlightBadges = highlightBadgesHtml(highlights);
  const runAiCls = aiHint ? 'btn-run-ai ai-pending-btn' : 'btn-run-ai';
  const runAiLabel = aiHint ? 'Run AI' : 'Re-run AI';
  const recBadge = recommendedByBadge(job);
  const recKey = String(job.recommended_by || '').toLowerCase();
  const missing = isMissingDetails(job);
  const canFetch = canFetchDetails(job);
  // Every card can be selected for Delete selected; batch Fetch / Run AI
  // only take cards where AI has not run yet (Re-run AI stays per card).
  const fetchable = aiHint;
  const isSelected = selectedFetchIds.has(job._id) || selectedDeleteOnlyIds.has(job._id);
  const fetchBtn = canFetch ? `
        <button type="button" class="btn-fetch-details" data-id="${job._id}"
                onclick="event.stopPropagation(); fetchJobDetails('${job._id}', this)"
                title="Scrape title, company, location, and description (no AI matching)">
          Fetch job details
        </button>` : '';
  const selectBox = `
    <label class="card-select-wrap" onclick="event.stopPropagation()" title="${fetchable ? 'Select for batch Fetch details / Run AI / Delete' : 'Select for batch Delete'}">
      <input type="checkbox" class="card-select" data-id="${job._id}"
             data-missing="${missing ? '1' : '0'}"
             data-fetchable="${fetchable ? '1' : '0'}"
             ${isSelected ? 'checked' : ''}
             ${state.fetchBatchRunning ? 'disabled' : ''}
             onchange="onCardFetchSelect(this)" />
    </label>`;

  const card = document.createElement('div');
  card.className = 'card'
    + (highlights.length ? ' has-highlights' : '')
    + ' has-fetch-select'
    + (isSelected ? ' fetch-selected' : '');
  card.id = `card-${job._id}`;
  card.dataset.applicants = job.applicants || '';

  card.innerHTML = `
    ${selectBox}
    <div class="card-row" role="button" tabindex="0" aria-expanded="false"
         aria-controls="body-${job._id}" onclick="toggleCardExpand(this)">
      <span class="row-chevron" aria-hidden="true">▸</span>
      ${scoreRingHtml(job)}
      <div class="row-main">
        <div class="row-title-line">
          <span class="row-title">${escHtml(job.title || '(No Title)')}</span>
          <span class="row-highlights" data-row-highlights>${highlightBadges}</span>
        </div>
        ${rowSubHtml(job)}
      </div>
      <div class="row-meta">
        ${rowChannelHtml(job)}
        ${statusPillHtml(status, job.application_timeline)}
      </div>
    </div>

    <div class="card-body" id="body-${job._id}" role="region" aria-label="Job details">
     <button type="button" class="panel-close" onclick="event.stopPropagation(); closeCardPanel(this)" aria-label="Close details" title="Close (Esc)">×</button>
     <div class="card-split">
      <div class="card-split-match">
      <div class="card-header">
        <div class="card-title-block" data-id="${job._id}">
          <!-- View mode -->
          <div class="info-view">
            <div class="card-title">
              <span class="card-title-text" tabindex="-1">${escHtml(job.title || '(No Title)')}</span>
              <button class="edit-info-btn" onclick="event.stopPropagation(); openEditInfo(this)" title="Edit title / company / location">Edit</button>
            </div>
            <div class="card-company">${cardCompanyHtml(job.company, job.location)}${jobViaText(job) ? `<span class="card-via">via ${escHtml(jobViaText(job))}</span>` : ''}</div>
          </div>
          <!-- Edit mode -->
          <div class="info-edit">
            <input class="info-input" data-field="title"    value="${escHtml(job.title    || '')}" placeholder="Job Title" aria-label="Job title" />
            <div class="info-edit-row">
              <input class="info-input" data-field="company"  value="${escHtml(job.company  || '')}" placeholder="Company" aria-label="Company" />
              <input class="info-input" data-field="location" value="${escHtml(job.location || '')}" placeholder="Location" aria-label="Location" />
            </div>
            <div class="info-action-row">
              <button class="info-save-btn"   onclick="saveJobInfo(this)">✓ Save</button>
              <button class="info-cancel-btn" onclick="cancelEditInfo(this)">✕ Cancel</button>
            </div>
          </div>
        </div>
        ${scoreRingHtml(job, { size: 'score-lg' })}
      </div>

      <div class="card-meta">
        <span class="body-highlights" data-body-highlights>${highlightBadges}</span>
        ${sourcePillHtml(job)}
        ${originPillHtml(job)}
        ${recBadge}
        ${job.matched_at ? `<span class="meta-pill" title="Matched on">Matched ${escHtml(job.matched_at)}</span>` : ''}
        ${postedPillHtml(job)}
        ${applicantsMetaPillHtml(job)}
        ${applicantPosPillHtml(job)}
      </div>

      ${renderCompanyHistory(job)}

      <div class="progress-panel">
      ${renderProgressBlock(job)}
      ${renderApplicantPositionBlock(job)}
      ${renderNotesBlock(job)}
      </div>

      ${renderReplaceLinkBlock(job)}
      <div class="card-actions-row">
        <a class="btn-apply ${isAppliedLike(status, job.application_timeline) ? 'btn-applied' : ''}"
           href="${escHtml(safeUrl(job.link))}" target="_blank" rel="noopener">
          ${isAppliedLike(status, job.application_timeline) ? 'View posting' : 'Apply'}
        </a>
        <button type="button" class="${runAiCls}" data-id="${job._id}"
                onclick="event.stopPropagation(); runAiForJob('${job._id}', this)"
                title="Run AI matching — uses the stored JD when it is complete, otherwise scrapes the job page in Chrome first">
          ${runAiLabel}
        </button>
        ${fetchBtn}
      </div>

      ${renderAgentReason(job)}
      ${renderLocalAiBlock(job, doSection, lookingSection, matchReasons)}
      ${renderOriginalDescription(job)}
      </div>
        <div class="card-split-track">
          ${renderApplicationQa(job)}
          ${renderHighlightsBlock(job)}
          <div class="card-danger-row">
            <button type="button" class="delete-job-btn" onclick="event.stopPropagation(); deleteMatchedJob('${job._id}', this)" title="Delete this job permanently">Delete job</button>
          </div>
        </div>
     </div>
    </div>
  `;
  return card;
}

export function renderQaItemHtml(item = {}) {
  const q = escHtml(item.question || '');
  const a = escHtml(item.answer || '');
  return `
    <div class="qa-item">
      <div class="qa-item-header">
        <input class="qa-question" type="text" placeholder="Question asked in the application…" aria-label="Question" value="${q}">
        <button type="button" class="qa-remove" title="Remove" aria-label="Remove question" onclick="removeQaItem(this)">×</button>
      </div>
      <textarea class="qa-answer" rows="2" placeholder="Your answer…" aria-label="Answer">${a}</textarea>
    </div>
  `;
}

function renderApplicationQa(job) {
  const items = Array.isArray(job.application_qa) && job.application_qa.length
    ? job.application_qa
    : [{}];
  const listHtml = items.map(renderQaItemHtml).join('');
  return `
    <div class="qa-wrap" data-id="${job._id}">
      <div class="qa-label">Application Q&amp;A</div>
      <div class="qa-list">${listHtml}</div>
      <div class="qa-actions">
        <button type="button" class="btn-add-qa" data-id="${job._id}" onclick="addQaItem(this)">+ Add question</button>
        <button type="button" class="btn-save" data-id="${job._id}" onclick="saveApplicationQa(this)">Save Q&amp;A</button>
      </div>
    </div>
  `;
}

function renderNotesBlock(job) {
  return `
    <div class="notes-wrap" data-id="${job._id}" onclick="event.stopPropagation()">
      <div class="panel-heading">Notes</div>
      <textarea
        class="notes-textarea"
        aria-label="Notes"
        data-id="${job._id}"
        placeholder="Rejected after interview, salary, or why you skipped it…"
        rows="2"
      >${escHtml(job.notes || '')}</textarea>
      <button type="button" class="btn-save" data-id="${job._id}" onclick="saveNotes(this)">Save notes</button>
    </div>`;
}
