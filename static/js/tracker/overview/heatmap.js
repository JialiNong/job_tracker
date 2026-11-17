/* Overview: activity calendar heatmap (~3 months of week columns) and the
   day detail panel; click / double-tap opens that day's applications. */
import { formatDate, TOUCH_UI } from '../../shared/job_list.js';
import { filterByAppliedDay } from '../index.js';

let calDaysByDate = {};
let calSelectedDate = null;
// Phone: single tap shows the day panel; double-tap opens that day's applications.
let calLastTapAt = 0;
let calLastTapDate = '';
const CAL_DOUBLE_TAP_MS = 400;

function calActivityScore(d) {
  return (d.title_clicked || 0) + (d.ai_matched || 0) + (d.applied || 0);
}

function calLevel(score, maxScore) {
  if (!score || maxScore <= 0) return 0;
  const r = score / maxScore;
  if (r <= 0.25) return 1;
  if (r <= 0.5)  return 2;
  if (r <= 0.75) return 3;
  return 4;
}

function showCalDetail(dateStr) {
  const d = calDaysByDate[dateStr];
  if (!d) return;
  calSelectedDate = dateStr;
  document.querySelectorAll('.cal-cell.selected').forEach(el => el.classList.remove('selected'));
  const cell = document.querySelector(`.cal-cell[data-date="${dateStr}"]`);
  if (cell) cell.classList.add('selected');

  const today = formatDate(new Date());
  let label = dateStr;
  if (dateStr === today) label = `Today · ${dateStr}`;
  else {
    const yd = new Date(); yd.setDate(yd.getDate() - 1);
    if (dateStr === formatDate(yd)) label = `Yesterday · ${dateStr}`;
  }
  document.getElementById('calDetailDate').textContent = label;
  document.getElementById('calDetailDate').classList.remove('muted');
  document.getElementById('cd-clicked').textContent = d.title_clicked;
  document.getElementById('cd-german').textContent  = d.german_filtered;
  document.getElementById('cd-matched').textContent = d.ai_matched;
  document.getElementById('cd-applied').textContent = d.applied;
  const link = document.getElementById('calDetailLink');
  link.hidden = !d.applied;
  link.href = appliedDayUrl(dateStr);
  const agentN = Number(d.agent_unmatched) || 0;
  const agentLink = document.getElementById('calAgentUnmatchedLink');
  if (agentLink) {
    agentLink.hidden = !agentN;
    if (agentN) {
      const noun = agentN === 1 ? 'job' : 'jobs';
      agentLink.textContent = `Agent recommended, still Unmatched (${agentN} ${noun})`;
      agentLink.href = unmatchedAgentDayUrl(dateStr);
    }
  }
}

/** Tracker URL listing the jobs applied (or reapplied) on one day. */
function appliedDayUrl(dateStr) {
  return `/?applied=${encodeURIComponent(dateStr)}`;
}

/** Unmatched list for agent pushes that stayed below the match cut-off that day. */
function unmatchedAgentDayUrl(dateStr) {
  const day = encodeURIComponent(dateStr);
  return `/unmatched?agent=1&date_from=${day}&date_to=${day}`;
}

