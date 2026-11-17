/* Tracker application timeline: progress track, record / edit / undo, side
   status, and chip/overview refresh after a write.
   ES module. */
import { escHtml } from '../shared/html.js';
import { showToast } from '../shared/job_list.js';
import { removeMatchedCardSilently } from './card-actions.js';
import { companyHistoryStatus, setApplicantPositionUI } from './cards.js';
import { loadOverviewData, loadStats } from './index.js';
import { GOT_INTERVIEW_FILTER, GOT_INTERVIEW_STEPS, INTERVIEW_STEPS, jobTimelines, PROGRESS_STAGES, SIDE_STATUSES, state, STATUS_LABEL, TERMINAL_STEPS, TIMELINE_LABEL } from './state.js';

const TIMELINE_STEP_RANK = {
  applied: 0,
  reapplied: 1,
  screening: 2,
  screening_done: 3,
  interview_invite: 4,
  interview_1: 5,
  interview_2: 6,
  interview_3: 7,
  interview_final: 8,
  interview_cancelled: 9,
  rejected: 10,
  offer: 11,
};

function nowLocalInputValue() {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalInputValue(at) {
  if (!at) return nowLocalInputValue();
  const m = String(at).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return nowLocalInputValue();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

function fromLocalInputValue(v) {
  if (!v) return '';
  return v.replace('T', ' ');
}

function askTimelineTime({ title, hint, initial }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'tl-modal-backdrop';
    backdrop.innerHTML = `
      <div class="tl-modal" role="dialog" aria-modal="true">
        <h3>${escHtml(title)}</h3>
        <p>${escHtml(hint || 'Pick the date and time for this step')}</p>
        <input type="datetime-local" id="tlDatetimeInput" value="${initial || nowLocalInputValue()}" />
        <div class="tl-modal-actions">
          <button type="button" class="tl-cancel">Cancel</button>
          <button type="button" class="tl-confirm">Save</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector('#tlDatetimeInput');
    const close = (val) => { backdrop.remove(); resolve(val); };
    backdrop.querySelector('.tl-cancel').onclick = () => close(null);
    backdrop.querySelector('.tl-confirm').onclick = () => close(fromLocalInputValue(input.value));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    input.focus();
  });
}

export function askConfirm({ title, hint, detail, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'tl-modal-backdrop';
    backdrop.innerHTML = `
      <div class="tl-modal" role="dialog" aria-modal="true">
        <h3>${escHtml(title)}</h3>
        ${hint ? `<p>${escHtml(hint)}</p>` : ''}
        ${detail ? `<div class="tl-job-name">${escHtml(detail)}</div>` : ''}
        <div class="tl-modal-actions">
          <button type="button" class="tl-cancel">Cancel</button>
          <button type="button" class="tl-confirm${danger ? ' tl-danger' : ''}">${escHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = (val) => { backdrop.remove(); resolve(val); };
    backdrop.querySelector('.tl-cancel').onclick = () => close(false);
    backdrop.querySelector('.tl-confirm').onclick = () => close(true);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
    });
    backdrop.querySelector('.tl-confirm').focus();
  });
}

function timelineStepClass(step) {
  if (step === 'applied') return 'step-applied';
  if (step === 'reapplied') return 'step-reapplied';
  if (String(step).startsWith('screening')) return 'step-screening';
  if (step === 'rejected') return 'step-rejected';
  if (step === 'offer') return 'step-offer';
  if (step === 'interview_cancelled') return 'step-cancelled';
  if (String(step).startsWith('interview_')) return 'step-interview';
  return '';
}

function formatNodeTime(at) {
  if (!at) return '—';
  // "YYYY-MM-DD HH:MM" → "MM-DD\nHH:MM"
  const m = String(at).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return escHtml(at);
  return `${m[2]}-${m[3]}<br>${m[4]}:${m[5]}`;
}

function screeningBackfillActions(timeline) {
  // Missing Screening / Submitted stay available after Invite / rounds so a
  // later interview does not block recording the earlier ask + homework.
  const have = new Set((timeline || []).map(ev => ev && ev.step));
  const actions = [];
  if (!have.has('screening')) {
    actions.push({ step: 'screening', label: '+ Screening', cls: 'btn-screening-step' });
  }
  if (!have.has('screening_done')) {
    actions.push({ step: 'screening_done', label: '+ Submitted', cls: 'btn-screening-step' });
  }
  return actions;
}

