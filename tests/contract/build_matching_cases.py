#!/usr/bin/env python3
"""Write tests/contract/matching_cases.json: inputs and the Python answers for
the matcher's pure parts (HTML to text, JD quality, English-only gate, stack
grounding, scoring, the stored analysis). packages/matching runs the same
inputs and must give the same answers.

Every input is synthetic: no real job description, CV or company data.
The language cases need lingua (requirements.txt).

    PYTHONPATH=src python3 tests/contract/build_matching_cases.py
"""
from __future__ import annotations

import itertools
import json
from pathlib import Path

from core.indeed_meta import scrub_bullet_location
from core.jd_quality import assess_job_description
from core.language import detect_job_detail_language, german_content_share, is_non_english_job_detail
from core.text import strip_html
from matching.evaluator import (
    HARD_FAIL_KINDS,
    ROLE_TYPES,
    _gate,
    company_key,
    ground_stack_labels,
    is_blocked_match_company,
    score_job,
    stack_term_in_text,
    to_analysis,
)

HERE = Path(__file__).resolve().parent

EN = (
    "We are looking for a frontend engineer to build our customer dashboard. "
    "You will work with React, TypeScript and Node.js in a small product team. "
    "Our customers are online shops across Europe, and we ship every day. "
)
DE = (
    "Wir suchen einen Frontend-Entwickler für unser Kundenportal. "
    "Du arbeitest mit React und TypeScript in einem kleinen Produktteam. "
    "Unsere Kunden sind Onlinehändler in ganz Europa, und wir liefern täglich aus. "
)
FR = (
    "Nous recherchons un développeur frontend pour notre tableau de bord client. "
    "Vous travaillerez avec React et TypeScript dans une petite équipe produit. "
)
NL = (
    "Wij zoeken een frontend ontwikkelaar voor ons klantenportaal. "
    "Je werkt met React en TypeScript in een klein productteam. "
)
INDEED_CHROME_DE = "Weiter zur Bewerbung\nJob speichern\nVollzeit\n"

LANGUAGE_TEXTS = [
    "",
    "Short.",
    "Berlin · 3.8",
    EN,
    EN * 3,
    DE,
    DE * 3,
    FR * 2,
    NL * 2,
    INDEED_CHROME_DE + EN * 3,
    EN * 3 + "\n" + DE,
    EN + "\n" + DE * 2,
    DE + "\n" + EN,
    "<p>" + EN + "</p><ul><li>React</li><li>Vue.js</li></ul><p>" + DE + "</p>",
    EN + " 🚀 Join us! ✨\n" + DE + " 💡",
    "Requirements:\n- 3+ years of JavaScript\n- Gute Deutschkenntnisse sind ein Plus\n" + EN * 2,
    "Über uns\n" + DE * 2 + "\nAbout the role\n" + EN,
    "Frontend Developer (m/w/d)\n" + DE + "\nTech stack: React, Next.js, GraphQL, AWS.",
]

HTML_SAMPLES = [
    "",
    "plain text",
    "<p>One</p><p>Two</p>",
    "<div>A<br>B<br/>C</div>",
    "<style>.x{color:red}</style><script>alert(1)</script><h2>Title</h2>Body &amp; more &lt;3",
    "<ul><li> first </li><li>second</li></ul>\n\n\n\n<p>after</p>",
    "<P CLASS='x'>Upper</P><TR><td>cell</td></TR>",
    "Caf&eacute; &#8211; na&iuml;ve &nbsp;space&#x27;s",
    "line one\r\nline two\n\n\n\nline three",
    "<h1>Head</h1>\n  indented  \n<p>tail</p>",
]

LONG_EN = EN * 4  # > 280 chars


