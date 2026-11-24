/* Original job description: lazy load, copy, and user paste when scrape missed it. */
import { showToast } from '../shared/job_list.js';

const PLACEHOLDERS = new Set(['Expand to load…', 'Loading…', 'No description saved.']);

function isPlaceholder(text) {
  return !text || PLACEHOLDERS.has(text) || text.startsWith('Failed to load:');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }
}

export async function loadJobDescription(detailsEl) {
  if (!detailsEl.open) {
    if (detailsEl.classList.contains('editing')) cancelEditJobDescription(detailsEl);
    return;
  }
  const body = detailsEl.querySelector('.job-description-body');
  if (!body || body.dataset.loaded === '1') return;
  const jobId = detailsEl.dataset.jobId;
  if (!jobId) return;
  body.textContent = 'Loading…';
  try {
    const res = await fetch(`/api/jobs/${jobId}/description`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    const text = (data.description || '').trim();
    body.textContent = text || 'No description saved.';
    body.dataset.loaded = '1';
  } catch (err) {
    body.textContent = `Failed to load: ${err.message}`;
  }
}

/** Copy the full original JD (fetched if the panel was never opened). */
export async function copyJobDescription(btn) {
  const jobId = btn.dataset.jobId;
  const details = btn.closest('.job-description');
  const body = details && details.querySelector('.job-description-body');
  let text = body && body.dataset.loaded === '1' ? body.textContent : '';
  try {
    if (!text || isPlaceholder(text)) {
      const res = await fetch(`/api/jobs/${jobId}/description`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      text = (data.description || '').trim();
      if (text && body) {
        body.textContent = text;
        body.dataset.loaded = '1';
      }
    }
    if (!text || text === 'No description saved.') {
      showToast('No description saved for this job', 'err');
      return;
    }
    if (!(await copyText(text))) throw new Error('Clipboard blocked');
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    showToast(`Copied description (${text.length} chars)`);
  } catch (err) {
    showToast('Copy failed: ' + err.message, 'err');
  }
}

export async function startEditJobDescription(btn) {
  const details = btn.closest('.job-description');
  if (!details) return;
  details.open = true;
  const body = details.querySelector('.job-description-body');
  const textarea = details.querySelector('.jd-edit-textarea');
  if (!textarea) return;
  let initial = body && body.dataset.loaded === '1' ? body.textContent : '';
  if (isPlaceholder(initial)) initial = '';
  textarea.value = initial;
  details.classList.add('editing');
  textarea.focus();
  const saveBtn = details.querySelector('.jd-save-btn');
  if (body && body.dataset.loaded !== '1') {
    if (saveBtn) saveBtn.disabled = true;
    await loadJobDescription(details);
    if (textarea.value === initial) {
      let loaded = body.textContent || '';
      if (isPlaceholder(loaded)) loaded = '';
      textarea.value = loaded;
    }
    if (saveBtn) saveBtn.disabled = false;
  }
}

export function cancelEditJobDescription(el) {
  const details = el && el.closest ? el.closest('.job-description') : el;
  if (!details) return;
  details.classList.remove('editing');
  const saveBtn = details.querySelector('.jd-save-btn');
  if (saveBtn) saveBtn.disabled = false;
}

export async function saveJobDescription(btn) {
  const details = btn.closest('.job-description');
  if (!details) return;
  const jobId = details.dataset.jobId;
  const textarea = details.querySelector('.jd-edit-textarea');
  const body = details.querySelector('.job-description-body');
  const text = textarea ? textarea.value : '';

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '⏳';
  try {
    const res = await fetch(`/api/jobs/${jobId}/description`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    const saved = typeof data.description === 'string' ? data.description : text;
    if (body) {
      body.textContent = saved.trim() ? saved : 'No description saved.';
      body.dataset.loaded = '1';
    }
    details.classList.remove('editing');
    showToast('Original description saved');
  } catch (err) {
    showToast('Save failed: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}