function mergeTimelineActions(timeline, forward) {
  if (!timeline.length) return forward;
  const seen = new Set(forward.map(a => a.step));
  const extras = screeningBackfillActions(timeline).filter(a => !seen.has(a.step));
  return extras.concat(forward);
}

export function parseTimelineAt(at) {
  if (!at) return 0;
  const m = String(at).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2})?:?(\d{2})?/);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
}

function sortTimeline(timeline) {
  return (timeline || []).slice().sort((a, b) => {
    const da = parseTimelineAt(a && a.at);
    const db = parseTimelineAt(b && b.at);
    if (da !== db) return da - db;
    return (TIMELINE_STEP_RANK[a && a.step] ?? 99) - (TIMELINE_STEP_RANK[b && b.step] ?? 99);
  });
}

function furthestTimelineStep(timeline) {
  const have = new Set((timeline || []).map(ev => ev && ev.step));
  const order = Object.keys(TIMELINE_STEP_RANK);
  for (let i = order.length - 1; i >= 0; i--) {
    if (have.has(order[i])) return order[i];
  }
  return '';
}

/** Events after the latest Reapplied (or the whole sorted list). */
function timelineAfterReapply(timeline) {
  const ordered = sortTimeline(timeline || []);
  let cut = -1;
  ordered.forEach((ev, i) => {
    if (ev && ev.step === 'reapplied') cut = i;
  });
  if (cut < 0) return ordered;
  const rest = ordered.slice(cut + 1);
  return rest.length ? rest : [{ step: 'applied' }];
}

function nextTimelineActions(timeline) {
  if (!timeline.length) {
    return [{ step: 'applied', label: '+ Applied', cls: 'btn-apply-step' }];
  }
  const track = timelineAfterReapply(timeline);
  const last = (track.length ? track[track.length - 1].step : '')
    || furthestTimelineStep(timeline)
    || timeline[timeline.length - 1].step;
  const reapply = { step: 'reapplied', label: '+ Reapplied', cls: 'btn-apply-step' };
  const cancel = { step: 'interview_cancelled', label: '+ Cancelled', cls: 'btn-cancel-step' };
  // Rejected / no reply → apply again (e.g. a repost); the track restarts.
  if (last === 'rejected') return mergeTimelineActions(timeline, [reapply]);
  if (TERMINAL_STEPS.has(last)) return mergeTimelineActions(timeline, []);

  const actions = [];
  if (last === 'applied' || last === 'reapplied') {
    actions.push({ step: 'screening', label: '+ Screening', cls: 'btn-screening-step' });
    actions.push({ step: 'interview_invite', label: '+ Invite', cls: 'btn-interview-step' });
    actions.push({ step: 'rejected', label: '+ Rejected', cls: 'btn-reject-step' });
    actions.push(reapply);
    return mergeTimelineActions(timeline, actions);
  }
  if (last === 'screening') {
    actions.push({ step: 'screening_done', label: '+ Submitted', cls: 'btn-screening-step' });
    actions.push({ step: 'interview_invite', label: '+ Invite', cls: 'btn-interview-step' });
    actions.push({ step: 'rejected', label: '+ Rejected', cls: 'btn-reject-step' });
    return mergeTimelineActions(timeline, actions);
  }
  if (last === 'screening_done') {
    actions.push({ step: 'interview_invite', label: '+ Invite', cls: 'btn-interview-step' });
    actions.push({ step: 'rejected', label: '+ Rejected', cls: 'btn-reject-step' });
    return mergeTimelineActions(timeline, actions);
  }
  if (last === 'interview_cancelled') {
    actions.push({ step: 'interview_invite', label: '+ Invite', cls: 'btn-interview-step' });
    actions.push({ step: 'rejected', label: '+ Rejected', cls: 'btn-reject-step' });
    actions.push(reapply);
    return mergeTimelineActions(timeline, actions);
  }
  if (last === 'interview_invite') {
    actions.push({ step: 'interview_1', label: '+ Round 1', cls: 'btn-interview-step' });
    actions.push(cancel);
    actions.push({ step: 'rejected', label: '+ Rejected', cls: 'btn-reject-step' });
    return mergeTimelineActions(timeline, actions);
  }
  const idx = INTERVIEW_STEPS.indexOf(last);
  if (idx >= 0) {
    if (idx < INTERVIEW_STEPS.length - 1) {
      const next = INTERVIEW_STEPS[idx + 1];
      actions.push({ step: next, label: `+ ${TIMELINE_LABEL[next]}`, cls: 'btn-interview-step' });
    }
    actions.push(cancel);
    actions.push({ step: 'rejected', label: '+ Rejected', cls: 'btn-reject-step' });
    actions.push({ step: 'offer', label: '+ Offer', cls: 'btn-offer-step' });
  }
  return mergeTimelineActions(timeline, actions);
}