def quality_cases():
    out = []
    samples = [
        ("", "", ""),
        ("short", "Frontend Developer", "Acme"),
        ("About the job\nSee more\nApply now\nShow less\nEasy apply\nPromoted", "Frontend Developer", "Acme"),
        ("Similar jobs\n" + LONG_EN, "Frontend Developer", "Acme"),
        (EN, "Frontend Engineer", "Acme"),
        (LONG_EN, "Frontend Engineer", "Acme"),
        (LONG_EN, "Data Scientist Position", "Globex Corporation"),
        ("Globex is hiring. " + LONG_EN, "Data Scientist Position", "Globex Corporation"),
        (LONG_EN * 2, "Data Scientist Position", "Globex Corporation"),
        (LONG_EN + "\nPeople also viewed\nSomething", "Kubernetes Platform", "Initech"),
        ("<p>" + LONG_EN + "</p>", "", ""),
        ("Ähnliche Jobs\n" + DE * 4, "Entwickler", "Müller"),
        (DE * 4, "Softwareentwickler Frontend", "Bäckerei Schmidt"),
    ]
    for text, title, company in samples:
        out.append({
            "input": {"text": text, "title": title, "company": company},
            "output": assess_job_description(text, title=title, company=company),
        })
    return out


STACK_TERMS = [
    "React", "React.js", "Vue", "Vue.js", "Node.js", "Node", "Java", "JavaScript", "TypeScript",
    "Go", "Golang", "PostgreSQL", "Postgres", "Kubernetes", "AWS", "GCP", "C#", "C++", "CI/CD",
    "Next.js", "Nuxt", "GraphQL", "REST (APIs)", "HTML/CSS", "Tailwind CSS", "Ruby on Rails", "".strip(),
]
STACK_TEXTS = [
    "We use React and Node.js with PostgreSQL on AWS.",
    "Experience with JavaScript is required; Java is a plus.",
    "Strong JS skills, k8s and Google Cloud.",
    "Good communication. We go to conferences.",
    "Stack: Golang, gRPC, postgres, CI / CD pipelines.",
    "Frontend: Vue 3, Nuxt, Tailwind-CSS, html and css.",
    "Backend in C#/.NET and C++ for the engine.",
    "Next JS, React-JS, ReactJS and node js",
    "Ruby on Rails monolith, REST APIs and GraphQL.",
    "",
]


def stack_cases():
    return [
        {"term": t, "text": x, "output": stack_term_in_text(t, x)}
        for t, x in itertools.product(STACK_TERMS, STACK_TEXTS)
    ]


def grounding_cases():
    out = []
    for text in STACK_TEXTS[:5]:
        labels = {
            "stack_matched": ["React", "Node.js", "Vue", "TypeScript", 3],
            "stack_missing": ["PostgreSQL", "Kubernetes", "Java"],
            "summary": "x",
        }
        before = json.loads(json.dumps(labels))
        ground_stack_labels(labels, text)
        out.append({"labels": before, "text": text, "output": labels})
    return out


BASE_LABELS = {
    "description_usable": True,
    "hard_fail": False,
    "hard_fail_kind": "none",
    "hard_fail_evidence": "",
    "german_required": False,
    "german_evidence": "",
    "role_type": "frontend",
    "stack_fit": "strong",
    "seniority": "mid",
    "backend_language_ask": "none",
    "ai_product_work": False,
    "english_team": "true",
    "stack": "React, TypeScript",
    "stack_matched": ["React"],
    "stack_missing": [],
    "summary": "Frontend role on a React dashboard.",
    "watch_outs": "none",
    "_usage": {"input_tokens": 10, "output_tokens": 5},
    "_model": "test-model",
}
BASE_COMPANY = {
    "business": "Online checkout for shops.",
    "product_type": "b2b_saas",
    "vertical": "ecommerce",
    "markets": "europe",
    "markets_detail": "12 EU countries",
    "is_recruiter_for_other_company": False,
    "sources": ["https://example.com"],
    "_usage": {"input_tokens": 1, "output_tokens": 1},
    "_model": "test-model",
}


