"""User-pasted original job description (modal-only postings).

Does not touch a live MongoDB.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from bson import ObjectId

from core.manual_fields import (
    USER_DESCRIPTION_MAX_CHARS,
    keep_manual_description,
    known_manual_fields,
    normalize_user_description,
    with_manual_description,
)
from page_source import page_source

import core.db_mongo as db_mongo

with patch.object(db_mongo, "ensure_indexes"):
    import web.routes.jobs as jobs_routes

OID = "6abbb5bf2f19f44d13721caf"
LI_ID = "4100000001"
PASTED = "About the role.\nShip product features. Stack: TypeScript, Node.js, PostgreSQL.\n"


class NormalizeDescriptionTests(unittest.TestCase):
    def test_rejects_non_string(self):
        text, err = normalize_user_description(None)
        self.assertIsNone(text)
        self.assertEqual(err, "description must be a string")
        text, err = normalize_user_description({"html": "<p>hi</p>"})
        self.assertIsNone(text)
        self.assertEqual(err, "description must be a string")

    def test_strips_null_bytes_and_caps_length(self):
        text, err = normalize_user_description("hello\x00world")
        self.assertIsNone(err)
        self.assertEqual(text, "helloworld")
        long = "x" * (USER_DESCRIPTION_MAX_CHARS + 50)
        text, err = normalize_user_description(long)
        self.assertIsNone(err)
        self.assertEqual(len(text), USER_DESCRIPTION_MAX_CHARS)


class ManualDescriptionFlagTests(unittest.TestCase):
    def test_adds_description_when_text_is_present(self):
        self.assertEqual(
            with_manual_description(["title"], has_text=True),
            ["title", "description"],
        )

    def test_drops_description_when_cleared(self):
        self.assertEqual(
            with_manual_description(["title", "description"], has_text=False),
            ["title"],
        )

    def test_known_fields_keep_description(self):
        self.assertEqual(
            known_manual_fields(["title", "bogus", "description", "title"]),
            ["title", "description"],
        )


class KeepManualDescriptionTests(unittest.TestCase):
    def test_user_paste_wins_over_scrape(self):
        scraped = {"description": "Scraped teaser"}
        keep_manual_description(scraped, {
            "description": PASTED,
            "manual_fields": ["description"],
        })
        self.assertEqual(scraped["description"], PASTED)

    def test_empty_user_field_allows_scrape(self):
        scraped = {"description": "Scraped body"}
        keep_manual_description(scraped, {
            "description": "   ",
            "manual_fields": ["description"],
        })
        self.assertEqual(scraped["description"], "Scraped body")

    def test_unmarked_description_is_not_kept(self):
        scraped = {"description": "Scraped body"}
        keep_manual_description(scraped, {
            "description": PASTED,
            "manual_fields": ["title"],
        })
        self.assertEqual(scraped["description"], "Scraped body")


class DescriptionEndpointTests(unittest.TestCase):
    def setUp(self):
        import web.web_app as web_app
        self.web_app = web_app
        web_app.app.config["LOGIN_DISABLED"] = True
        self.client = web_app.app.test_client()

    def tearDown(self):
        self.web_app.app.config["LOGIN_DISABLED"] = False

    def test_non_string_is_rejected(self):
        res = self.client.patch(f"/api/jobs/{OID}/description", json={"description": 12})
        self.assertEqual(res.status_code, 400)
        self.assertIn("string", res.get_json()["error"])

    def test_save_updates_matched_and_jobs(self):
        matched = MagicMock()
        jobs_col = MagicMock()
        doc = {
            "_id": ObjectId(OID),
            "job_id": LI_ID,
            "source": "linkedin",
            "title": "Backend Engineer",
            "company": "Acme",
            "manual_fields": ["title"],
            "description": "",
        }
        matched.find_one.return_value = doc
        matched.update_one.return_value = MagicMock(matched_count=1)

        def get_col(name):
            return matched if name == "matched_jobs" else jobs_col

        with patch.object(jobs_routes, "get_collection", side_effect=get_col):
            res = self.client.patch(
                f"/api/jobs/{OID}/description", json={"description": PASTED},
            )

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["description"], PASTED)
        set_fields = matched.update_one.call_args[0][1]["$set"]
        self.assertEqual(set_fields["description"], PASTED)
        self.assertIn("description", set_fields["manual_fields"])
        self.assertIn("title", set_fields["manual_fields"])
        self.assertFalse(set_fields["description_empty"])
        jobs_col.update_many.assert_called_once()
        jobs_set = jobs_col.update_many.call_args[0][1]["$set"]
        self.assertEqual(jobs_set["description"], PASTED)

    def test_clear_drops_manual_flag(self):
        matched = MagicMock()
        jobs_col = MagicMock()
        doc = {
            "_id": ObjectId(OID),
            "job_id": LI_ID,
            "source": "linkedin",
            "title": "Backend Engineer",
            "company": "Acme",
            "manual_fields": ["description", "company"],
            "description": PASTED,
        }
        matched.find_one.return_value = doc

        def get_col(name):
            return matched if name == "matched_jobs" else jobs_col

        with patch.object(jobs_routes, "get_collection", side_effect=get_col):
            res = self.client.patch(f"/api/jobs/{OID}/description", json={"description": ""})

        self.assertEqual(res.status_code, 200)
        set_fields = matched.update_one.call_args[0][1]["$set"]
        self.assertEqual(set_fields["description"], "")
        self.assertEqual(set_fields["manual_fields"], ["company"])
        self.assertTrue(set_fields["description_empty"])


class DescriptionUiTests(unittest.TestCase):
    def test_tracker_card_has_edit_controls(self):
        html = page_source("index")
        self.assertIn("startEditJobDescription", html)
        self.assertIn("saveJobDescription", html)
        self.assertIn("jd-edit-btn", html)
        self.assertIn("Paste a description the scraper missed", html)