function isLiveInterviewStep(step) {
  return GOT_INTERVIEW_STEPS.has(step);
}

function isInterviewRelatedStep(step) {
  return isLiveInterviewStep(step) || step === 'interview_cancelled';
}

function statusFromTimeline(timeline) {
  if (!Array.isArray(timeline) || !timeline.length) return '';
  const ordered = sortTimeline(timeline);
  let last = ordered[ordered.length - 1].step;
  const steps = ordered.map(ev => ev.step);
  if ((last === 'screening' || last === 'screening_done')
      && steps.some(isInterviewRelatedStep)) {
    last = [...steps].reverse().find(isInterviewRelatedStep);
  }
  if (last === 'applied' || last === 'reapplied') return 'applied';
  if (last === 'screening' || last === 'screening_done') return 'screening';
  if (last === 'interview_cancelled') return 'interview_cancelled';
  if (String(last).startsWith('interview_')) return 'interview';
  if (last === 'rejected') return 'rejected';
  if (last === 'offer') return 'offer';
  return '';
}

function progressStage(status, timeline, appliedAt) {
  if (Array.isArray(timeline) && timeline.length) {
    return statusFromTimeline(timeline) || '';
  }
  if (status === 'pending') return '';
  if (PROGRESS_STAGES.includes(status)) return status;
  if (appliedAt) return 'applied';
  return '';
}

function jobReachedInterview(job) {
  const timeline = job.application_timeline;
  if (Array.isArray(timeline) && timeline.length) {
    return timeline.some(ev => GOT_INTERVIEW_STEPS.has(ev && ev.step));
  }
  const status = job.status || 'pending';
  return status === 'interview' || status === 'offer' || status === 'interview_cancelled';
}

function jobMatchesStatusFilter(job, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'active') return !SIDE_STATUSES.includes(job.status || 'pending');
  if (filter === GOT_INTERVIEW_FILTER) return jobReachedInterview(job);
  if (PROGRESS_STAGES.includes(filter)) {
    return progressStage(job.status, job.application_timeline, job.applied_at) === filter;
  }
  return (job.status || 'pending') === filter;
}

/** Card pill: "Reapplied" while the latest progress step is a reapply. */
function cardStatusView(status, timeline) {
  const tl = sortTimeline(Array.isArray(timeline) ? timeline : []);
  const last = tl.length ? tl[tl.length - 1].step : '';
  if (!SIDE_STATUSES.includes(status || 'pending')) {
    const derived = statusFromTimeline(tl);
    if (derived) status = derived;
  }
  if (status === 'applied' && last === 'reapplied') {
    return { cls: 'reapplied', label: 'Reapplied' };
  }
  return { cls: status, label: STATUS_LABEL[status] || status };
}

export function statusPillHtml(status, timeline) {
  const view = cardStatusView(status, timeline);
  return `<span class="status-pill s-${escHtml(view.cls)}" data-status-pill>${escHtml(view.label)}</span>`;
}

export function isAppliedLike(status, timeline) {
  if (['applied', 'screening', 'interview', 'interview_cancelled', 'rejected', 'offer'].includes(status)) return true;
  return Array.isArray(timeline) && timeline.length > 0;
}

function progressLineClass(nextStep) {
  if (nextStep === 'rejected') return 'progress-line done end-rejected';
  if (nextStep === 'offer') return 'progress-line done end-offer';
  if (nextStep === 'interview_cancelled') return 'progress-line done end-cancelled';
  return 'progress-line done';
}