export async function loadDailyStats() {
  const container = document.getElementById('calMonths');
  if (!container) return;

  try {
    // ~3 months (13–14 week columns)
    const res = await fetch('/api/stats/daily?days=92', { cache: 'no-store' });
    const data = await res.json();
    const days = data.days || [];
    calDaysByDate = {};
    days.forEach(d => { calDaysByDate[d.date] = d; });

    const maxScore = Math.max(0, ...days.map(calActivityScore));

    // Build week columns starting from the Sunday of the first day
    if (!days.length) {
      container.innerHTML = '';
      return;
    }

    const first = new Date(days[0].date + 'T12:00:00');
    const last  = new Date(days[days.length - 1].date + 'T12:00:00');
    // Align start to Sunday
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const weeks = [];
    let cursor = new Date(gridStart);
    while (cursor <= last || cursor.getDay() !== 0 || weeks.length === 0) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const ds = formatDate(cursor);
        const inRange = calDaysByDate[ds];
        week.push(inRange ? { date: ds, data: inRange } : { date: ds, data: null });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
      if (cursor > last && cursor.getDay() === 0) break;
      // safety
      if (weeks.length > 60) break;
    }

    container.innerHTML = '';
    let prevMonth = -1;
    weeks.forEach(week => {
      const col = document.createElement('div');
      col.className = 'cal-month-col';

      // Month label on the first week that contains the 1st, or first week of a new month
      const mid = week.find(c => c.data) || week[0];
      const midDate = new Date(mid.date + 'T12:00:00');
      const month = midDate.getMonth();
      const label = document.createElement('div');
      label.className = 'cal-month-label';
      if (month !== prevMonth) {
        label.textContent = monthNames[month];
        prevMonth = month;
      }
      col.appendChild(label);

      const weekEl = document.createElement('div');
      weekEl.className = 'cal-week';
      week.forEach(cell => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cal-cell';
        if (!cell.data) {
          btn.classList.add('empty');
          btn.disabled = true;
          btn.tabIndex = -1;
        } else {
          const score = calActivityScore(cell.data);
          btn.classList.add('l' + calLevel(score, maxScore));
          btn.dataset.date = cell.date;
          const statsTitle = `${cell.date}: ${cell.data.title_clicked} clicked, ${cell.data.german_filtered} german, ${cell.data.ai_matched} matched, ${cell.data.applied} applied`;
          btn.addEventListener('mouseenter', () => showCalDetail(cell.date));
          if (cell.data.applied) btn.classList.add('has-applied');
          if (TOUCH_UI) {
            btn.title = cell.data.applied
              ? `${statsTitle} · tap for details, double-tap for applications`
              : `${statsTitle} · tap for details`;
            btn.addEventListener('click', () => {
              showCalDetail(cell.date);
              const now = Date.now();
              if (
                cell.data.applied
                && calLastTapDate === cell.date
                && now - calLastTapAt < CAL_DOUBLE_TAP_MS
              ) {
                calLastTapAt = 0;
                calLastTapDate = '';
                filterByAppliedDay(cell.date);
                return;
              }
              calLastTapAt = now;
              calLastTapDate = cell.date;
            });
          } else {
            btn.title = cell.data.applied
              ? `${statsTitle} · click to open that day's applications`
              : statsTitle;
            btn.addEventListener('click', () => {
              showCalDetail(cell.date);
              if (cell.data.applied) window.open(appliedDayUrl(cell.date), '_blank', 'noopener');
            });
          }
        }
        weekEl.appendChild(btn);
      });
      col.appendChild(weekEl);
      container.appendChild(col);
    });

    // Default detail: today (or last day with activity)
    const today = formatDate(new Date());
    if (calDaysByDate[today]) {
      showCalDetail(today);
    } else {
      const withActivity = [...days].reverse().find(d => calActivityScore(d) > 0 || d.german_filtered > 0);
      if (withActivity) showCalDetail(withActivity.date);
    }

    requestAnimationFrame(sizeHeatmapToWidth);
  } catch (_) {
    container.innerHTML = '';
  }
}

function sizeHeatmapToWidth() {
  const section = document.getElementById('calSection');
  const body = section && section.querySelector('.cal-body');
  const wrap = section && section.querySelector('.cal-wrap');
  const detail = section && section.querySelector('.cal-detail');
  const months = document.getElementById('calMonths');
  if (!section || !body || !wrap || !months) return;

  const weekCount = months.querySelectorAll('.cal-month-col').length;
  if (!weekCount) return;

  const dow = wrap.querySelector('.cal-dow');
  const gap = parseFloat(getComputedStyle(section).getPropertyValue('--cal-gap')) || 2;
  const wrapGap = parseFloat(getComputedStyle(wrap).gap) || 8;
  const bodyGap = parseFloat(getComputedStyle(body).gap) || 10;
  const dowWidth = dow ? dow.getBoundingClientRect().width : 16;
  // On phones the details sit under the grid (column layout): full width for cells
  const stacked = getComputedStyle(body).flexDirection === 'column';
  const detailW = detail && !stacked ? detail.getBoundingClientRect().width : 0;
  const available = body.clientWidth - detailW - (stacked ? 0 : bodyGap) - dowWidth - wrapGap;
  const cell = Math.floor((available - (weekCount - 1) * gap) / weekCount);
  // Desktop keeps the full 26px cells when there is room; shrink to fit otherwise
  const maxCell = window.innerWidth > 900 ? 26 : (stacked ? 24 : (window.innerWidth <= 768 ? 16 : 18));
  if (cell >= 8) {
    section.style.setProperty('--cal-cell', `${Math.min(cell, maxCell)}px`);
  }
}

let calResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(calResizeTimer);
  calResizeTimer = setTimeout(sizeHeatmapToWidth, 120);
});
