"""scripts/tools/scrape_job_page.py: the JSON contract the Next.js Fetch details reads."""
from __future__ import annotations

import importlib.util
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "tools" / "scrape_job_page.py"
spec = importlib.util.spec_from_file_location("scrape_job_page_cli", SCRIPT)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def run(argv, scrape=None):
    out, err = io.StringIO(), io.StringIO()
    with patch.object(cli.sys, "argv", ["scrape_job_page.py", *argv]), redirect_stdout(out), redirect_stderr(err):
        if scrape:
            with patch.object(cli, "scrape", scrape):
                code = cli.main()
        else:
            code = cli.main()
    return code, out.getvalue(), err.getvalue()


class ScrapeJobPageCliTest(unittest.TestCase):
    def test_success_prints_one_json_line_and_sends_noise_to_stderr(self):
        def fake(url):
            print("  🌐 Generic career page — scraper noise")
            return {"ok": True, "job": {"title": "Engineer", "description": "JD", "link": url}}

        code, out, err = run(["https://jobs.example.com/1"], fake)
        self.assertEqual(code, 0)
        self.assertEqual(len(out.strip().splitlines()), 1)
        self.assertEqual(json.loads(out)["job"]["title"], "Engineer")
        self.assertIn("scraper noise", err)

    def test_failure_is_json_with_exit_1(self):
        code, out, _ = run(["https://jobs.example.com/1"], lambda url: {"ok": False, "error": "Scraping failed"})
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out), {"ok": False, "error": "Scraping failed"})

    def test_crash_still_answers_json(self):
        def boom(url):
            raise RuntimeError("Chrome went away")

        code, out, _ = run(["https://jobs.example.com/1"], boom)
        self.assertEqual(code, 1)
        self.assertIn("Chrome went away", json.loads(out)["error"])

    def test_rejects_non_http_argument(self):
        code, out, _ = run(["javascript:alert(1)"])
        self.assertEqual(code, 1)
        self.assertFalse(json.loads(out)["ok"])


if __name__ == "__main__":
    unittest.main()
