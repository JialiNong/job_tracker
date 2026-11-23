"""Login / logout page interactions."""
from __future__ import annotations

from harness import E2ECase, PASSWORD, USERNAME
from playwright.sync_api import expect


class LoginE2E(E2ECase):
    def test_login_required_and_wrong_password_rejected(self):
        ctx = self.browser.new_context()
        page = ctx.new_page()
        page.goto(self.base + "/")
        self.assertIn("/login", page.url)
        page.fill("#username", USERNAME)
        page.fill("#password", "wrong")
        page.click(".btn-login")
        expect(page.get_by_text("Invalid username or password")).to_be_visible()
        page.fill("#username", USERNAME)
        page.fill("#password", PASSWORD)
        page.click(".btn-login")
        page.wait_for_url(self.base + "/")
        ctx.close()

    def test_login_page_styled_before_login(self):
        ctx = self.browser.new_context()
        page = ctx.new_page()
        page.goto(self.base + "/login")
        page.wait_for_load_state("networkidle")
        self.assert_page_styled(page, "/login")
        ctx.close()

    def test_logout_returns_to_login(self):
        self.page.goto(self.base + "/")
        self.page.locator(".side-logout").click()
        self.page.wait_for_url("**/login")
        self.page.goto(self.base + "/")
        self.assertIn("/login", self.page.url)