def score_inputs():
    jobs = [
        {"company": "Acme", "location": "Leipzig, Germany"},
        {"company": "Acme", "location": "Munich"},
        {"company": "Acme GmbH", "location": "Remote (EU)"},
        {"company": "Jobgether", "location": "Berlin"},
        {"company": "", "location": ""},
    ]
    label_variants = [None, {}]
    for role in ROLE_TYPES:
        label_variants.append({**BASE_LABELS, "role_type": role})
    for fit, sen in itertools.product(["strong", "partial", "weak"], ["junior", "mid", "senior", "lead_or_above"]):
        label_variants.append({**BASE_LABELS, "stack_fit": fit, "seniority": sen, "role_type": "fullstack_balanced"})
    for ask in ["none", "js_only", "or_list_with_js", "nice_to_have", "company_uses", "implied_non_js", "required_non_js"]:
        label_variants.append({**BASE_LABELS, "backend_language_ask": ask})
    for kind in HARD_FAIL_KINDS:
        label_variants.append({**BASE_LABELS, "hard_fail": kind != "none", "hard_fail_kind": kind,
                               "hard_fail_evidence": f"quote for {kind}"})
    label_variants += [
        {**BASE_LABELS, "german_required": True, "german_evidence": "Fließend Deutsch (C1)"},
        {**BASE_LABELS, "description_usable": False},
        {**BASE_LABELS, "ai_product_work": True, "watch_outs": "On-call every other week"},
        {**BASE_LABELS, "watch_outs": "  None  ", "stack": ""},
        {**BASE_LABELS, "hard_fail": True, "hard_fail_kind": "non_js_backend_required",
         "backend_language_ask": "nice_to_have"},
        {**BASE_LABELS, "role_type": "unknown_kind", "stack_fit": "unknown"},
        {**BASE_LABELS, "summary": ""},
    ]
    companies = [
        None,
        BASE_COMPANY,
        {**BASE_COMPANY, "product_type": "hardware_industrial_automotive", "markets": "germany_only", "markets_detail": ""},
        {**BASE_COMPANY, "product_type": "staffing_recruiter", "is_recruiter_for_other_company": True, "markets": "unclear"},
        {**BASE_COMPANY, "product_type": "consumer_app", "markets": "global", "business": ""},
    ]
    for i, labels in enumerate(label_variants):
        yield jobs[i % len(jobs)], labels, companies[i % len(companies)]
    for job, company in itertools.product(jobs, companies):
        yield job, BASE_LABELS, company
    # hardware company: softer penalty only for web frontend / fullstack roles
    for role in ROLE_TYPES:
        yield jobs[1], {**BASE_LABELS, "role_type": role}, companies[2]


def score_cases():
    out = []
    for job, labels, company in score_inputs():
        result = score_job(job, json.loads(json.dumps(labels)) if labels is not None else None, company)
        out.append({"job": job, "labels": labels, "company": company, "output": result})
    return out


def analysis_cases():
    out = []
    parts_only = [
        ["empty description"],
        ["description unusable"],
        ["non-english description"],
        ["hard fail: blocked company"],
        ["hard fail: german_required"],
        ["hard fail: non_js_backend_required"],
        ["hard fail: leadership"],
    ]
    for parts in parts_only:
        result = {"labels": None, "company": None, "score": 0.0 if "hard" not in parts[0] else 1.0, "parts": parts}
        for threshold in (7.0, 6.5):
            out.append({"result": result, "threshold": threshold, "output": to_analysis(result, threshold)})
    for job, labels, company in score_inputs():
        if labels is None:
            continue
        scored = score_job(job, json.loads(json.dumps(labels)), company)
        result = {"labels": labels, "company": company, **scored}
        out.append({"result": result, "threshold": 7.0, "output": to_analysis(result, 7.0)})
    out.append({"result": {"labels": None, "company": None, "score": None, "parts": ["classification failed"]},
                "threshold": 7.0, "output": to_analysis({"score": None, "parts": []}, 7.0)})
    return out


