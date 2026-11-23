"""Every page loads styled, without uncaught JavaScript errors."""
from __future__ import annotations

from harness import E2ECase, TIMEOUT_ID, UNMATCHED_ID


class PagesE2E(E2ECase):
    def test_all_pages_load_styled_without_js_errors(self):
        for path, marker in (
            ("/", "#jobGrid .card"),
            ("/unmatched", f"#card-{UNMATCHED_ID}"),
            ("/timeouts", f".card[data-id='{TIMEOUT_ID}']"),
            ("/manual-apply", "#urlBox"),
        ):
            with self.subTest(path=path):
                self.page.goto(self.base + path)
                self.page.locator(marker).first.wait_for(state="attached")
                self.page.wait_for_load_state("networkidle")
                self.assert_page_styled(self.page, path)
