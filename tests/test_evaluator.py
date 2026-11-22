"""matching.evaluator: code-side scoring and storage mapping (no API calls)."""
from __future__ import annotations

import unittest
from unittest.mock import patch


from matching import evaluator as ev  # noqa: E402

JOB = {"title": "Senior Frontend Engineer", "company": "Acme", "location": "Berlin, Germany"}


def labels(**over):
    base = {
        "description_usable": True,
        "hard_fail": False,
        "hard_fail_kind": "none",
        "hard_fail_evidence": "",
        "german_required": False,
        "german_evidence": "",
        "role_type": "frontend",
        "stack_fit": "strong",
        "seniority": "senior",
        "backend_language_ask": "none",
        "ai_product_work": False,
        "english_team": "true",
        "stack": "React, TypeScript",
        "stack_matched": ["React", "TypeScript"],
        "stack_missing": ["GraphQL"],
        "summary": "Frontend role.",
        "watch_outs": "none",
        "_usage": {"input_tokens": 1, "output_tokens": 1},
    }
    base.update(over)
    return base


COMPANY = {
    "business": "Online shop software",
    "product_type": "b2b_saas",
    "vertical": "e-commerce",
    "markets": "global",
    "markets_detail": "30 countries",
    "is_recruiter_for_other_company": False,
    "sources": [],
}


class ScoreJobTests(unittest.TestCase):
    def test_strong_frontend_saas_global_scores_high(self):
        res = ev.score_job(JOB, labels(), COMPANY)
        # 7 frontend + 1 stack + 0.3 Berlin + 1 SaaS + 0.7 global = 10
        self.assertEqual(res["score"], 10.0)

    def test_german_required_is_hard_fail(self):
        res = ev.score_job(JOB, labels(german_required=True), COMPANY)
        self.assertEqual(res["score"], 1.0)
        self.assertIn("hard fail: german_required", res["parts"])

    def test_required_non_js_backend_is_hard_fail(self):
        res = ev.score_job(JOB, labels(backend_language_ask="required_non_js"))
        self.assertIn("hard fail: non_js_backend_required", res["parts"])

    def test_implied_non_js_backend_is_only_a_gap(self):
        # Model over-calls the hard fail; backend_language_ask decides.
        res = ev.score_job(
            JOB,
            labels(
                backend_language_ask="implied_non_js",
                hard_fail=True,
                hard_fail_kind="non_js_backend_required",
            ),
        )
        self.assertAlmostEqual(res["score"], 7.3)

    def test_hardware_company_is_penalised(self):
        # Frontend / fullstack role at a hardware company: softer -1.5
        hw = {**COMPANY, "product_type": "hardware_industrial_automotive", "markets": "dach"}
        res = ev.score_job(JOB, labels(), hw)
        self.assertAlmostEqual(res["score"], 6.8)
        self.assertIn("hardware_industrial_automotive -1.5", res["parts"])

    def test_hardware_company_full_penalty_for_non_web_role(self):
        hw = {**COMPANY, "product_type": "hardware_industrial_automotive", "markets": "dach"}
        res = ev.score_job(JOB, labels(role_type="backend"), hw)
        self.assertIn("hardware_industrial_automotive -2.5", res["parts"])

    def test_blocked_company_case_insensitive(self):
        job = {**JOB, "company": "HYRA Talent"}
        with patch.object(ev, "MATCH_BLOCKED_COMPANIES", ["Hyra"]):
            res = ev.score_job(job, labels(), COMPANY)
        self.assertIn("hard fail: blocked company", res["parts"])

    def test_blocked_company_reason_ignores_ai_evidence(self):
        job = {**JOB, "company": "Hyra"}
        lab = labels(hard_fail=True, hard_fail_kind="leadership", hard_fail_evidence='"Leading technical projects"')
        with patch.object(ev, "MATCH_BLOCKED_COMPANIES", ["Hyra"]):
            res = {**ev.score_job(job, lab, None), "labels": lab, "company": None}
        out = ev.to_analysis(res)
        self.assertEqual(out["match_gate"], "blocked_company")
        self.assertEqual(out["disqualification_reason"], "blocked_company: company is on the blocked list")

    def test_unusable_description(self):
        res = ev.score_job(JOB, labels(description_usable=False))
        self.assertEqual(res["score"], 0.0)


