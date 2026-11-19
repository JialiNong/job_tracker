/**
 * Stacks tab: which frameworks, databases, deployment platforms and
 * monitoring tools each applied job's JD names, and how often each group
 * ended in a rejection. Port of src/web/stacks.py (same regexes, Python
 * word boundaries via pyRegex); checked against Python answers.
 */
import { now as clockNow } from "./clock.js";
import { pyRegex } from "./pyregex.js";
import { resolveAppliedAt, type TrackerJob } from "./status.js";

/** A JD older than this has had time to get an answer ("settled"). */
export const SETTLED_AFTER_DAYS = 30;

type Table = [key: string, label: string, pattern: string, ignoreCase: boolean][];

const FRONTEND: Table = [
  ["react", "React", "\\bReact(?:\\.?js)?\\b(?!\\s*Native)", true],
  ["vue", "Vue", "\\bVue(?:\\.?js)?\\b", true],
  ["angular", "Angular", "\\bAngular(?:JS|\\.js)?\\b", true],
  ["next", "Next.js", "\\bNext(?:\\.js|JS)\\b", true],
  ["nuxt", "Nuxt", "\\bNuxt(?:\\.?js)?\\b", true],
];
const NODE: Table = [
  ["node", "Node.js", "\\bNode(?:\\.js|JS)?\\b", false],
  ["next", "Next.js", "\\bNext(?:\\.js|JS)\\b", true],
  ["nest", "NestJS", "\\bNest(?:\\.js|JS)\\b", true],
  ["nuxt", "Nuxt", "\\bNuxt(?:\\.?js)?\\b", true],
  ["express", "Express", "\\bExpress(?:\\.js|JS)?\\b", false],
  ["trpc", "tRPC", "\\btRPC\\b", true],
  ["fastify", "Fastify", "\\bFastify\\b", true],
  ["koa", "Koa", "\\bKoa(?:\\.js)?\\b", false],
  ["sveltekit", "SvelteKit", "\\bSvelteKit\\b", true],
  ["remix", "Remix", "\\bRemix\\b", false],
  ["hono", "Hono", "\\bHono\\b", false],
];
const NON_NODE: Table = [
  ["spring", "Spring / Spring Boot", "\\bSpring(?:\\s?Boot|\\sFramework|\\sCloud)?\\b", false],
  ["fastapi", "FastAPI", "\\bFastAPI\\b", true],
  ["django", "Django", "\\bDjango\\b", true],
  ["laravel", "Laravel", "\\bLaravel\\b", true],
  ["dotnet", ".NET / ASP.NET", "ASP\\.NET|\\.NET\\b|\\bdotnet\\b|\\bC#", false],
  ["symfony", "Symfony", "\\bSymfony\\b", true],
  ["flask", "Flask", "\\bFlask\\b", true],
  ["rails", "Ruby on Rails", "\\bRuby on Rails\\b|\\bRails\\b", false],
  ["quarkus", "Quarkus", "\\bQuarkus\\b", true],
  ["ktor", "Ktor", "\\bKtor\\b", true],
];
const DATABASE: Table = [
  ["postgres", "PostgreSQL", "\\bPostgre(?:SQL|s)\\b", true],
  ["mysql", "MySQL", "\\bMySQL\\b", true],
  ["mariadb", "MariaDB", "\\bMariaDB\\b", true],
  ["mongodb", "MongoDB", "\\bMongo(?:DB)?\\b", true],
  ["redis", "Redis", "\\bRedis\\b", true],
  ["sqlite", "SQLite", "\\bSQLite\\b", true],
  ["mssql", "SQL Server", "\\b(?:MS\\s?)?SQL Server\\b|\\bMSSQL\\b|\\bT-SQL\\b", true],
  ["oracle", "Oracle DB", "\\bOracle\\s?(?:DB|Database)\\b|\\bPL/SQL\\b", true],
  ["dynamodb", "DynamoDB", "\\bDynamoDB\\b", true],
  ["elasticsearch", "Elasticsearch / OpenSearch", "\\b(?:Elasticsearch|OpenSearch)\\b", true],
  ["cassandra", "Cassandra", "\\bCassandra\\b", false],
  ["firebase", "Firebase / Firestore", "\\bFire(?:base|store)\\b", true],
  ["supabase", "Supabase", "\\bSupabase\\b", true],
  ["bigquery", "BigQuery", "\\bBigQuery\\b", true],
  ["clickhouse", "ClickHouse", "\\bClickHouse\\b", true],
  ["neo4j", "Neo4j", "\\bNeo4j\\b", true],
];
const DEPLOY: Table = [
  ["aws", "AWS", "\\bAWS\\b|\\bAmazon Web Services\\b", false],
  ["gcp", "Google Cloud", "\\bGCP\\b|\\bGoogle Cloud(?: Platform)?\\b", false],
  ["azure", "Azure", "\\bAzure\\b", false],
  ["vercel", "Vercel", "\\bVercel\\b", true],
  ["netlify", "Netlify", "\\bNetlify\\b", true],
  ["heroku", "Heroku", "\\bHeroku\\b", true],
  ["cloudflare", "Cloudflare", "\\bCloudflare\\b", true],
  ["digitalocean", "DigitalOcean", "\\bDigital\\s?Ocean\\b", true],
  ["flyio", "Fly.io", "\\bFly\\.io\\b", true],
  ["render", "Render", "\\bRender\\.com\\b", true],
  ["railway", "Railway", "\\bRailway\\.app\\b", true],
  ["hetzner", "Hetzner", "\\bHetzner\\b", true],
  ["ovh", "OVHcloud", "\\bOVH(?:cloud)?\\b", true],
  ["kubernetes", "Kubernetes", "\\bKubernetes\\b|\\bK8s\\b|\\bEKS\\b|\\bGKE\\b|\\bAKS\\b", false],
  ["docker", "Docker", "\\bDocker\\b", true],
];
const MONITORING: Table = [
  ["datadog", "Datadog", "\\bDatadog\\b", true],
  ["sentry", "Sentry", "\\bSentry\\b", false],
  ["grafana", "Grafana", "\\bGrafana\\b", true],
  ["prometheus", "Prometheus", "\\bPrometheus\\b", false],
  ["newrelic", "New Relic", "\\bNew\\s?Relic\\b", true],
  ["opentelemetry", "OpenTelemetry", "\\bOpenTelemetry\\b|\\bOTel\\b", true],
  ["elk", "ELK / Kibana", "\\bELK\\b|\\bKibana\\b|\\bElastic Stack\\b", false],
  ["splunk", "Splunk", "\\bSplunk\\b", true],
  ["dynatrace", "Dynatrace", "\\bDynatrace\\b", true],
  ["cloudwatch", "CloudWatch", "\\bCloudWatch\\b", true],
  ["pagerduty", "PagerDuty", "\\bPagerDuty\\b", true],
  ["honeycomb", "Honeycomb", "\\bHoneycomb\\b", false],
];
const TOOL_GROUPS = { database: DATABASE, deploy: DEPLOY, monitoring: MONITORING } as const;
type ToolGroup = keyof typeof TOOL_GROUPS;

