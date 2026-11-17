"""Only http(s) job links are stored: they render as clickable hrefs."""
import unittest
from unittest import mock

from core import agent_push
from core.job_url import is_http_url


class HttpOnlyJobUrlTests(unittest.TestCase):
    def test_is_http_url(self):
        assert is_http_url("https://boards.greenhouse.io/acme/jobs/1")
        assert is_http_url("http://example.com/job")
        # Pasted without a scheme: normalized to https://
        assert is_http_url("de.indeed.com/viewjob?jk=abc123")
        assert not is_http_url("javascript://%0Aalert(1)")
        assert not is_http_url("JAVASCRIPT://x%0Aalert(1)")
        assert not is_http_url("ftp://example.com/job")
        assert not is_http_url("")

    def test_agent_push_rejects_javascript_link(self):
        with mock.patch.object(agent_push, "lookup_known_job") as lookup, \
                mock.patch.object(agent_push, "save_link_only_urls") as save:
            result = agent_push.log_agent_jobs(
                [{"url": "javascript://%0Aalert(document.domain)"}]
            )
        # URL cleanup trims the trailing ")", so only count the rejection
        assert len(result["failed"]) == 1
        assert result["failed"][0].startswith("javascript://")
        assert result["ok"] == []
        lookup.assert_not_called()
        save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
