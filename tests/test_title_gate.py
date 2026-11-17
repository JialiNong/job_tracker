"""Pre-click title gate: blacklist → auto-pass keywords → AI title check."""
from __future__ import annotations

import unittest
from unittest.mock import patch


from core import title_gate as su


class TitleGateTests(unittest.TestCase):
    def test_software_engineer_is_not_auto_passed(self):
        with patch.object(su, "is_title_relevant_by_ai", return_value=False) as ai:
            skip, _ = su.should_skip_title_before_click(
                "Qt/QML Simulation HMI Software Engineer (d/m/f)"
            )
        ai.assert_called_once()
        self.assertTrue(skip)

    def test_frontend_and_fullstack_auto_pass(self):
        with patch.object(su, "is_title_relevant_by_ai") as ai:
            for title in ("Senior Frontend Engineer", "Full Stack Engineer (m/w/d)",
                          "Fullstack Engineer", "Product Engineer"):
                skip, reason = su.should_skip_title_before_click(title)
                self.assertFalse(skip, title)
                self.assertIn("AUTO_PASS", reason)
        ai.assert_not_called()

    def test_forward_deployed_engineer_is_no_longer_blacklisted(self):
        title = "Forward Deployed Engineer (TypeScript)"
        self.assertFalse(su.is_title_excluded(title))
        with patch.object(su, "is_title_relevant_by_ai") as ai:
            skip, _ = su.should_skip_title_before_click(title)
        ai.assert_not_called()
        self.assertFalse(skip)

    def test_blacklist_still_wins(self):
        skip, reason = su.should_skip_title_before_click("Lead Frontend Engineer")
        self.assertTrue(skip)
        self.assertIn("excluded", reason)


if __name__ == "__main__":
    unittest.main()