const FRONTEND_BUCKETS = ["react", "vue", "angular", "multi", "none"];
const BACKEND_BUCKETS = ["node", "non_node", "both", "none"];

const compile = (table: Table) => table.map(([key, , pattern, ic]) => [key, pyRegex(pattern, ic)] as const);
const FRONTEND_RE = compile(FRONTEND);
const NODE_RE = compile(NODE);
const NON_NODE_RE = compile(NON_NODE);
const TOOL_RE = Object.fromEntries(Object.entries(TOOL_GROUPS).map(([g, t]) => [g, compile(t)])) as
  Record<ToolGroup, ReturnType<typeof compile>>;

const mentions = (text: string, compiled: ReturnType<typeof compile>) =>
  new Set(compiled.filter(([, rx]) => rx.test(text)).map(([key]) => key));

/** One bucket per JD. Next.js counts as React, Nuxt as Vue. */
export function frontendBucket(found: Set<string>): string {
  const named = [
    found.has("react") || found.has("next") ? "react" : "",
    found.has("vue") || found.has("nuxt") ? "vue" : "",
    found.has("angular") ? "angular" : "",
  ].filter(Boolean);
  if (!named.length) return "none";
  return named.length === 1 ? named[0]! : "multi";
}

export function backendBucket(node: Set<string>, nonNode: Set<string>): string {
  if (node.size && nonNode.size) return "both";
  if (node.size) return "node";
  if (nonNode.size) return "non_node";
  return "none";
}

