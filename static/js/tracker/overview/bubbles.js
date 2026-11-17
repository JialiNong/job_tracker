/* Overview: applied-location bubbles (greedy circle pack, re-packed when
   the canvas changes size). */
import { escHtml } from '../../shared/html.js';
import { POINT_VERB } from '../../shared/job_list.js';

/* Same hues as the funnel / daily-activity numbers, washed to glass. */
const LOC_BUBBLE_COLORS = [
  // Theme tokens from base.css, so the bubbles follow light / dark mode
  { fill: 'color-mix(in srgb, var(--accent) 80%, transparent)',    ink: 'var(--surface)' },
  { fill: 'color-mix(in srgb, var(--applied) 80%, transparent)',   ink: 'var(--surface)' },
  { fill: 'color-mix(in srgb, var(--interview) 82%, transparent)', ink: 'var(--surface)' },
  { fill: 'color-mix(in srgb, var(--hl) 92%, transparent)',        ink: 'var(--hl-ink)' },
  { fill: 'color-mix(in srgb, var(--offer) 80%, transparent)',     ink: 'var(--surface)' },
];

function packLocationBubbles(items, width, height) {
  // Greedy circle pack: largest first, nest tightly around the center.
  // inset = stay inside the rounded clip; gap = space between circles.
  // Never overlaps: items with no free spot are returned in `skipped`.
  const cx = width / 2;
  const cy = height / 2;
  const placed = [];
  const skipped = [];
  const inset = 8;
  const gap = 2;

  const fits = (x, y, r) => {
    if (x - r < inset || x + r > width - inset || y - r < inset || y + r > height - inset) {
      return false;
    }
    for (const p of placed) {
      if (Math.hypot(x - p.x, y - p.y) < p.r + r + gap - 0.5) return false;
    }
    return true;
  };

  for (const item of items) {
    if (!placed.length) {
      if (fits(cx, cy, item.r)) placed.push({ ...item, x: cx, y: cy });
      else skipped.push(item);
      continue;
    }

    let best = null;
    for (const other of placed) {
      const ring = other.r + item.r + gap;
      for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180;
        const x = other.x + Math.cos(rad) * ring;
        const y = other.y + Math.sin(rad) * ring;
        if (!fits(x, y, item.r)) continue;
        const score = Math.hypot(x - cx, y - cy);
        if (!best || score < best.score) best = { x, y, score };
      }
    }

    if (best) placed.push({ ...item, x: best.x, y: best.y });
    else skipped.push(item);
  }
  return { placed, skipped };
}

function renderLocationBubbles(locations, total) {
  const root = document.getElementById('locBubbles');
  if (!root) return;

  const width = Math.max(root.clientWidth || 640, 320);
  const height = Math.max(root.clientHeight || 280, 200);
  const maxCount = Math.max(...locations.map(l => l.count || 0), 1);

  // Smaller bubbles on mobile so the packed cloud stays inside the canvas
  const isMobile = window.innerWidth <= 768;
  const baseMinR = isMobile ? 14 : 22;
  const baseMaxR = isMobile ? Math.min(32, Math.floor(Math.min(width, height) * 0.15)) : Math.min(58, Math.floor(Math.min(width, height) * 0.22));

  const buildItems = (scale) => {
    const minR = Math.max(12, baseMinR * scale);
    const maxR = Math.max(minR, baseMaxR * scale);
    return locations.map((loc, i) => {
      const count = loc.count || 0;
      const t = Math.sqrt(count / maxCount);
      const palette = LOC_BUBBLE_COLORS[i % LOC_BUBBLE_COLORS.length];
      return {
        name: loc.name || 'Remote',
        count,
        r: Math.round(minR + (maxR - minR) * t),
        color: palette.fill,
        ink: palette.ink,
      };
    });
  };

  // Shrink all bubbles until every one fits without overlap; if even the
  // smallest scale can't fit them all, drop the leftovers (smallest counts).
  let packed = null;
  for (let scale = 1; scale >= 0.5; scale -= 0.08) {
    packed = packLocationBubbles(buildItems(scale), width, height);
    if (!packed.skipped.length) break;
  }

  root.classList.remove('has-open');
  root.innerHTML = packed.placed.map(b => {
    const size = b.r * 2;
    return `
      <div class="loc-bubble"
           style="--size:${size}px; --bubble:${b.color}; --bubble-ink:${b.ink}; left:${b.x}px; top:${b.y}px"
           role="button"
           tabindex="0"
           aria-label="${escHtml(b.name)}: ${b.count}"
           onclick="toggleLocBubble(this)">
        <span class="lb-name">${escHtml(b.name)}</span>
        <span class="lb-count">${b.count}</span>
      </div>`;
  }).join('');
}

let _locStatsCache = null;

export function toggleLocBubble(el) {
  const root = document.getElementById('locBubbles');
  const wasOpen = el.classList.contains('is-open');
  document.querySelectorAll('.loc-bubble.is-open').forEach(b => b.classList.remove('is-open'));
  if (!wasOpen) {
    el.classList.add('is-open');
    if (root) root.classList.add('has-open');
  } else if (root) {
    root.classList.remove('has-open');
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.loc-bubble')) return;
  document.querySelectorAll('.loc-bubble.is-open').forEach(b => b.classList.remove('is-open'));
  document.getElementById('locBubbles')?.classList.remove('has-open');
});

export async function loadLocationStats() {
  const root = document.getElementById('locBubbles');
  const sub = document.getElementById('locSubtitle');
  if (!root) return;
  try {
    const res = await fetch('/api/stats/locations', { cache: 'no-store' });
    const data = await res.json();
    const total = data.total || 0;
    // Single-job cities add clutter; only chart places with 2+ applications
    const locations = (data.locations || [])
      .filter(l => (l.count || 0) >= 2)
      .sort((a, b) => (b.count || 0) - (a.count || 0));
    _locStatsCache = { locations, total };

    if (sub) {
      sub.textContent = total
        ? `${total} applied · ${POINT_VERB} a bubble for count`
        : 'Applied · rejected · interview · offer';
    }
    if (!locations.length) {
      root.innerHTML = `<div class="loc-empty">${total ? 'No city with 2+ applications yet' : 'No applied jobs yet'}</div>`;
      return;
    }
    // Wait a frame so clientWidth is correct after layout
    requestAnimationFrame(() => renderLocationBubbles(locations, total));
  } catch (_) {
    root.innerHTML = '<div class="loc-empty">Failed to load locations</div>';
  }
}

// The canvas also changes size without a window resize: it stretches to the
// Journey panel's height once that loads, and is 0×0 while Overview is hidden.
// Re-pack the bubbles whenever its real size changes.
(() => {
  const root = document.getElementById('locBubbles');
  if (!root || !window.ResizeObserver) return;
  let lastW = 0, lastH = 0, timer = null;
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return; // hidden tab
    if (Math.abs(width - lastW) < 2 && Math.abs(height - lastH) < 2) return;
    lastW = width; lastH = height;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (_locStatsCache?.locations?.length) {
        renderLocationBubbles(_locStatsCache.locations, _locStatsCache.total);
      }
    }, 120);
  }).observe(root);
})();
