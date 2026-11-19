/**
 * Pure layout for the Overview charts (no DOM, no React): heatmap grid,
 * Sankey geometry, weekly bars, journey positions, location bubble packing.
 * Ported from static/js/tracker/overview/*.js and flow.js.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtCount = (n: number) => Number(n || 0).toLocaleString("en-US");

/** "12%", or "4.5%" under 10%. */
export function pctLabel(n: number, of: number): string {
  if (!of) return "0%";
  const p = (n / of) * 100;
  return `${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

const ymd = (iso: string) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? { y: +m[1]!, m: +m[2]!, d: +m[3]! } : null;
};

/** "2026-11-13" -> "Nov 13" */
export function monthDay(iso: string): string {
  const p = ymd(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.d}` : iso;
}

// ── Heatmap ─────────────────────────────────────────────────────────────────

export interface DayStats {
  date: string;
  title_clicked: number;
  german_filtered: number;
  ai_matched: number;
  applied: number;
  agent_unmatched: number;
}

export const activityScore = (d: DayStats) => (d.title_clicked || 0) + (d.ai_matched || 0) + (d.applied || 0);

/** Colour step 0-4 by quarter of the busiest day. */
export function activityLevel(score: number, max: number): number {
  if (!score || max <= 0) return 0;
  const r = score / max;
  return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface HeatWeek {
  monthLabel: string; // shown on the first week of a new month
  cells: { date: string; data: DayStats | null }[];
}

/** Week columns (Sunday first) covering the given days; days outside the range are empty cells. */
export function heatmapWeeks(days: DayStats[]): HeatWeek[] {
  if (!days.length) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = new Date(`${days[0]!.date}T00:00:00Z`);
  const last = days[days.length - 1]!.date;
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay()); // back to Sunday
  const weeks: HeatWeek[] = [];
  let prevMonth = -1;
  while (weeks.length < 60) {
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const date = isoDay(cursor);
      cells.push({ date, data: byDate.get(date) ?? null });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const mid = cells.find((c) => c.data) ?? cells[0]!;
    const month = ymd(mid.date)!.m - 1;
    weeks.push({ monthLabel: month !== prevMonth ? MONTHS[month]! : "", cells });
    prevMonth = month;
    if (isoDay(cursor) > last) break;
  }
  return weeks;
}

// ── Sankey ──────────────────────────────────────────────────────────────────

export interface SankeyNode {
  id: string;
  label: string;
  column: number;
  tone: string;
  value: number;
}
export interface SankeyData {
  total: number;
  nodes: SankeyNode[];
  links: { source: string; target: string; value: number }[];
}
export interface LaidNode extends SankeyNode {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LaidLink {
  source: string;
  target: string;
  value: number;
  tone: string;
  path: string;
}

const NODE_W = 13;
const NODE_GAP = 7;

/** Three columns: Applied | Interview / Screening / Waiting / Rejected | interview outcomes. */
export function layoutSankey(sankey: SankeyData, width: number, height: number) {
  const padT = 10;
  const padB = 10;
  const hasCol2 = sankey.nodes.some((n) => n.column === 2);
  const padL = 86;
  const padR = hasCol2 ? 142 : 128;
  const innerW = Math.max(40, width - padL - padR);
  const gapX = hasCol2 ? (innerW - NODE_W * 3) / 2 : innerW - NODE_W * 2;
  const xs = [padL, padL + NODE_W + Math.max(28, gapX)];
  if (hasCol2) xs.push(xs[1]! + NODE_W + Math.max(28, gapX));

  const byCol: SankeyNode[][] = [[], [], []];
  sankey.nodes.forEach((n) => byCol[n.column]?.push(n));
  const avail = Math.max(40, height - padT - padB);
  const col0Sum = byCol[0]!.reduce((s, n) => s + n.value, 0) || 1;
  const px = (avail - Math.max(0, byCol[0]!.length - 1) * NODE_GAP) / col0Sum;

  const stack = (list: SankeyNode[], x: number, minH: number): LaidNode[] => {
    const nodes = list.map((n) => ({ ...n, x, y: 0, w: NODE_W, h: n.value ? Math.max(n.value * px, minH) : 0 }));
    const raw = nodes.reduce((s, n) => s + n.h, 0) + Math.max(0, nodes.length - 1) * NODE_GAP;
    const fit = raw > avail ? avail / raw : 1;
    let y = padT;
    for (const n of nodes) {
      n.h *= fit;
      n.y = y;
      y += n.h + NODE_GAP * fit;
    }
    return nodes;
  };
  const col0 = stack(byCol[0]!, xs[0]!, 6);
  const col1 = stack(byCol[1]!, xs[1]!, 14);

  // Interview outcomes are centred on the Interview node
  let col2: LaidNode[] = [];
  if (hasCol2 && byCol[2]!.length) {
    const interview = col1.find((n) => n.id === "interview");
    const gaps = Math.max(0, byCol[2]!.length - 1) * NODE_GAP;
    const sum = byCol[2]!.reduce((s, n) => s + n.value, 0) || 1;
    const heights = byCol[2]!.map((n) => Math.max((n.value / sum) * Math.max(8, (interview ? interview.h : avail) - gaps), 12));
    const totalH = heights.reduce((a, b) => a + b, 0) + gaps;
    let y = Math.max(padT, interview ? interview.y + (interview.h - totalH) / 2 : padT);
    if (y + totalH > height - padB) y = Math.max(padT, height - padB - totalH);
    col2 = byCol[2]!.map((n, i) => {
      const node = { ...n, x: xs[2]!, y, w: NODE_W, h: heights[i]! };
      y += node.h + NODE_GAP;
      return node;
    });
  }

  const nodes = [...col0, ...col1, ...col2];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  const ordered = [...sankey.links].sort((a, b) =>
    (byId.get(a.target)?.y ?? 0) - (byId.get(b.target)?.y ?? 0) || (byId.get(a.source)?.y ?? 0) - (byId.get(b.source)?.y ?? 0));
  const links: LaidLink[] = [];
  for (const l of ordered) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (!s || !t || !s.value || !t.value) continue;
    const sH = (l.value / s.value) * s.h;
    const tH = (l.value / t.value) * t.h;
    const sy = s.y + (outOff.get(s.id) ?? 0);
    const ty = t.y + (inOff.get(t.id) ?? 0);
    outOff.set(s.id, (outOff.get(s.id) ?? 0) + sH);
    inOff.set(t.id, (inOff.get(t.id) ?? 0) + tH);
    const sx = s.x + s.w;
    const tx = t.x;
    const mid = (sx + tx) / 2;
    links.push({
      source: l.source, target: l.target, value: l.value, tone: t.tone,
      path: `M${sx},${sy} C${mid},${sy} ${mid},${ty} ${tx},${ty} L${tx},${ty + tH} C${mid},${ty + tH} ${mid},${sy + sH} ${sx},${sy + sH} Z`,
    });
  }
  return { nodes, links, byId };
}

