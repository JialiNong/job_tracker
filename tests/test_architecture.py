"""Layering and deployment rules that are easy to break without noticing.

- core stays the bottom layer (no imports from scrapers / services / web / tg …)
- nothing edits sys.path to find src/ (pyproject.toml + editable install does)
- the Render web app imports without Playwright / OpenAI / Lingua / trafilatura
- Render runs one gunicorn worker (task state lives in process memory)
"""
from __future__ import annotations

import ast
import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

from core.paths import PROJECT_ROOT

SRC = PROJECT_ROOT / "src"

# package -> top-level packages it must never import
FORBIDDEN_IMPORTS = {
    "core": {"matching", "scrapers", "services", "sources", "tg", "web"},
    "matching": {"scrapers", "services", "web"},
    "scrapers": {"services", "web"},
    "sources": {"scrapers", "services", "web"},
    "services": {"web"},
}


def _imported_top_levels(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split(".")[0])
    return names


class LayeringTests(unittest.TestCase):
    def test_lower_layers_do_not_import_upper_layers(self):
        violations = []
        for package, forbidden in FORBIDDEN_IMPORTS.items():
            for path in sorted((SRC / package).rglob("*.py")):
                bad = _imported_top_levels(path) & forbidden
                if bad:
                    violations.append(f"{path.relative_to(PROJECT_ROOT)} imports {sorted(bad)}")
        self.assertEqual(violations, [], "\n".join(violations))

    def test_no_sys_path_hacks_for_src(self):
        offenders = []
        for folder in ("src", "scripts"):
            for path in sorted((PROJECT_ROOT / folder).rglob("*")):
                if path.suffix not in (".py", ".sh") or "__pycache__" in path.parts:
                    continue
                if "sys.path.insert" in path.read_text(encoding="utf-8"):
                    offenders.append(str(path.relative_to(PROJECT_ROOT)))
        self.assertEqual(offenders, [], "use `pip install -e .` instead of sys.path edits")


class RenderDeployTests(unittest.TestCase):
    def test_web_app_imports_without_scraper_or_ai_packages(self):
        """Render installs requirements-web.txt only (see render.yaml)."""
        code = "\n".join([
            "import sys",
            "for name in ('playwright', 'playwright.sync_api', 'openai', 'lingua', 'trafilatura'):",
            "    sys.modules[name] = None",
            "import core.db_mongo as db",
            "db.ensure_indexes = lambda: None",
            "import web.web_app",
            "import services.log_job, services.tracker_jobs",
            "from services.browser_session import playwright_available",
            "assert not playwright_available()",
            "print('ok')",
        ])
        env = {**os.environ, "MONGO_URI": "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=50"}
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True, text=True, env=env, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        self.assertIn("ok", result.stdout)

    def test_render_runs_a_single_worker(self):
        render = (PROJECT_ROOT / "render.yaml").read_text(encoding="utf-8")
        start = re.search(r"^\s*startCommand:\s*(.+)$", render, re.MULTILINE)
        self.assertIsNotNone(start, "render.yaml has no startCommand")
        self.assertRegex(start.group(1), r"--workers[ =]1\b")
        self.assertIn("web.web_app:app", start.group(1))


if __name__ == "__main__":
    unittest.main()
