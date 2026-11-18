"""Stacks tab aggregation (web.stacks). Does not touch a live MongoDB."""
from __future__ import annotations

import unittest
from datetime import datetime

from web.stacks import (
    NODE,
    NON_NODE,
    _FRONTEND_RE,
    _TOOL_RE,
    _NODE_RE,
    _NON_NODE_RE,
    backend_bucket,
    build_stack_stats,
    frontend_bucket,
    is_rejected,
    mentions,
)

NOW = datetime(2026, 11, 17, 12, 0)
OLD = datetime(2026, 9, 20, 10, 0)
RECENT = datetime(2026, 11, 10, 10, 0)


def _job(description, title="Engineer", status="applied", applied_at=OLD, timeline=None):
    return {
        "title": title,
        "description": description,
        "status": status,
        "applied_at": applied_at,
        "application_timeline": timeline or [],
    }


class MentionTests(unittest.TestCase):
    def test_react_native_is_not_react(self):
        self.assertEqual(mentions("We build in React Native", _FRONTEND_RE), set())
        self.assertEqual(mentions("React.js and React Native", _FRONTEND_RE), {"react"})

    def test_plain_english_words_do_not_match(self):
        text = "Start this spring, express your ideas, remix the plan, node graph"
        self.assertEqual(mentions(text, _NODE_RE), set())
        self.assertEqual(mentions(text, _NON_NODE_RE), set())

    def test_framework_spellings(self):
        text = "Node.js with NestJS, Spring Boot, ASP.NET Core and Ruby on Rails"
        self.assertEqual(mentions(text, _NODE_RE), {"node", "nest"})
        self.assertEqual(mentions(text, _NON_NODE_RE), {"spring", "dotnet", "rails"})


class ToolMentionTests(unittest.TestCase):
    def test_database_spellings(self):
        text = "Postgres or MySQL, MongoDB, Redis cache, MS SQL Server and Oracle Database"
        self.assertEqual(mentions(text, _TOOL_RE["database"]),
                         {"postgres", "mysql", "mongodb", "redis", "mssql", "oracle"})

    def test_company_and_english_words_do_not_match(self):
        text = "Oracle customers, render the UI, by railway, elastic teams, a sentry post"
        for group in ("database", "deploy", "monitoring"):
            self.assertEqual(mentions(text, _TOOL_RE[group]), set(), group)

    def test_deploy_and_monitoring(self):
        text = "Deploy to AWS (EKS) and Vercel via Docker; Datadog, Sentry and OpenTelemetry"
        self.assertEqual(mentions(text, _TOOL_RE["deploy"]), {"aws", "kubernetes", "vercel", "docker"})
        self.assertEqual(mentions(text, _TOOL_RE["monitoring"]), {"datadog", "sentry", "opentelemetry"})


class BucketTests(unittest.TestCase):
    def test_frontend_bucket(self):
        self.assertEqual(frontend_bucket({"react", "next"}), "react")
        self.assertEqual(frontend_bucket({"nuxt"}), "vue")
        self.assertEqual(frontend_bucket({"angular"}), "angular")
        self.assertEqual(frontend_bucket({"react", "vue"}), "multi")
        self.assertEqual(frontend_bucket(set()), "none")

    def test_backend_bucket(self):
        self.assertEqual(backend_bucket({"node"}, set()), "node")
        self.assertEqual(backend_bucket(set(), {"django"}), "non_node")
        self.assertEqual(backend_bucket({"express"}, {"spring"}), "both")
        self.assertEqual(backend_bucket(set(), set()), "none")

    def test_next_counts_as_node_backend(self):
        self.assertIn("next", NODE)
        self.assertNotIn("next", NON_NODE)
        self.assertEqual(mentions("Next.js app router", _NODE_RE), {"next"})

    def test_rejected_from_status_or_timeline(self):
        self.assertTrue(is_rejected({"status": "rejected"}))
        self.assertTrue(is_rejected({"status": "closed", "application_timeline": [{"step": "rejected"}]}))
        self.assertFalse(is_rejected({"status": "applied", "application_timeline": [{"step": "applied"}]}))


class BuildTests(unittest.TestCase):
    def test_counts_and_settled_split(self):
        jobs = [
            _job("React and Node.js", status="rejected"),
            _job("React or Vue, Django backend"),
            _job("Angular with Spring Boot", status="rejected", applied_at=RECENT),
            _job("Generic role"),
        ]
        out = build_stack_stats(jobs, now=NOW)
        self.assertEqual(out["settled_after_days"], 30)

        everyone = out["all"]
        self.assertEqual((everyone["applied"], everyone["rejected"]), (4, 2))
        fe = {r["key"]: (r["applied"], r["rejected"]) for r in everyone["frontend"]}
        self.assertEqual(fe, {"react": (1, 1), "vue": (0, 0), "angular": (1, 1), "multi": (1, 0), "none": (1, 0)})
        be = {r["key"]: (r["applied"], r["rejected"]) for r in everyone["backend"]}
        self.assertEqual(be, {"node": (1, 1), "non_node": (2, 1), "both": (0, 0), "none": (1, 0)})
        non_node = {r["key"]: r["applied"] for r in everyone["non_node"]}
        self.assertEqual(non_node, {"django": 1, "spring": 1})
        self.assertEqual(everyone["node"][0]["label"], "Node.js")

        settled = out["settled"]
        self.assertEqual((settled["applied"], settled["rejected"]), (3, 1))

    def test_framework_rows_skip_zero_and_sort_by_volume(self):
        jobs = [_job("NestJS"), _job("NestJS and Express"), _job("Express, NestJS")]
        rows = build_stack_stats(jobs, now=NOW)["all"]["node"]
        self.assertEqual([r["key"] for r in rows], ["nest", "express"])

    def test_tool_rows_end_with_none(self):
        jobs = [
            _job("PostgreSQL on AWS", status="rejected"),
            _job("PostgreSQL and Redis"),
            _job("No tools here"),
        ]
        out = build_stack_stats(jobs, now=NOW)["all"]
        db = [(r["key"], r["applied"], r["rejected"]) for r in out["database"]]
        self.assertEqual(db, [("postgres", 2, 1), ("redis", 1, 0), ("none", 1, 0)])
        self.assertEqual(out["database"][0]["label"], "PostgreSQL")
        deploy = [(r["key"], r["applied"]) for r in out["deploy"]]
        self.assertEqual(deploy, [("aws", 1), ("none", 2)])
        # "none" row is kept even when every JD names a tool
        self.assertEqual(build_stack_stats([_job("Datadog")], now=NOW)["all"]["monitoring"][-1],
                         {"key": "none", "applied": 0, "rejected": 0})


if __name__ == "__main__":
    unittest.main()
