"""core.clock: pinned time for contract / e2e runs, real time otherwise."""
from __future__ import annotations

import os
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest import mock

from core import clock

PINNED = {"TRACKER_ALLOW_FIXED_NOW": "1", "TRACKER_FIXED_NOW": "2026-11-13T12:00"}


class ClockTests(unittest.TestCase):
    def test_real_time_when_not_pinned(self):
        with mock.patch.dict(os.environ, {"TRACKER_FIXED_NOW": "", "TRACKER_ALLOW_FIXED_NOW": ""}):
            self.assertLess(abs(clock.now() - datetime.now()), timedelta(seconds=2))
            utc = datetime.now(timezone.utc).replace(tzinfo=None)
            self.assertLess(abs(clock.utcnow() - utc), timedelta(seconds=2))

    def test_pinned_local_and_today(self):
        with mock.patch.dict(os.environ, PINNED):
            self.assertEqual(clock.now(), datetime(2026, 11, 13, 12, 0))
            self.assertIsNone(clock.now().tzinfo)
            self.assertEqual(clock.today(), date(2026, 11, 13))

    def test_pinned_utc_moves_with_local(self):
        with mock.patch.dict(os.environ, PINNED):
            aware = clock.now(timezone.utc)
            self.assertEqual(aware.tzinfo, timezone.utc)
            self.assertEqual(clock.utcnow(), aware.replace(tzinfo=None))

    def test_fixed_now_ignored_without_allow_flag(self):
        env = {"TRACKER_FIXED_NOW": "2001-01-01T00:00", "TRACKER_ALLOW_FIXED_NOW": ""}
        with mock.patch.dict(os.environ, env):
            self.assertGreater(clock.now().year, 2001)


if __name__ == "__main__":
    unittest.main()
