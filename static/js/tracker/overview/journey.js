/* Overview: application journey (one track per company, steps on a shared
   date axis) with the step tooltip and the company popover. */
import { escHtml } from '../../shared/html.js';
import { parseTimelineAt } from '../timeline.js';

function formatJourneyDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function journeyNodeClass(step) {
  if (step === 'applied') return 'step-applied';
  if (step === 'reapplied') return 'step-reapplied';
  if (String(step).startsWith('screening')) return 'step-screening';
  if (step === 'rejected') return 'step-rejected';
  if (step === 'offer') return 'step-offer';
  if (step === 'interview_cancelled') return 'step-cancelled';
  if (String(step).startsWith('interview_')) return 'step-interview';
  return '';
}

function parseJourneyDay(iso) {
  const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function journeyPct(day, start, end) {
  if (!day || !start || !end) return 0;
  const t0 = start.getTime();
  const t1 = end.getTime();
  if (t1 <= t0) return 0;
  const p = ((day.getTime() - t0) / (t1 - t0)) * 100;
  return Math.max(0, Math.min(100, p));
}

function renderCompanyTrack(track, start, end) {
  const rank = {
    applied: 0, reapplied: 1, screening: 2, screening_done: 3,
    interview_invite: 4, interview_1: 5, interview_2: 6, interview_3: 7,
    interview_final: 8, interview_cancelled: 9, rejected: 10, offer: 11,
  };
  const steps = (track.steps || [])
    .map(s => ({ ...s, _day: parseJourneyDay(s.date || s.at) }))
    .filter(s => s._day)
    .sort((a, b) => {
      const da = parseTimelineAt ? parseTimelineAt(a.at || a.date) : a._day;
      const db = parseTimelineAt ? parseTimelineAt(b.at || b.date) : b._day;
      if (da !== db) return da - db;
      return (rank[a.step] ?? 99) - (rank[b.step] ?? 99);
    });

  const segs = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const a = journeyPct(steps[i]._day, start, end);
    const b = journeyPct(steps[i + 1]._day, start, end);
    const left = Math.min(a, b);
    const width = Math.max(0, Math.abs(b - a));
    let cls = 'jt-seg';
    if (steps[i + 1].step === 'rejected') cls += ' end-rejected';
    else if (steps[i + 1].step === 'offer') cls += ' end-offer';
    else if (steps[i + 1].step === 'interview_cancelled') cls += ' end-cancelled';
    segs.push(`<div class="${cls}" style="left:${left}%;width:${width}%"></div>`);
  }

  const nodes = steps.map(s => {
    const label = s.label || s.step;
    const when = formatJourneyDate(s.date || s.at);
    const tip = when ? `${label} · ${when}` : label;
    const left = journeyPct(s._day, start, end);
    return `
      <button type="button" class="jt-node ${journeyNodeClass(s.step)}"
              style="left:${left}%"
              data-tip="${escHtml(tip)}"
              onmouseenter="showJourneyTip(this)"
              onmouseleave="hideJourneyTip()"
              onfocus="showJourneyTip(this)"
              onblur="hideJourneyTip()"
              aria-label="${escHtml(tip)}">
        <span class="jt-dot"></span>
      </button>`;
  }).join('');

  const company = track.company || 'Unknown';
  const title = track.title || '';

  return `
    <div class="journey-track">
      <div class="journey-plot">
        <div class="journey-scale">${segs.join('')}${nodes}</div>
      </div>
      <div class="journey-side">
        <button type="button" class="jt-info"
                data-company="${escHtml(company)}"
                data-title="${escHtml(title)}"
                title="Company info"
                onclick="toggleCompanyPop(this)"
                aria-label="Company info">i</button>
      </div>
    </div>
  `;
}

export function toggleCompanyPop(btn) {
  const key = `${btn.dataset.company || ''}||${btn.dataset.title || ''}`;
  const existing = document.getElementById('jtCompanyPop');
  if (existing && existing.dataset.anchorId === key) {
    hideCompanyPop();
    return;
  }
  hideCompanyPop();

  btn.classList.add('active');

  const pop = document.createElement('div');
  pop.id = 'jtCompanyPop';
  pop.className = 'jt-company-pop';
  pop.dataset.anchorId = key;
  pop.innerHTML = `
    <div class="jcp-company">${escHtml(btn.dataset.company || 'Unknown')}</div>
    ${btn.dataset.title ? `<div class="jcp-title">${escHtml(btn.dataset.title)}</div>` : ''}
  `;
  document.body.appendChild(pop);

  const r = btn.getBoundingClientRect();
  const pad = 8;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = r.right - pw;
  let top = r.bottom + 6;
  if (left < pad) left = pad;
  if (left + pw > window.innerWidth - pad) left = window.innerWidth - pad - pw;
  if (top + ph > window.innerHeight - pad) top = r.top - ph - 6;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  requestAnimationFrame(() => pop.classList.add('show'));
}

function hideCompanyPop() {
  document.querySelectorAll('.jt-info.active').forEach(el => el.classList.remove('active'));
  const pop = document.getElementById('jtCompanyPop');
  if (pop) pop.remove();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.jt-info') || e.target.closest('#jtCompanyPop')) return;
  hideCompanyPop();
});

export function showJourneyTip(el) {
  hideCompanyPop();
  const text = el.getAttribute('data-tip') || '';
  if (!text) return;
  let tip = document.getElementById('jtFloatingTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'jtFloatingTip';
    tip.className = 'jt-floating-tip';
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  const r = el.getBoundingClientRect();
  tip.style.left = `${r.left + r.width / 2}px`;
  tip.style.top = `${r.top}px`;
  tip.classList.add('show');
}

export function hideJourneyTip() {
  const tip = document.getElementById('jtFloatingTip');
  if (tip) tip.classList.remove('show');
}

export async function loadJourney() {
  const root = document.getElementById('journeyRoot');
  if (!root) return;
  hideCompanyPop();
  try {
    const res = await fetch('/api/journey', { cache: 'no-store' });
    const data = await res.json();
    const total = data.total_applied || 0;

    if (!total) {
      root.innerHTML = '<div class="journey-empty">No applications recorded yet</div>';
      return;
    }

    const start = parseJourneyDay(data.start_date);
    const end = parseJourneyDay(data.end_date);
    const today = parseJourneyDay(data.today || data.end_date);
    const todayPct = journeyPct(today, start, end);
    const showToday = today && start && end && today > start && today < end;

    const tracks = data.tracks || [];
    const tracksHtml = tracks.length
      ? `<div class="journey-tracks">${tracks.map(t => renderCompanyTrack(t, start, end)).join('')}</div>`
      : `<div class="journey-empty">No interview timelines yet</div>`;

    root.innerHTML = `
      <div class="journey-panel">
        <div class="journey-overview">
          <div class="journey-axis">
            <div class="journey-scale">
              <div class="journey-axis-rail"></div>
              ${showToday ? `<div class="journey-axis-today" style="left:${todayPct}%"></div>` : ''}
              <span class="jo-endpoint start"></span>
              <span class="jo-endpoint end"></span>
              <span class="journey-axis-label start">${formatJourneyDate(data.start_date)}</span>
              <span class="journey-axis-label end">${formatJourneyDate(data.end_date)}</span>
            </div>
          </div>
          <div class="journey-overview-total">
            <div class="jot-num">${total}</div>
            <div class="jot-label">applied</div>
          </div>
        </div>
        ${tracksHtml}
      </div>
    `;
  } catch (_) {
    root.innerHTML = '<div class="journey-empty">Failed to load journey</div>';
  }
}
