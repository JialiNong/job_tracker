/* Tracker Stacks tab: frameworks named in each applied job's JD, grouped into
   frontend / backend buckets, plus databases, deployment platforms and
   monitoring tools, with how many of each group were rejected.
   Data: /api/stats/stacks, served from a nightly cache (web/stacks_cache.py).
   Loaded the first time the tab opens and again after Refresh while it is
   open; Recompute (?refresh=1) rebuilds the cache from every JD.

   Copy is bilingual on purpose (user request): English is the default, and
   the EN / 中文 toggle is remembered per browser. Framework names stay as
   written. */
import { escHtml } from '../shared/html.js';

const LANG_KEY = 'tracker.stacks.lang';
const SMALL_SAMPLE = 10;

const COPY = {
  en: {
    loading: 'Loading…',
    failed: 'Could not load the stack breakdown. Press Refresh to try again.',
    updated: (when) => `Updated ${when}`,
    recompute: 'Recompute',
    recomputing: 'Recomputing…',
    recomputeTip: 'Numbers refresh every night. Recompute now to include today’s changes (reads every JD, takes a while).',
    totals: (a, r, p) => `<b>${a}</b> applications <span class="sep"></span> <b>${r}</b> rejected <span class="sep"></span> <b>${p}%</b> rejected overall`,
    rangeAll: 'All',
    rangeSettled: (d) => `Applied ${d}+ days ago`,
    intro: (d) => `Each application is grouped by the frameworks its job description names. Recent applications are often still waiting for a reply, so “Applied ${d}+ days ago” is closer to the final rejection rate.`,
    keyRate: 'Rejection rate of the group',
    keySmall: `Fewer than ${SMALL_SAMPLE} jobs, read with care`,
    keyBase: 'Overall rejection rate',
    colGroup: 'Group',
    colShare: 'Share of applications',
    colRate: 'Rejected',
    jobs: (n) => `${n} ${n === 1 ? 'job' : 'jobs'}`,
    rowTip: (name, a, r, p, base) => `${name}: ${a} applied, ${r} rejected (${p}%). Overall ${base}%.`,
    groups: {
      frontend: {
        title: 'Frontend', sub: 'which framework the JD asks for',
        rows: {
          react: ['React only', 'Next.js counts as React'],
          vue: ['Vue only', 'Nuxt counts as Vue'],
          angular: ['Angular only', ''],
          multi: ['Several to choose from', 'Two or more of React, Vue, Angular'],
          none: ['No frontend framework named', 'Backend or general roles'],
        },
      },
      backend: {
        title: 'Backend', sub: 'Node.js or something else',
        rows: {
          node: ['Node.js stack only', 'Node.js, NestJS, Express, Next.js, Nuxt…'],
          non_node: ['Non-Node framework only', 'Spring, Django, Laravel… with no Node option'],
          both: ['Node and non-Node both listed', 'Usually “X or Y”'],
          none: ['No backend framework named', ''],
        },
      },
      node: { title: 'Node.js frameworks', sub: 'a JD can name several, so rows add up to more than the total' },
      non_node: { title: 'Other backend frameworks', sub: 'small samples, compare them as a group' },
      database: {
        title: 'Databases', sub: 'a JD can name several',
        rows: { none: ['No database named', ''] },
      },
      deploy: {
        title: 'Cloud & deployment', sub: 'cloud providers, hosting platforms, containers',
        rows: { none: ['No platform named', ''] },
      },
      monitoring: {
        title: 'Monitoring & observability', sub: 'most JDs name none, so samples are small',
        rows: { none: ['No monitoring tool named', ''] },
      },
    },
    foot: 'Next.js and Nuxt count as Node.js, so frontend-only Next.js roles also land in “Node.js stack only”. This shows which stacks were rejected more often, not why: many rejections are about location, language or seniority.',
  },
  zh: {
    loading: '加载中…',
    failed: '技术栈分析加载失败，点 Refresh 重试。',
    updated: (when) => `更新于 ${when}`,
    recompute: '重新计算',
    recomputing: '计算中…',
    recomputeTip: '数据每晚自动更新。点这里立即重新计算，包含今天的改动（要读全部 JD，会慢一些）。',
    totals: (a, r, p) => `<b>${a}</b> 个投递 <span class="sep"></span> <b>${r}</b> 个被拒 <span class="sep"></span> 整体被拒率 <b>${p}%</b>`,
    rangeAll: '全部',
    rangeSettled: (d) => `投递满 ${d} 天`,
    intro: (d) => `按 JD 里写到的框架给每个投递分组。最近投的岗位很多还没回音，所以“投递满 ${d} 天”的数据更接近最终被拒率。`,
    keyRate: '本组被拒率',
    keySmall: `样本少于 ${SMALL_SAMPLE} 个，仅供参考`,
    keyBase: '整体被拒率',
    colGroup: '分组',
    colShare: '占投递',
    colRate: '被拒率',
    jobs: (n) => `${n} 个`,
    rowTip: (name, a, r, p, base) => `${name}：投了 ${a} 个，被拒 ${r} 个（${p}%）。整体 ${base}%。`,
    groups: {
      frontend: {
        title: '前端', sub: 'JD 要求哪个框架',
        rows: {
          react: ['只有 React', 'Next.js 计入 React'],
          vue: ['只有 Vue', 'Nuxt 计入 Vue'],
          angular: ['只有 Angular', ''],
          multi: ['多选', 'React、Vue、Angular 列了两个以上'],
          none: ['没写前端框架', '偏后端或通用岗位'],
        },
      },
      backend: {
        title: '后端', sub: 'Node 系还是非 Node',
        rows: {
          node: ['只要求 Node 系', 'Node.js、NestJS、Express、Next.js、Nuxt…'],
          non_node: ['只要求非 Node 框架', 'Spring、Django、Laravel…，没给 Node 选项'],
          both: ['Node 和非 Node 都列了', '通常是“X 或 Y”'],
          none: ['没写后端框架', ''],
        },
      },
      node: { title: 'Node 系框架', sub: '一个 JD 可能写多个，各行加起来会超过总数' },
      non_node: { title: '其他后端框架', sub: '样本很少，合起来看更可靠' },
      database: {
        title: '数据库', sub: '一个 JD 可能写多个',
        rows: { none: ['没写数据库', ''] },
      },
      deploy: {
        title: '云与部署平台', sub: '云厂商、托管平台、容器',
        rows: { none: ['没写部署平台', ''] },
      },
      monitoring: {
        title: '监控与可观测性', sub: '大多数 JD 不写，样本偏少',
        rows: { none: ['没写监控工具', ''] },
      },
    },
    foot: 'Next.js 和 Nuxt 算作 Node 系，所以纯前端的 Next.js 岗位也会算进“只要求 Node 系”。这里只能看出哪些技术栈被拒得多，看不出原因：很多拒信是因为地点、语言或年限。',
  },
};