class _FakeResponses:
    """Records each responses.create call and answers from a queue."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer

        class _Usage:
            input_tokens = 120
            output_tokens = 30

        class _Resp:
            output_text = json.dumps(answer)
            usage = _Usage()

        return _Resp()


class _FakeClient:
    def __init__(self, answers):
        self.responses = _FakeResponses(answers)


FLOW_CV = "Frontend developer, 4 years React and TypeScript, some Node.js. Based in Leipzig."
FLOW_RULES = "Hard fail when German is mandatory. Prefer product companies."
FLOW_JOBS = [
    # scored: layer 1 passes, company researched
    ({"title": "Frontend Engineer", "company": "Acme GmbH", "location": "Leipzig · Hybrid",
      "description": "<p>Acme is hiring. " + LONG_EN + "</p>"},
     [{**{k: v for k, v in BASE_LABELS.items() if not k.startswith("_")},
       "stack_matched": ["React", "Vue"], "stack_missing": ["GraphQL", "Node.js"]},
      {k: v for k, v in BASE_COMPANY.items() if not k.startswith("_")}]),
    # hard fail: no company call
    ({"title": "Frontend Engineer", "company": "Acme GmbH", "location": "Berlin",
      "description": "Acme is hiring. " + LONG_EN},
     [{**{k: v for k, v in BASE_LABELS.items() if not k.startswith("_")},
       "german_required": True, "german_evidence": "Deutsch C1"}]),
    # layer 1 fails
    ({"title": "Frontend Engineer", "company": "Acme GmbH", "location": "",
      "description": "Acme is hiring. " + LONG_EN}, [RuntimeError("boom")]),
    # company call fails
    ({"title": "Frontend Engineer", "company": "Initech", "location": "Remote",
      "description": "Initech frontend. " + LONG_EN},
     [{k: v for k, v in BASE_LABELS.items() if not k.startswith("_")}, RuntimeError("search down")]),
    # gates before any call
    ({"title": "Frontend Engineer", "company": "Acme", "location": "", "description": "too short"}, []),
    ({"title": "Frontend Entwickler", "company": "Acme", "location": "", "description": DE * 4}, []),
    ({"title": "Frontend Engineer", "company": "Acme", "location": "",
      "description": "About the job\nSee more\n" + EN}, []),
]


def flow_cases():
    from matching import evaluator

    out = []
    original = evaluator._client
    for job, answers in FLOW_JOBS:
        fake = _FakeClient(answers)
        evaluator._client = lambda fake=fake: fake
        try:
            result = evaluator.evaluate(job, cv=FLOW_CV, rules=FLOW_RULES, company_cache={})
        finally:
            evaluator._client = original
        out.append({
            "job": job,
            "answers": [a if not isinstance(a, Exception) else {"__error__": str(a)} for a in answers],
            "calls": fake.responses.calls,
            "result": result,
            "analysis": evaluator.to_analysis(result, 7.0),
        })
    return out


def main():
    language = []
    for text in LANGUAGE_TEXTS:
        skip, lang, share = is_non_english_job_detail(text)
        language.append({
            "text": text,
            "skip": skip,
            "lang": lang,
            "share": share,
            "detect": list(detect_job_detail_language(text)),
            "german_share": german_content_share(text),
        })
    cases = {
        "strip_html": [{"input": h, "output": strip_html(h)} for h in HTML_SAMPLES],
        "quality": quality_cases(),
        "language": language,
        "stack_terms": stack_cases(),
        "grounding": grounding_cases(),
        "score": score_cases(),
        "gate": [{"parts": p, "output": _gate(p)} for p in (
            [], ["role frontend +7.0"], ["empty description"], ["hard fail: german_required"],
            ["hard fail: blocked company"], ["hard fail: too_many_years"], ["x", "hard fail: leadership"],
        )],
        "analysis": analysis_cases(),
        "company_key": [{"input": n, "output": company_key(n)} for n in (
            "", "Acme GmbH", "ACME Inc.", "Müller & Co. KG", "Foo Group Holding AG", "SAP SE", "Zalando SE",
            "Co-op Ltd", "  Delivery  Hero  ", "N26 GmbH", "ABOUT YOU SE & Co. KG", "Bäckerei Schmidt UG",
        )],
        "flow": flow_cases(),
        "blocked": [{"input": n, "output": is_blocked_match_company(n)} for n in (
            "", None, "Acme", "Jobgether", "via JOBGETHER Ltd", "Instaffo GmbH", "Hyrax", "TaskVerse AI",
        )],
        "scrub_location": [{"input": s, "output": scrub_bullet_location(s)} for s in (
            "", "·", " • ", "3.8", "4,2 ★", "3.8 (152)", "Berlin", "Leipzig · Hybrid", "-", "5",
        )],
    }
    path = HERE / "matching_cases.json"
    path.write_text(json.dumps(cases, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path} ({sum(len(v) for v in cases.values())} cases)")


if __name__ == "__main__":
    main()
