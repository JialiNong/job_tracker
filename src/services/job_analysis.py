"""
AI steps on one scraped job: fill missing title / company / location from
the JD, run the matcher, and write the analysis onto existing rows.

OpenAI and the matcher are imported inside the functions (not on Render).
"""
from __future__ import annotations

import json
import os
from core import clock
from typing import Optional

from core.db_mongo import get_collection
from core.language import is_non_english_job_detail
from core.manual_log import analysis_fields


def infer_job_metadata_with_ai(description_text: str) -> dict:
    """
    Ask AI to infer job title, company, and location from plain-text description.

    The text passed in must already be stripped of HTML/CSS.
    Returns a dict with keys: title, company, location (any may be empty string).
    """
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("  ⚠️  No OPENAI_API_KEY found – cannot infer job metadata")
        return {}

    ai_model = os.getenv("AI_MODEL", "gpt-4.1-mini")

    # Truncate so the prompt stays cheap; 3 000 chars is plenty for header info
    trimmed = description_text[:3000]

    prompt = (
        "The following text was extracted from a job posting page "
        "(LinkedIn, Indeed, or a company careers site). "
        "Based only on the text below, infer the job title, company name, and location. "
        "If you cannot determine a field with reasonable confidence, return an empty string.\n\n"
        f"Job description text:\n{trimmed}\n\n"
        "Respond ONLY with valid JSON:\n"
        '{"title": "<job title>", "company": "<company name>", "location": "<location>"}'
    )

    try:
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=ai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract job metadata (title, company, location) from job-posting text. "
                        "Respond only with valid JSON containing exactly three keys: "
                        "title, company, location."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"  ⚠️  AI metadata inference failed: {e}")
        return {}


def fill_identity_from_description(job: dict) -> dict:
    """Infer blank title / company / location from the JD via AI."""
    if not job.get("description"):
        return job
    if job.get("title") and job.get("company") and job.get("location"):
        return job
    missing = [f for f in ("title", "company", "location") if not job.get(f)]
    print(f"  🤖 Inferring missing field(s) {missing} from description via AI…")
    metadata = infer_job_metadata_with_ai(job.get("description", ""))
    if metadata:
        for field in ("title", "company", "location"):
            if not job.get(field):
                job[field] = metadata.get(field, "")
        print(
            f"  🤖 Inferred → title='{job.get('title')}'"
            f"  company='{job.get('company')}'"
            f"  location='{job.get('location')}'"
        )
    return job


def enrich_job_and_evaluate(
    job: dict,
    user_profile: str,
    rules: str,
    *,
    allow_non_english: bool = True,
) -> Optional[dict]:
    """
    Infer missing title/company/location, then run evaluate_job.
    Returns analysis dict (never None — failed AI becomes score=0 stub).
    Returns None only when description is empty (caller should abort).
    """
    print(f"  📋 Title   : {job.get('title') or '(not found)'}")
    print(f"  🏢 Company : {job.get('company') or '(not found)'}")
    print(f"  📍 Location: {job.get('location') or '(not found)'}")
    print(f"  📝 Desc    : {len(job.get('description', ''))} chars")

    if not job.get("description"):
        print("  ⚠️  Description is empty — page may not have loaded or login required.")
        return None

    fill_identity_from_description(job)

    if not job.get("title"):
        job["title"] = f"(Unknown title — job_id {job.get('job_id', '')})"
        print(f"  ⚠️  Title not found, using fallback: {job['title']}")

    from matching.ai_matcher import evaluate_job
    should_skip, lang, de_share = is_non_english_job_detail(job.get("description", ""))
    if should_skip:
        if allow_non_english:
            print(
                f"  ⚠️  Description is non-English ({lang}, de_share={de_share:.0%}) "
                f"— continuing anyway (manual job log)"
            )
        else:
            print(
                f"  ⚠️  Description is non-English ({lang}, de_share={de_share:.0%})"
            )

    print("  🤖 Running AI matching…")
    analysis = evaluate_job(job, user_profile, rules)
    if not analysis:
        print("  ⚠️  AI analysis failed — using score=0 stub")
        analysis = {
            "match_score": 0,
            "recommendation": "Unknown",
            "summary": "AI analysis failed for this manually logged job.",
        }

    score = analysis.get("match_score", 0)
    print(f"  ✨ AI score: {score}/10  ({analysis.get('recommendation', '?')})")
    print(f"  💬 {analysis.get('summary', '')}")
    return analysis


def apply_analysis_to_existing(job: dict, analysis: dict) -> bool:
    """
    Patch scraped fields + AI analysis onto existing jobs / matched_jobs rows.

    Preserves Tracker status, notes, timeline, highlights, application_qa,
    applied_at, and matched_at. Clears ai_pending.
    """
    jobs_col = get_collection("jobs")
    matched_col = get_collection("matched_jobs")
    now = clock.utcnow()
    job_id = job["job_id"]
    source = job["source"]
    match_score = analysis.get("match_score", 0)

    patch = {
        "title":       job.get("title", ""),
        "company":     job.get("company", ""),
        "location":    job.get("location", ""),
        "description": job.get("description", ""),
        "applicants":  job.get("applicants", ""),
        "link":        job.get("link", ""),
        "match_score": match_score,
        **analysis_fields(analysis),
        "updated_at":  now,
        "ai_pending":  False,
    }

    try:
        jobs_col.update_one(
            {"job_id": job_id, "source": source},
            {
                "$set": {**patch, "matched_at": now},
                "$setOnInsert": {
                    "created_at": now,
                    "status": "new",
                    "source": source,
                },
            },
            upsert=True,
        )
        matched_col.update_one(
            {"job_id": job_id, "source": source},
            {"$set": patch},
        )
    except Exception as e:
        print(f"  ❌ Failed to update analysis: {type(e).__name__}: {e}")
        return False
    return True