export interface StackJob extends TrackerJob {
  title?: string | null;
  description?: string | null;
}

const isRejected = (job: StackJob) =>
  job.status === "rejected" || (job.application_timeline ?? []).some((e) => e?.step === "rejected");

interface Row {
  fe: string;
  be: string;
  node: string[];
  non_node: string[];
  tools: Record<ToolGroup, string[]>;
  rejected: number;
  settled: boolean;
}

type Counts = Map<string, { applied: number; rejected: number }>;
const empty = (keys: string[]): Counts => new Map(keys.map((k) => [k, { applied: 0, rejected: 0 }]));
const keysOf = (table: Table) => table.map(([k]) => k);
const labelOf = (table: Table, key: string) => table.find(([k]) => k === key)?.[1] ?? key;

function summary(rows: Row[]) {
  const fe = empty(FRONTEND_BUCKETS);
  const be = empty(BACKEND_BUCKETS);
  const node = empty(keysOf(NODE));
  const nonNode = empty(keysOf(NON_NODE));
  const tools = Object.fromEntries(Object.entries(TOOL_GROUPS).map(([g, t]) => [g, empty([...keysOf(t), "none"])])) as
    Record<ToolGroup, Counts>;
  let rejected = 0;
  const count = (table: Counts, key: string, rej: number) => {
    const c = table.get(key)!;
    c.applied += 1;
    c.rejected += rej;
  };
  for (const row of rows) {
    rejected += row.rejected;
    count(fe, row.fe, row.rejected);
    count(be, row.be, row.rejected);
    row.node.forEach((k) => count(node, k, row.rejected));
    row.non_node.forEach((k) => count(nonNode, k, row.rejected));
    for (const g of Object.keys(TOOL_GROUPS) as ToolGroup[]) {
      (row.tools[g].length ? row.tools[g] : ["none"]).forEach((k) => count(tools[g], k, row.rejected));
    }
  }
  // Named rows by volume (stable: ties keep table order), empty rows dropped
  const byVolume = (table: Counts, labels: Table) => [...table]
    .filter(([k]) => k !== "none")
    .sort((a, b) => b[1].applied - a[1].applied)
    .filter(([, v]) => v.applied > 0)
    .map(([key, v]) => ({ key, label: labelOf(labels, key), ...v }));
  const toolRows = (g: ToolGroup) => [...byVolume(tools[g], TOOL_GROUPS[g]), { key: "none", ...tools[g].get("none")! }];

  return {
    applied: rows.length,
    rejected,
    frontend: FRONTEND_BUCKETS.map((key) => ({ key, ...fe.get(key)! })),
    backend: BACKEND_BUCKETS.map((key) => ({ key, ...be.get(key)! })),
    node: byVolume(node, NODE),
    non_node: byVolume(nonNode, NON_NODE),
    database: toolRows("database"),
    deploy: toolRows("deploy"),
    monitoring: toolRows("monitoring"),
  };
}

/** Counts for every application and for settled ones (applied 30+ days ago). */
export function buildStackStats(jobs: StackJob[], now: Date = clockNow()) {
  const cutoff = now.getTime() - SETTLED_AFTER_DAYS * 86_400_000;
  const rows: Row[] = jobs.map((job) => {
    const text = `${job.title ?? ""}\n${job.description ?? ""}`;
    const node = mentions(text, NODE_RE);
    const nonNode = mentions(text, NON_NODE_RE);
    const applied = resolveAppliedAt(job);
    return {
      fe: frontendBucket(mentions(text, FRONTEND_RE)),
      be: backendBucket(node, nonNode),
      node: [...node].sort(),
      non_node: [...nonNode].sort(),
      tools: Object.fromEntries((Object.keys(TOOL_GROUPS) as ToolGroup[])
        .map((g) => [g, [...mentions(text, TOOL_RE[g])].sort()])) as Record<ToolGroup, string[]>,
      rejected: isRejected(job) ? 1 : 0,
      settled: applied !== null && applied.getTime() <= cutoff,
    };
  });
  return {
    settled_after_days: SETTLED_AFTER_DAYS,
    all: summary(rows),
    settled: summary(rows.filter((r) => r.settled)),
  };
}