export function renderProgressBlock(job) {
  const id = job._id;
  const timeline = sortTimeline(
    Array.isArray(job.application_timeline) ? job.application_timeline.slice() : []
  );
  jobTimelines[id] = timeline;
  const status = job.status || 'pending';
  const sideVal = SIDE_STATUSES.includes(status) ? status : '';

  let trackHtml = '';
  if (!timeline.length) {
    trackHtml = `<div class="progress-empty">No application yet — record when you applied below</div>`;
  } else {
    trackHtml = timeline.map((ev, i) => {
      const label = TIMELINE_LABEL[ev.step] || ev.label || ev.step;
      const lineCls = i < timeline.length - 1 ? progressLineClass(timeline[i + 1].step) : '';
      return `
        <button type="button" class="progress-node ${timelineStepClass(ev.step)}"
                title="Click to edit time"
                onclick="editTimelineStep('${id}', ${i})">
          <div class="node-label">${escHtml(label)}</div>
          <div class="node-dot"></div>
          <div class="node-time">${formatNodeTime(ev.at)}</div>
        </button>
        ${lineCls ? `<div class="${lineCls}"></div>` : ''}
      `;
    }).join('');
  }

  const actions = nextTimelineActions(timeline);
  const actionBtns = actions.map(a =>
    `<button type="button" class="progress-btn ${a.cls}" onclick="addTimelineStep('${id}', '${a.step}')">${a.label}</button>`
  ).join('');
  const undoBtn = timeline.length
    ? `<button type="button" class="progress-btn btn-undo" onclick="undoTimelineStep('${id}')">↩ Undo</button>`
    : '';

  return `
    <div class="progress-wrap" data-id="${id}" id="progress-${id}" onclick="event.stopPropagation()">
      <div class="progress-title">Application progress</div>
      <div class="progress-track">${trackHtml}</div>
      <div class="progress-actions">
        ${actionBtns}
        ${undoBtn}
      </div>
      <div class="progress-side">
        <label class="progress-side-label" for="side-${id}">Other</label>
        <select class="status-side-select" id="side-${id}" data-id="${id}" onchange="updateSideStatus(this)">
          <option value="" ${!sideVal ? 'selected' : ''}>—</option>
          <option value="unsuitable" ${sideVal==='unsuitable' ? 'selected':''}>Unsuitable</option>
          <option value="closed" ${sideVal==='closed' ? 'selected':''}>Closed (before applying)</option>
          <option value="closed_no_reply" ${sideVal==='closed_no_reply' ? 'selected':''}>Closed after applying, no reply</option>
          <option value="prev_rejected" ${sideVal==='prev_rejected' ? 'selected':''}>Rejected before, skip this time</option>
          <option value="too_many_questions" ${sideVal==='too_many_questions' ? 'selected':''}>Good fit, too many required questions</option>
          <option value="repost" ${sideVal==='repost' ? 'selected':''}>Repost</option>
          <option value="duplicate" ${sideVal==='duplicate' ? 'selected':''}>Duplicate</option>
          <option value="pending">Reset Not Applied</option>
        </select>
      </div>
    </div>
  `;
}

function currentJobStatus(jobId, timeline) {
  const wrap = document.getElementById(`progress-${jobId}`);
  const side = wrap && wrap.querySelector('.status-side-select');
  const sideVal = side ? side.value : '';
  if (sideVal && SIDE_STATUSES.includes(sideVal)) return sideVal;
  return statusFromTimeline(timeline || []) || 'pending';
}

function appliedAtFromTimeline(timeline) {
  const ev = (timeline || []).find(item => item && item.step === 'applied' && item.at);
  return ev ? ev.at : '';
}

function chipSnapshot(status, timeline, appliedAt) {
  const progress = progressStage(status, timeline, appliedAt) || '';
  const overlay = SIDE_STATUSES.includes(status || 'pending') ? (status || '') : '';
  return {
    progress,
    overlay,
    pending: (status || 'pending') === 'pending' && !progress,
    active: !SIDE_STATUSES.includes(status || 'pending'),
    got: jobReachedInterview({
      status,
      application_timeline: timeline,
      applied_at: appliedAt,
    }),
  };
}

function bumpChip(id, delta) {
  const el = document.getElementById(id);
  if (!el || !delta) return;
  const n = parseInt(el.textContent, 10);
  if (Number.isNaN(n)) return;
  el.textContent = String(Math.max(0, n + delta));
}