export type FlowPick = { kind: "node"; id: string } | { kind: "link"; source: string; target: string; value: number };

export function describeFlowPick(pick: FlowPick, sankey: SankeyData): string {
  const byId = new Map(sankey.nodes.map((n) => [n.id, n]));
  if (pick.kind === "node") {
    const n = byId.get(pick.id);
    if (!n) return "";
    const of = n.column === 2 ? byId.get("interview")?.value ?? sankey.total : sankey.total;
    return `${n.label} ${fmtCount(n.value)} · ${pctLabel(n.value, of)} of ${n.column === 2 ? "interview" : "applied"}`;
  }
  const s = byId.get(pick.source);
  const t = byId.get(pick.target);
  return s && t ? `${fmtCount(pick.value)} ${s.label} → ${t.label} · ${pctLabel(pick.value, s.value)}` : "";
}

// ── Weekly bars ─────────────────────────────────────────────────────────────

export interface Week {
  week_start: string;
  linkedin: number;
  indeed: number;
  other: number;
  total: number;
}

/** "2 Nov" */
export function dayMonth(iso: string): string {
  const p = ymd(iso);
  return p ? `${p.d} ${MONTHS[p.m - 1]}` : iso;
}

/** "2 Nov–8 Nov" */
export function weekRange(iso: string): string {
  const p = ymd(iso);
  if (!p) return iso;
  const end = new Date(Date.UTC(p.y, p.m - 1, p.d + 6));
  return `${p.d} ${MONTHS[p.m - 1]}–${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
}

export function describeWeek(week: Week | null, totals?: Omit<Week, "week_start">): string {
  if (!week) {
    const t = totals ?? { linkedin: 0, indeed: 0, other: 0, total: 0 };
    return `${fmtCount(t.total)} applications · LinkedIn ${fmtCount(t.linkedin)} · Indeed ${fmtCount(t.indeed)} · Other ${fmtCount(t.other)}`;
  }
  return `${weekRange(week.week_start)} · LinkedIn ${fmtCount(week.linkedin)} · Indeed ${fmtCount(week.indeed)} · Other ${fmtCount(week.other)} · ${fmtCount(week.total)} total`;
}

export function weeklyGeometry(weeks: Week[], width: number, plotH: number) {
  const padT = 22;
  const padB = 28;
  const barGap = 4;
  const minBar = 12;
  const avail = Math.max(width, 160);
  const slot = Math.max(minBar + barGap, Math.floor((avail - 8) / Math.max(weeks.length, 1)));
  const barW = Math.max(minBar, Math.min(22, slot - barGap));
  const innerW = Math.max(avail, weeks.length * (barW + barGap) + 8);
  const max = Math.max(1, ...weeks.map((w) => w.total || 0));
  const bodyH = plotH - padT - padB;
  let prevMonth = "";
  const bars = weeks.map((week, i) => {
    const x = 4 + i * (barW + barGap);
    let y = padT + bodyH;
    const segs: { key: "other" | "indeed" | "linkedin"; y: number; h: number }[] = [];
    for (const key of ["other", "indeed", "linkedin"] as const) {
      const v = week[key] || 0;
      if (!v) continue;
      const h = (v / max) * bodyH;
      y -= h;
      segs.push({ key, y, h: Math.max(h, 1) });
    }
    const month = dayMonth(week.week_start).split(" ")[1] ?? "";
    const monthLabel = month && month !== prevMonth ? month : "";
    if (monthLabel) prevMonth = month;
    return { week, i, x, segs, top: segs.length ? segs[segs.length - 1]!.y : padT + bodyH, monthLabel };
  });
  return { padT, bodyH, barW, slot, innerW, plotH, bars };
}

// ── Journey ─────────────────────────────────────────────────────────────────

const dayValue = (iso: string) => {
  const p = ymd(iso);
  return p ? Date.UTC(p.y, p.m - 1, p.d) : null;
};

/** Position of a day on the start..end axis, 0-100. */
export function axisPercent(iso: string, start: string, end: string): number {
  const d = dayValue(iso);
  const a = dayValue(start);
  const b = dayValue(end);
  if (d === null || a === null || b === null || b <= a) return 0;
  return Math.max(0, Math.min(100, ((d - a) / (b - a)) * 100));
}

// ── Location bubbles ────────────────────────────────────────────────────────

export interface Bubble {
  name: string;
  count: number;
  r: number;
  color: string;
  ink: string;
  x: number;
  y: number;
}

const BUBBLE_COLORS = [
  { fill: "color-mix(in srgb, var(--accent) 80%, transparent)", ink: "var(--surface)" },
  { fill: "color-mix(in srgb, var(--applied) 80%, transparent)", ink: "var(--surface)" },
  { fill: "color-mix(in srgb, var(--interview) 82%, transparent)", ink: "var(--surface)" },
  { fill: "color-mix(in srgb, var(--hl) 92%, transparent)", ink: "var(--hl-ink)" },
  { fill: "color-mix(in srgb, var(--offer) 80%, transparent)", ink: "var(--surface)" },
];

type Item = Omit<Bubble, "x" | "y">;

/** Greedy circle pack around the centre; never overlaps, leftovers come back in `skipped`. */
function pack(items: Item[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const inset = 8;
  const gap = 2;
  const placed: Bubble[] = [];
  const skipped: Item[] = [];
  const fits = (x: number, y: number, r: number) =>
    x - r >= inset && x + r <= width - inset && y - r >= inset && y + r <= height - inset
    && placed.every((p) => Math.hypot(x - p.x, y - p.y) >= p.r + r + gap - 0.5);
  for (const item of items) {
    if (!placed.length) {
      if (fits(cx, cy, item.r)) placed.push({ ...item, x: cx, y: cy }); else skipped.push(item);
      continue;
    }
    let best: { x: number; y: number; score: number } | null = null;
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
    if (best) placed.push({ ...item, x: best.x, y: best.y }); else skipped.push(item);
  }
  return { placed, skipped };
}

/** Bubbles sized by sqrt(count), shrunk until all fit (or the smallest scale drops leftovers). */
export function packBubbles(locations: { name: string; count: number }[], width: number, height: number, phone: boolean): Bubble[] {
  const w = Math.max(width || 640, 320);
  const h = Math.max(height || 280, 200);
  const maxCount = Math.max(1, ...locations.map((l) => l.count || 0));
  const baseMin = phone ? 14 : 22;
  const baseMax = phone ? Math.min(32, Math.floor(Math.min(w, h) * 0.15)) : Math.min(58, Math.floor(Math.min(w, h) * 0.22));
  let result = { placed: [] as Bubble[], skipped: [] as Item[] };
  for (let scale = 1; scale >= 0.5; scale -= 0.08) {
    const minR = Math.max(12, baseMin * scale);
    const maxR = Math.max(minR, baseMax * scale);
    const items = locations.map((loc, i) => {
      const palette = BUBBLE_COLORS[i % BUBBLE_COLORS.length]!;
      const t = Math.sqrt((loc.count || 0) / maxCount);
      return { name: loc.name || "Remote", count: loc.count || 0, r: Math.round(minR + (maxR - minR) * t), color: palette.fill, ink: palette.ink };
    });
    result = pack(items, w, h);
    if (!result.skipped.length) break;
  }
  return result.placed;
}