class EvaluateTests(unittest.TestCase):
    def test_empty_description_skips_the_model(self):
        with patch.object(ev, "classify_job") as classify:
            res = ev.evaluate({**JOB, "description": ""})
        classify.assert_not_called()
        self.assertEqual(ev.to_analysis(res)["match_gate"], "empty_desc")

    def test_incomplete_description_skips_the_model(self):
        teaser = "We build React and TypeScript apps for shops in Berlin."
        with patch.object(ev, "classify_job") as classify:
            res = ev.evaluate({**JOB, "description": teaser, "source": "linkedin"})
        classify.assert_not_called()
        out = ev.to_analysis(res)
        self.assertEqual(out["match_gate"], "incomplete_desc")
        self.assertTrue(out["needs_refetch"])

    def test_german_description_skips_the_model(self):
        german = (
            "Unternehmensbeschreibung\n"
            "SCAYLE ist eine der am schnellsten wachsenden Enterprise-Commerce-"
            "Plattformen der Welt und ermöglicht es Marken und Einzelhändlern, "
            "ihre D2C-Ambitionen zu verwirklichen. Wir suchen ab sofort eine:n "
            "Senior Frontend Developer, um unser dynamisches Engineering-Team "
            "zu verstärken. Entwicklung hochfrequentierter Benutzeroberflächen "
            "auf Basis von JavaScript, TypeScript, Vue 3 und Nuxt 3.\n"
        ) * 3
        with patch.object(ev, "classify_job") as classify:
            res = ev.evaluate({
                **JOB,
                "title": "Senior Frontend Engineer (m/f/d)",
                "company": "ABOUT YOU",
                "source": "linkedin",
                "description": german,
            })
        classify.assert_not_called()
        out = ev.to_analysis(res)
        self.assertEqual(out["match_gate"], "non_english")
        self.assertFalse(out["needs_refetch"])
        self.assertIn("not English", out["disqualification_reason"])

    def test_company_lookup_only_after_layer1_passes(self):
        long_jd = "We build React apps for shops. " * 40
        with patch.object(ev, "classify_job", return_value=labels(german_required=True)), \
                patch.object(ev, "research_company") as research:
            ev.evaluate({**JOB, "description": long_jd}, cv="cv", rules="rules")
        research.assert_not_called()

        with patch.object(ev, "classify_job", return_value=labels()), \
                patch.object(ev, "research_company", return_value=COMPANY) as research:
            res = ev.evaluate({**JOB, "description": long_jd}, cv="cv", rules="rules")
        research.assert_called_once()
        self.assertEqual(res["company"], COMPANY)


class ToAnalysisTests(unittest.TestCase):
    def test_scored_job_fields(self):
        res = {"labels": labels(), "company": COMPANY, **ev.score_job(JOB, labels(), COMPANY)}
        out = ev.to_analysis(res, threshold=7.0)
        self.assertEqual(out["match_gate"], "scored")
        self.assertEqual(out["recommendation"], "Yes")
        self.assertTrue(any(r.startswith("Business:") for r in out["match_reasons"]))
        self.assertTrue(any("30 countries" in r for r in out["match_reasons"]))
        self.assertNotIn("_usage", out["job_labels"])
        self.assertEqual(out["red_flags"], [])
        # Tracker fit tags read these straight from job_labels
        self.assertEqual(out["job_labels"]["stack_matched"], ["React", "TypeScript"])
        self.assertEqual(out["job_labels"]["stack_missing"], ["GraphQL"])

    def test_schema_requires_every_property(self):
        # OpenAI strict mode rejects a schema whose properties are not all required
        self.assertEqual(
            set(ev.JOB_SCHEMA["properties"]), set(ev.JOB_SCHEMA["required"])
        )

    def test_gate_names_match_unmatched_filter(self):
        cases = {
            "german_required": "german",
            "non_js_backend_required": "stack",
            "leadership": "leadership",
        }
        for kind, gate in cases.items():
            lb = labels(hard_fail=True, hard_fail_kind=kind, hard_fail_evidence="quote")
            if kind == "german_required":
                lb["german_required"] = True
            if kind == "non_js_backend_required":
                lb["backend_language_ask"] = "required_non_js"
            res = {"labels": lb, "company": None, **ev.score_job(JOB, lb)}
            self.assertEqual(ev.to_analysis(res)["match_gate"], gate, kind)

    def test_failed_call_returns_none(self):
        self.assertIsNone(ev.to_analysis({"score": None, "parts": []}))


class StackGroundingTests(unittest.TestCase):
    def test_drops_frameworks_the_posting_does_not_name(self):
        # Real case: posting said only "JavaScript", model added the CV's frameworks
        lb = {"stack_matched": ["JavaScript", "React", "Vue", "Angular", "Node.js"],
              "stack_missing": ["Kafka", "Java"]}
        ev.ground_stack_labels(lb, "Senior Product Engineer\nYou write JavaScript and run Kafka.")
        self.assertEqual(lb["stack_matched"], ["JavaScript"])
        self.assertEqual(lb["stack_missing"], ["Kafka"])

    def test_spelling_variants_and_word_boundaries(self):
        cases = [
            ("Java", "We use JavaScript", False),
            ("Go", "good engineers", False),
            ("Golang", "Backend in Go.", True),
            ("Node.js", "NodeJS services", True),
            ("Vue", "Vue.js 3", True),
            ("C", "C# only", False),
            ("PostgreSQL", "Postgres", True),
            ("Kubernetes", "k8s", True),
            ("Express", "an expressive team", False),
        ]
        for term, text, want in cases:
            self.assertEqual(ev.stack_term_in_text(term, text), want, (term, text))

    def test_classify_job_grounds_model_output(self):
        fake = labels(stack_matched=["React", "TypeScript"], stack_missing=["Vue"])
        fake.pop("_usage")

        class Resp:
            output_text = __import__("json").dumps(fake)
            usage = None

        with patch.object(ev, "_client") as client:
            client.return_value.responses.create.return_value = Resp()
            out = ev.classify_job({"title": "FE", "description": "TypeScript only."}, cv="", rules="")
        self.assertEqual(out["stack_matched"], ["TypeScript"])
        self.assertEqual(out["stack_missing"], [])


if __name__ == "__main__":
    unittest.main()
