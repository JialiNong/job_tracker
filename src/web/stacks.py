"""Stack breakdown for the Tracker Stacks tab: which frameworks each applied
job's JD names, and how often each group ended in a rejection.

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

FRONTEND_BUCKETS = ("react", "vue", "angular", "multi", "none")
BACKEND_BUCKETS = ("node", "non_node", "both", "none")


def _compile(table):
    return {key: re.compile(pattern, flags) for key, (_label, pattern, flags) in table.items()}


_FRONTEND_RE = _compile(FRONTEND)
_NODE_RE = _compile(NODE)
_NON_NODE_RE = _compile(NON_NODE)


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
    rejected = 0
    for row in rows:
        rej = row["rejected"]
        rejected += rej
        for table, keys in ((fe, (row["fe"],)), (be, (row["be"],)),
                            (node, row["node"]), (non_node, row["non_node"])):
            for key in keys:
                table[key]["applied"] += 1
                table[key]["rejected"] += rej

    def drop_empty(table, labels):
        return [
            {"key": k, "label": labels[k][0], **v}
            for k, v in sorted(table.items(), key=lambda kv: -kv[1]["applied"])
            if v["applied"]
        ]

    return {
        "applied": len(rows),
        "rejected": rejected,
        "frontend": [{"key": k, **fe[k]} for k in FRONTEND_BUCKETS],
        "backend": [{"key": k, **be[k]} for k in BACKEND_BUCKETS],
        "node": drop_empty(node, NODE),
        "non_node": drop_empty(non_node, NON_NODE),
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
            "rejected": int(is_rejected(job)),
            "settled": applied_at is not None and applied_at <= cutoff,
        })
    return {
        "settled_after_days": SETTLED_AFTER_DAYS,
        "all": _summary(rows),
        "settled": _summary([r for r in rows if r["settled"]]),
    }
