/* Timeouts page (templates/timeouts.html) entry module.
   Inline onclick="..." handlers call the functions exposed on window at the
   bottom of this file. */
import { escHtml, safeUrl } from './shared/html.js';
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(() => { t.className = 'toast'; }, 2200);
}
export async function loadJobs() {
  const source = document.getElementById('sourceFilter').value;
  const status = document.getElementById('statusFilter').value;
  const params = new URLSearchParams({ source, review_status: status });
  const res = await fetch('/api/timeout-jobs?' + params.toString());
  const data = await res.json();
  document.getElementById('countLabel').textContent = `${data.total} ${data.total === 1 ? 'job' : 'jobs'}`;
  const list = document.getElementById('list');
  if (!data.jobs.length) {
    list.innerHTML = '<div class="empty">No timeout jobs in this filter. New ones appear after the next scrape.</div>';
    return;
  }
  list.innerHTML = data.jobs.map(job => `
    <div class="card" data-id="${escHtml(job._id)}">
      <div>
        <h3>${escHtml(job.title)}</h3>
        <div class="meta">
          <span class="pill">${escHtml((job.source || '').toUpperCase())}</span>
          ${job.company ? `<span>${escHtml(job.company)}</span>` : ''}
          ${job.location ? `<span>${escHtml(job.location)}</span>` : ''}
          ${job.keyword ? `<span>q=${escHtml(job.keyword)}</span>` : ''}
          ${job.created_at ? `<span>${escHtml(job.created_at)}</span>` : ''}
          <span>Timed out ${escHtml(job.timeout_count)}×</span>
        </div>
      </div>
      <div class="actions">
        <a class="btn btn-ok" href="${escHtml(safeUrl(job.link))}" target="_blank" rel="noopener">Open job</a>
        ${job.review_status === 'open' ? `
          <button class="btn" onclick="addMatch(this.closest('.card').dataset.id)">Add as Not Applied</button>
          <button class="btn btn-mute" onclick="dismiss(this.closest('.card').dataset.id)">Dismiss</button>
        ` : `<span class="pill">${escHtml(job.review_status)}</span>`}
      </div>
    </div>
  `).join('');
}
export async function addMatch(id) {
  const res = await fetch(`/api/timeout-jobs/${id}/match`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Failed'); return; }
  toast(data.already ? 'Already on Tracker' : 'Added to Tracker as Not Applied');
  loadJobs();
}
export async function dismiss(id) {
  const res = await fetch(`/api/timeout-jobs/${id}/dismiss`, { method: 'POST' });
  if (!res.ok) { toast('Failed'); return; }
  toast('Dismissed');
  loadJobs();
}
loadJobs();

// Inline onclick="..." handlers in the page look these up on window
Object.assign(window, {
  addMatch, dismiss, loadJobs,
});
