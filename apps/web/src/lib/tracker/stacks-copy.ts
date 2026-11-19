/**
 * Stacks tab copy. Bilingual on purpose (user request): English is the
 * default, and the EN / 中文 toggle is remembered per browser. Framework
 * names stay as written. Moved unchanged from static/js/tracker/stacks.js.
 */
export const SMALL_SAMPLE = 10;

export type Lang = "en" | "zh";

export interface GroupCopy {
  title: string;
  sub: string;
  /** row key -> [label, hint]; rows without an entry use the server's label */
  rows?: Record<string, [string, string]>;
}

export interface StacksCopy {
  loading: string;
  failed: string;
  updated: (when: string) => string;
  recompute: string;
  recomputing: string;
  recomputeTip: string;
  totals: { applications: string; rejected: string; overall: string; overallBefore: string };
  rangeAll: string;
  rangeSettled: (days: number) => string;
  intro: (days: number) => string;
  keyRate: string;
  keySmall: string;
  keyBase: string;
  colGroup: string;
  colShare: string;
  colRate: string;
  jobs: (n: number) => string;
  rowTip: (name: string, applied: number, rejected: number, pct: number, base: number) => string;
  groups: Record<string, GroupCopy>;
  foot: string;
}

export const COPY: Record<Lang, StacksCopy> = {
  en: {
    loading: 'Loading…',
    failed: 'Could not load the stack breakdown. Press Refresh to try again.',
    updated: (when) => `Updated ${when}`,
    recompute: 'Recompute',
    recomputing: 'Recomputing…',
    recomputeTip: 'Numbers refresh every night. Recompute now to include today’s changes (reads every JD, takes a while).',
    totals: { applications: 'applications', rejected: 'rejected', overall: 'rejected overall', overallBefore: '' },
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
    totals: { applications: '个投递', rejected: '个被拒', overall: '', overallBefore: '整体被拒率' },
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
