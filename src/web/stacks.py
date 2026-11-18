"""Stack breakdown for the Tracker Stacks tab: which frameworks, databases,
deployment platforms and monitoring tools each applied job's JD names, and
how often each group ended in a rejection.

Pure functions (no Flask, no Mongo). A JD is matched on title + description
with word-boundary regexes; a JD that lists several frameworks counts once in
every framework row, but only once in the frontend / backend buckets.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from core.db_mongo import resolve_applied_at

# A rejection needs time to arrive: "settled" applications are at least this
# old, so recent ones still waiting for a reply do not pull the rate down.
SETTLED_AFTER_DAYS = 30

_I = re.IGNORECASE

# key -> (label, pattern, flags). Case-sensitive patterns are words that are
# also plain English ("Spring", "Express", "Remix").
FRONTEND = {
    "react": ("React", r"\bReact(?:\.?js)?\b(?!\s*Native)", _I),
    "vue": ("Vue", r"\bVue(?:\.?js)?\b", _I),
    "angular": ("Angular", r"\bAngular(?:JS|\.js)?\b", _I),
    "next": ("Next.js", r"\bNext(?:\.js|JS)\b", _I),
    "nuxt": ("Nuxt", r"\bNuxt(?:\.?js)?\b", _I),
}

# Node.js runtime, Node backend frameworks, and full-stack frameworks that run on Node
NODE = {
    "node": ("Node.js", r"\bNode(?:\.js|JS)?\b", 0),
    "next": ("Next.js", r"\bNext(?:\.js|JS)\b", _I),
    "nest": ("NestJS", r"\bNest(?:\.js|JS)\b", _I),
    "nuxt": ("Nuxt", r"\bNuxt(?:\.?js)?\b", _I),
    "express": ("Express", r"\bExpress(?:\.js|JS)?\b", 0),
    "trpc": ("tRPC", r"\btRPC\b", _I),
    "fastify": ("Fastify", r"\bFastify\b", _I),
    "koa": ("Koa", r"\bKoa(?:\.js)?\b", 0),
    "sveltekit": ("SvelteKit", r"\bSvelteKit\b", _I),
    "remix": ("Remix", r"\bRemix\b", 0),
    "hono": ("Hono", r"\bHono\b", 0),
}

NON_NODE = {
    "spring": ("Spring / Spring Boot", r"\bSpring(?:\s?Boot|\sFramework|\sCloud)?\b", 0),
    "fastapi": ("FastAPI", r"\bFastAPI\b", _I),
    "django": ("Django", r"\bDjango\b", _I),
    "laravel": ("Laravel", r"\bLaravel\b", _I),
    "dotnet": (".NET / ASP.NET", r"ASP\.NET|\.NET\b|\bdotnet\b|\bC#", 0),
    "symfony": ("Symfony", r"\bSymfony\b", _I),
    "flask": ("Flask", r"\bFlask\b", _I),
    "rails": ("Ruby on Rails", r"\bRuby on Rails\b|\bRails\b", 0),
    "quarkus": ("Quarkus", r"\bQuarkus\b", _I),
    "ktor": ("Ktor", r"\bKtor\b", _I),
}

# Tool panels: each named tool is its own row (a JD can name several), plus a
# "none" row for JDs that name none of them. Words that are also plain English
# or company names ("Oracle", "Render", "Railway", "Elastic") need context.
# Snowflake is left out: most JDs naming it are Snowflake's own or list it as
# a customer, and no regex tells those apart from the warehouse.
DATABASE = {
    "postgres": ("PostgreSQL", r"\bPostgre(?:SQL|s)\b", _I),
    "mysql": ("MySQL", r"\bMySQL\b", _I),
    "mariadb": ("MariaDB", r"\bMariaDB\b", _I),
    "mongodb": ("MongoDB", r"\bMongo(?:DB)?\b", _I),
    "redis": ("Redis", r"\bRedis\b", _I),
    "sqlite": ("SQLite", r"\bSQLite\b", _I),
    "mssql": ("SQL Server", r"\b(?:MS\s?)?SQL Server\b|\bMSSQL\b|\bT-SQL\b", _I),
    "oracle": ("Oracle DB", r"\bOracle\s?(?:DB|Database)\b|\bPL/SQL\b", _I),
    "dynamodb": ("DynamoDB", r"\bDynamoDB\b", _I),
    "elasticsearch": ("Elasticsearch / OpenSearch", r"\b(?:Elasticsearch|OpenSearch)\b", _I),
    "cassandra": ("Cassandra", r"\bCassandra\b", 0),
    "firebase": ("Firebase / Firestore", r"\bFire(?:base|store)\b", _I),
    "supabase": ("Supabase", r"\bSupabase\b", _I),
    "bigquery": ("BigQuery", r"\bBigQuery\b", _I),
    "clickhouse": ("ClickHouse", r"\bClickHouse\b", _I),
    "neo4j": ("Neo4j", r"\bNeo4j\b", _I),
}

DEPLOY = {
    "aws": ("AWS", r"\bAWS\b|\bAmazon Web Services\b", 0),
    "gcp": ("Google Cloud", r"\bGCP\b|\bGoogle Cloud(?: Platform)?\b", 0),
    "azure": ("Azure", r"\bAzure\b", 0),
    "vercel": ("Vercel", r"\bVercel\b", _I),
    "netlify": ("Netlify", r"\bNetlify\b", _I),
    "heroku": ("Heroku", r"\bHeroku\b", _I),
    "cloudflare": ("Cloudflare", r"\bCloudflare\b", _I),
    "digitalocean": ("DigitalOcean", r"\bDigital\s?Ocean\b", _I),
    "flyio": ("Fly.io", r"\bFly\.io\b", _I),
    "render": ("Render", r"\bRender\.com\b", _I),
    "railway": ("Railway", r"\bRailway\.app\b", _I),
    "hetzner": ("Hetzner", r"\bHetzner\b", _I),
    "ovh": ("OVHcloud", r"\bOVH(?:cloud)?\b", _I),
    "kubernetes": ("Kubernetes", r"\bKubernetes\b|\bK8s\b|\bEKS\b|\bGKE\b|\bAKS\b", 0),
    "docker": ("Docker", r"\bDocker\b", _I),
}

MONITORING = {
    "datadog": ("Datadog", r"\bDatadog\b", _I),
    "sentry": ("Sentry", r"\bSentry\b", 0),
    "grafana": ("Grafana", r"\bGrafana\b", _I),
    "prometheus": ("Prometheus", r"\bPrometheus\b", 0),
    "newrelic": ("New Relic", r"\bNew\s?Relic\b", _I),
    "opentelemetry": ("OpenTelemetry", r"\bOpenTelemetry\b|\bOTel\b", _I),
    "elk": ("ELK / Kibana", r"\bELK\b|\bKibana\b|\bElastic Stack\b", 0),
    "splunk": ("Splunk", r"\bSplunk\b", _I),
    "dynatrace": ("Dynatrace", r"\bDynatrace\b", _I),
    "cloudwatch": ("CloudWatch", r"\bCloudWatch\b", _I),
    "pagerduty": ("PagerDuty", r"\bPagerDuty\b", _I),
    "honeycomb": ("Honeycomb", r"\bHoneycomb\b", 0),
}

# Response key -> table, in panel order
TOOL_GROUPS = {"database": DATABASE, "deploy": DEPLOY, "monitoring": MONITORING}

FRONTEND_BUCKETS = ("react", "vue", "angular", "multi", "none")
BACKEND_BUCKETS = ("node", "non_node", "both", "none")


def _compile(table):
    return {key: re.compile(pattern, flags) for key, (_label, pattern, flags) in table.items()}


_FRONTEND_RE = _compile(FRONTEND)
_NODE_RE = _compile(NODE)
_NON_NODE_RE = _compile(NON_NODE)
_TOOL_RE = {group: _compile(table) for group, table in TOOL_GROUPS.items()}


def job_text(job) -> str:
    return f"{job.get('title') or ''}\n{job.get('description') or ''}"


def mentions(text: str, compiled) -> set[str]:
    return {key for key, rx in compiled.items() if rx.search(text)}


def frontend_bucket(found: set[str]) -> str:
    """One bucket per JD. Next.js counts as React, Nuxt as Vue."""
    families = {
        "react": bool(found & {"react", "next"}),
        "vue": bool(found & {"vue", "nuxt"}),
        "angular": "angular" in found,
    }
    named = [k for k, on in families.items() if on]
    if not named:
        return "none"
    return named[0] if len(named) == 1 else "multi"


def backend_bucket(node: set[str], non_node: set[str]) -> str:
    if node and non_node:
        return "both"
    if node:
        return "node"
    if non_node:
        return "non_node"
    return "none"


def is_rejected(job) -> bool:
    if job.get("status") == "rejected":
        return True
    timeline = job.get("application_timeline")
    return isinstance(timeline, list) and any(
        isinstance(step, dict) and step.get("step") == "rejected" for step in timeline
    )


def _empty(keys):
    return {key: {"applied": 0, "rejected": 0} for key in keys}


def _summary(rows):
    fe = _empty(FRONTEND_BUCKETS)
    be = _empty(BACKEND_BUCKETS)
    node = _empty(NODE)
    non_node = _empty(NON_NODE)
    tools = {group: _empty([*table, "none"]) for group, table in TOOL_GROUPS.items()}
    rejected = 0
    for row in rows:
        rej = row["rejected"]
        rejected += rej
        for table, keys in ((fe, (row["fe"],)), (be, (row["be"],)),
                            (node, row["node"]), (non_node, row["non_node"])):
            for key in keys:
                table[key]["applied"] += 1
                table[key]["rejected"] += rej
        for group, table in tools.items():
            for key in row[group] or ("none",):
                table[key]["applied"] += 1
                table[key]["rejected"] += rej

    def drop_empty(table, labels):
        return [
            {"key": k, "label": labels[k][0], **v}
            for k, v in sorted(table.items(), key=lambda kv: -kv[1]["applied"])
            if v["applied"]
        ]

    def tool_rows(group):
        # Named tools by volume, then the "none named" row last (always shown)
        table = tools[group]
        none = table.pop("none")
        return drop_empty(table, TOOL_GROUPS[group]) + [{"key": "none", **none}]

    return {
        "applied": len(rows),
        "rejected": rejected,
        "frontend": [{"key": k, **fe[k]} for k in FRONTEND_BUCKETS],
        "backend": [{"key": k, **be[k]} for k in BACKEND_BUCKETS],
        "node": drop_empty(node, NODE),
        "non_node": drop_empty(non_node, NON_NODE),
        **{group: tool_rows(group) for group in TOOL_GROUPS},
    }


def build_stack_stats(jobs, now: datetime | None = None) -> dict:
    """Counts for every application and for settled ones (applied 30+ days ago)."""
    now = now or datetime.now()
    cutoff = now - timedelta(days=SETTLED_AFTER_DAYS)
    rows = []
    for job in jobs:
        text = job_text(job)
        node = mentions(text, _NODE_RE)
        non_node = mentions(text, _NON_NODE_RE)
        applied_at = resolve_applied_at(job)
        if applied_at is not None and applied_at.tzinfo is not None:
            applied_at = applied_at.replace(tzinfo=None)
        rows.append({
            "fe": frontend_bucket(mentions(text, _FRONTEND_RE)),
            "be": backend_bucket(node, non_node),
            "node": sorted(node),
            "non_node": sorted(non_node),
            **{group: sorted(mentions(text, rx)) for group, rx in _TOOL_RE.items()},
            "rejected": int(is_rejected(job)),
            "settled": applied_at is not None and applied_at <= cutoff,
        })
    return {
        "settled_after_days": SETTLED_AFTER_DAYS,
        "all": _summary(rows),
        "settled": _summary([r for r in rows if r["settled"]]),
    }
