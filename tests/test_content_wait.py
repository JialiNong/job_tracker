"""Wait-for-posting handshake used by Fetch details / Log Job / Run AI."""
from __future__ import annotations

import unittest
from unittest.mock import patch


from scrapers.content_wait import (  # noqa: E402
    locator_has_text,
    wait_for_job_content,
)


class FakeLocator:
    def __init__(self, count: int = 0, text: str = "", visible: bool = True):
        self._count = count
        self._text = text
        self._visible = visible

    @property
    def first(self):
        return self

    def count(self):
        return self._count

    def is_visible(self):
        return self._visible

    def inner_text(self, timeout=0):
        return self._text


class FakePage:
    def __init__(self, tree=None, closed=False):
        self.tree = tree or {}
        self._closed = closed

    def is_closed(self):
        return self._closed

    def locator(self, sel):
        return self.tree.get(sel, FakeLocator())


class LocatorHasTextTests(unittest.TestCase):
    def test_visible_text_counts(self):
        page = FakePage({
            "h1": FakeLocator(1, "Frontend Engineer"),
        })
        self.assertTrue(locator_has_text(page, ("h1",), min_chars=8))

    def test_missing_or_short_is_false(self):
        page = FakePage({"h1": FakeLocator(1, "x")})
        self.assertFalse(locator_has_text(page, ("h1",), min_chars=8))
        self.assertFalse(locator_has_text(page, ("h2",), min_chars=1))


class WaitForJobContentTests(unittest.TestCase):
    def test_ready_after_settle_does_not_notify(self):
        waits, readies = [], []
        result = wait_for_job_content(
            FakePage(),
            lambda: True,
            site="LinkedIn",
            settle_sec=0,
            timeout_sec=1,
            notify_after_sec=0,
            poll_sec=0,
            sleep_fn=lambda _s: None,
            notify_wait=waits.append,
            notify_ready=readies.append,
        )
        self.assertEqual(result, "ready")
        self.assertEqual(waits, [])
        self.assertEqual(readies, [])

    def test_notifies_when_content_appears_after_prompt(self):
        calls = {"n": 0}

        def is_ready():
            calls["n"] += 1
            return calls["n"] >= 3

        waits, readies = [], []
        result = wait_for_job_content(
            FakePage(),
            is_ready,
            site="Indeed",
            settle_sec=0,
            timeout_sec=2,
            notify_after_sec=0,
            poll_sec=0,
            sleep_fn=lambda _s: None,
            notify_wait=waits.append,
            notify_ready=readies.append,
        )
        self.assertEqual(result, "clicked")
        self.assertEqual(waits, ["Indeed"])
        self.assertEqual(readies, ["Indeed"])

    def test_timeout_after_prompt(self):
        waits, readies = [], []
        result = wait_for_job_content(
            FakePage(),
            lambda: False,
            site="Glassdoor",
            settle_sec=0,
            timeout_sec=0,
            notify_after_sec=0,
            poll_sec=0,
            sleep_fn=lambda _s: None,
            notify_wait=waits.append,
            notify_ready=readies.append,
        )
        self.assertEqual(result, "timeout")
        self.assertEqual(readies, [])

    def test_telegram_copy_mentions_click(self):
        with patch("scrapers.content_wait.send_telegram_message", return_value=True) as send:
            from scrapers.content_wait import notify_waiting_for_click, notify_click_succeeded
            notify_waiting_for_click("Glassdoor")
            notify_click_succeeded("Glassdoor")
        texts = [call.args[0] for call in send.call_args_list]
        self.assertTrue(any("waiting on Glassdoor" in t for t in texts))
        self.assertTrue(any("Your click on Glassdoor worked" in t for t in texts))


if __name__ == "__main__":
    unittest.main()