let data = null;
let loading = null;
let recomputing = false;
let range = 'all';
let lang = readLang();

function readLang() {
  try { return localStorage.getItem(LANG_KEY) === 'zh' ? 'zh' : 'en'; } catch { return 'en'; }
}

function formatUpdated(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', today
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

function rowHtml(row, label, sub, maxApplied, total, base, t) {
  const p = pct(row.rejected, row.applied);
  const small = row.applied < SMALL_SAMPLE;
  const tip = t.rowTip(label, row.applied, row.rejected, p, base);
  return `<li class="stk-row" title="${escHtml(tip)}">
    <div class="stk-label"><strong>${escHtml(label)}</strong>${sub ? `<small>${escHtml(sub)}</small>` : ''}</div>
    <div class="stk-share">
      <span class="stk-share-text"><b>${escHtml(t.jobs(row.applied))}</b><span>${pct(row.applied, total)}%</span></span>
      <span class="stk-track"><i style="width:${maxApplied ? (row.applied / maxApplied) * 100 : 0}%"></i></span>
    </div>
    <div class="stk-rate" role="img" aria-label="${escHtml(tip)}">
      <span class="stk-line"></span>
      <span class="stk-base" style="left:${base}%"></span>
      <span class="stk-dot${small ? ' small' : ''}" style="left:${p}%"></span>
      <span class="stk-pct" style="left:clamp(1.2rem, ${p}%, calc(100% - 1.2rem))">${p}%</span>
    </div>
  </li>`;
}

function renderGroup(section, summary, t) {
  const key = section.dataset.group;
  const g = t.groups[key];
  const rows = summary[key] || [];
  const base = pct(summary.rejected, summary.applied);
  const maxApplied = Math.max(0, ...rows.map(r => r.applied));
  const body = rows.length
    ? rows.map(r => {
      const [label, sub] = g.rows?.[r.key] || [r.label || r.key, ''];
      return rowHtml(r, label, sub, maxApplied, summary.applied, base, t);
    }).join('')
    : '<li class="stk-empty muted">–</li>';
  section.innerHTML = `
    <h2 class="stk-title">${escHtml(g.title)} <span>${escHtml(g.sub)}</span></h2>
    <div class="stk-cols" aria-hidden="true"><span>${escHtml(t.colGroup)}</span><span>${escHtml(t.colShare)}</span>
      <span class="stk-scale"><span>${escHtml(t.colRate)} 0%</span><span>50%</span><span>100%</span></span></div>
    <ul class="stk-list">${body}</ul>`;
}

function render() {
  const root = document.getElementById('stacksView');
  if (!root) return;
  const t = COPY[lang];
  root.lang = lang === 'zh' ? 'zh' : 'en';
  root.querySelectorAll('#stacksLang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  root.querySelectorAll('#stacksRange button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === range)));

  const days = data?.settled_after_days ?? 30;
  const [allBtn, settledBtn] = root.querySelectorAll('#stacksRange button');
  allBtn.textContent = t.rangeAll;
  settledBtn.textContent = t.rangeSettled(days);
  document.getElementById('stacksIntro').textContent = t.intro(days);
  document.getElementById('stacksKey').innerHTML =
    `<span><i class="k-dot"></i>${escHtml(t.keyRate)}</span>`
    + `<span><i class="k-hollow"></i>${escHtml(t.keySmall)}</span>`
    + `<span><i class="k-base"></i>${escHtml(t.keyBase)}</span>`;
  document.getElementById('stacksFoot').textContent = t.foot;

  const when = formatUpdated(data?.computed_at);
  document.getElementById('stacksUpdated').textContent = when ? t.updated(when) : '';
  const recomputeBtn = document.getElementById('stacksRecompute');
  recomputeBtn.textContent = recomputing ? t.recomputing : t.recompute;
  recomputeBtn.title = t.recomputeTip;
  recomputeBtn.disabled = recomputing || !!loading;

  const totals = document.getElementById('stacksTotals');
  const panels = root.querySelectorAll('.stacks-panel');
  if (!data) {
    totals.innerHTML = `<span class="muted">${escHtml(loading ? t.loading : t.failed)}</span>`;
    panels.forEach(p => { p.innerHTML = ''; });
    return;
  }
  const s = data[range];
  totals.innerHTML = t.totals(s.applied, s.rejected, pct(s.rejected, s.applied));
  panels.forEach(p => renderGroup(p, s, t));
}

function bindControls() {
  const root = document.getElementById('stacksView');
  if (!root || root.dataset.bound) return;
  root.dataset.bound = '1';
  root.querySelector('#stacksRange')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    range = b.dataset.range;
    render();
  });
  root.querySelector('#stacksLang')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (!b) return;
    lang = b.dataset.lang === 'zh' ? 'zh' : 'en';
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode: keep it for this visit */ }
    render();
  });
  root.querySelector('#stacksRecompute')?.addEventListener('click', recompute);
}

function fetchStacks(url) {
  return fetch(url, { cache: 'no-store' })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); });
}

function recompute() {
  if (recomputing || loading) return;
  recomputing = true;
  render();
  // Keep the current numbers on screen if the rebuild fails
  fetchStacks('/api/stats/stacks?refresh=1')
    .then(json => { data = json; })
    .catch(() => {})
    .finally(() => { recomputing = false; render(); });
}

export function resetStackStats() {
  data = null;
}

export function loadStackStats() {
  bindControls();
  if (data) { render(); return Promise.resolve(); }
  if (loading) return loading;
  loading = fetchStacks('/api/stats/stacks')
    .then(json => { data = json; })
    .catch(() => { data = null; })
    .finally(() => { loading = null; render(); });
  render();
  return loading;
}