function applyChipDelta(from, to) {
  if (!from || !to) return;
  if (from.progress !== to.progress) {
    if (from.progress) bumpChip(`cnt-${from.progress}`, -1);
    if (to.progress) bumpChip(`cnt-${to.progress}`, +1);
  }
  if (from.overlay !== to.overlay) {
    if (from.overlay) bumpChip(`cnt-${from.overlay}`, -1);
    if (to.overlay) bumpChip(`cnt-${to.overlay}`, +1);
  }
  if (from.pending !== to.pending) bumpChip('cnt-pending', to.pending ? 1 : -1);
  if (from.active !== to.active) bumpChip('cnt-active', to.active ? 1 : -1);
  if (from.got !== to.got) bumpChip('cnt-got_interview', to.got ? 1 : -1);
}

function syncCompanyHistoryItem(jobId, status, timeline, appliedAt) {
  const progress = progressStage(status, timeline, appliedAt);
  const view = companyHistoryStatus({ progress, status });
  document.querySelectorAll(`[data-history-id="${jobId}"]`).forEach(li => {
    const st = li.querySelector('.ch-status');
    if (!st) return;
    st.className = `ch-status ${view.cls}`;
    st.textContent = view.label;
  });
}

export function refreshTrackerStats() {
  loadStats();
  loadOverviewData();
}

function refreshProgressUI(jobId, timeline, status) {
  jobTimelines[jobId] = timeline;
  const card = document.getElementById(`card-${jobId}`);
  if (!card) return;

  const wrap = card.querySelector(`#progress-${jobId}`);
  if (wrap) {
    const fakeJob = { _id: jobId, application_timeline: timeline, status };
    wrap.outerHTML = renderProgressBlock(fakeJob);
  }
  // Back to Not Applied: the server cleared the applicant # with the record
  if (status === 'pending' && !(timeline || []).length) setApplicantPositionUI(jobId, null);

  const pill = card.querySelector('[data-status-pill]');
  if (pill) {
    const view = cardStatusView(status, timeline);
    pill.className = `status-pill s-${view.cls}`;
    pill.textContent = view.label;
  }

  const btn = card.querySelector('.btn-apply');
  if (btn) {
    const appliedLike = isAppliedLike(status, timeline);
    btn.classList.toggle('btn-applied', appliedLike);
    btn.innerHTML = appliedLike ? 'View posting' : 'Apply';
  }
}

async function saveTimeline(jobId, timeline) {
  const prevTimeline = (jobTimelines[jobId] || []).slice();
  const prevStatus = currentJobStatus(jobId, prevTimeline);
  const prevApplied = appliedAtFromTimeline(prevTimeline);
  const prevChips = chipSnapshot(prevStatus, prevTimeline, prevApplied);

  timeline = sortTimeline(timeline);
  const res = await fetch(`/api/jobs/${jobId}/timeline`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ timeline }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Request failed');
  }
  const data = await res.json();
  const saved = sortTimeline(data.application_timeline || []);
  if (saved.length < timeline.length) {
    throw new Error('The server did not keep every step — restart the web server and try again');
  }
  refreshProgressUI(jobId, saved, data.status);
  applyChipDelta(prevChips, chipSnapshot(data.status, saved, data.applied_at));
  syncCompanyHistoryItem(jobId, data.status, saved, data.applied_at);
  if (!jobMatchesStatusFilter({
    status: data.status,
    application_timeline: saved,
    applied_at: data.applied_at,
  }, state.currentStatusFilter)) {
    removeMatchedCardSilently(document.getElementById(`card-${jobId}`));
  }
  refreshTrackerStats();
  return data;
}

function timelineAtOf(timeline, step) {
  const ev = [...(timeline || [])].reverse().find(item => item && item.step === step && item.at);
  return ev ? ev.at : '';
}

function initialTimeForStep(step, timeline) {
  // Backfilled Screening / Submitted default to an earlier stamp so they
  // land before Invite / rounds when the picker is saved as-is.
  if (step === 'screening') {
    return toLocalInputValue(timelineAtOf(timeline, 'applied') || nowLocalInputValue());
  }
  if (step === 'screening_done') {
    return toLocalInputValue(
      timelineAtOf(timeline, 'screening')
      || timelineAtOf(timeline, 'applied')
      || nowLocalInputValue()
    );
  }
  return nowLocalInputValue();
}

export async function addTimelineStep(jobId, step) {
  const label = TIMELINE_LABEL[step] || step;
  let timeline = (jobTimelines[jobId] || []).slice();
  const at = await askTimelineTime({
    title: `Record: ${label}`,
    hint: step === 'applied'
      ? 'When did you apply for this job?'
      : step === 'reapplied'
        ? 'When did you apply again (e.g. to the repost)?'
        : step === 'screening'
          ? 'When did they send the screening? It is placed on the track by this date.'
          : step === 'screening_done'
            ? 'When did you send the answers / video? It is placed on the track by this date.'
            : step === 'interview_invite'
              ? 'When did you receive the interview invitation?'
              : step === 'interview_cancelled'
                ? 'When did they cancel the interview? The invite stays, so Got interview does not change.'
                : `When did you get the “${label}” update?`,
    initial: initialTimeForStep(step, timeline),
  });
  if (!at) return;

  if (step === 'interview_cancelled') {
    const cancelTs = parseTimelineAt(at);
    timeline = timeline.filter(ev => {
      if (!INTERVIEW_STEPS.includes(ev && ev.step)) return true;
      return parseTimelineAt(ev.at) <= cancelTs;
    });
  }

  timeline.push({ step, at });
  try {
    await saveTimeline(jobId, timeline);
    showToast(`Recorded ${label} · ${at}`);
  } catch (err) {
    showToast('Failed to update progress: ' + (err.message || 'unknown error'), 'err');
  }
}

export async function editTimelineStep(jobId, index) {
  const timeline = (jobTimelines[jobId] || []).slice();
  const ev = timeline[index];
  if (!ev) return;
  const label = TIMELINE_LABEL[ev.step] || ev.step;
  const at = await askTimelineTime({
    title: `Edit time: ${label}`,
    hint: 'Update the date and time for this step',
    initial: toLocalInputValue(ev.at),
  });
  if (!at) return;

  timeline[index] = { ...ev, at };
  try {
    await saveTimeline(jobId, timeline);
    showToast(`Updated ${label} · ${at}`);
  } catch (err) {
    showToast('Failed to update time', 'err');
  }
}

export async function undoTimelineStep(jobId) {
  const timeline = (jobTimelines[jobId] || []).slice();
  if (!timeline.length) return;
  const wrap = document.getElementById(`progress-${jobId}`);
  const sideVal = wrap && wrap.querySelector('.status-side-select')
    ? wrap.querySelector('.status-side-select').value
    : '';
  // Side-status jobs keep the Applied record; undo later steps only
  if (SIDE_STATUSES.includes(sideVal) && timeline.length === 1 && timeline[0].step === 'applied') {
    showToast('Application record is kept for this status');
    return;
  }
  const removed = timeline.pop();
  try {
    await saveTimeline(jobId, timeline);
    showToast(`↩ Undid ${TIMELINE_LABEL[removed.step] || removed.step}`);
  } catch (err) {
    showToast('Undo failed', 'err');
  }
}

export async function updateSideStatus(select) {
  const id = select.dataset.id;
  let status = select.value;
  const currentTimeline = jobTimelines[id] || [];
  const prevStatus = currentJobStatus(id, currentTimeline);
  const prevApplied = appliedAtFromTimeline(currentTimeline);
  const prevChips = chipSnapshot(prevStatus, currentTimeline, prevApplied);
  if (!status) {
    // "—" restores the status derived from application progress
    status = statusFromTimeline(currentTimeline);
    if (!status) {
      select.value = '';
      return;
    }
  }

  try {
    const res = await fetch(`/api/jobs/${id}/status`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ status }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Request failed');
    const timeline = status === 'pending' ? [] : currentTimeline;
    refreshProgressUI(id, timeline, status);
    applyChipDelta(prevChips, chipSnapshot(status, timeline, prevApplied));
    syncCompanyHistoryItem(id, status, timeline, prevApplied);
    if (!jobMatchesStatusFilter({ status, application_timeline: timeline }, state.currentStatusFilter)) {
      // Fade this card out in place — no list reload, scroll position stays
      removeMatchedCardSilently(document.getElementById(`card-${id}`));
    }
    showToast(`Status updated to "${STATUS_LABEL[status]}"`);
    refreshTrackerStats();
  } catch (err) {
    showToast('Status update failed', 'err');
  }
}
