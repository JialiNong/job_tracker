"""Log Job (manual URLs) and the token-authenticated agent push endpoint."""
import hmac
import os
from datetime import datetime

from core import clock

from flask import Blueprint, jsonify, request
from flask_login import login_required

from core.agent_push import AGENT_JOBS_MAX, log_agent_jobs
from core.db_mongo import lookup_known_job
from core.manual_log import (
    RECOMMENDED_BY_AGENTS,
    job_missing_details,
    normalize_manual_identity,
    normalize_recommended_by,
    tracker_needs_scrape,
)
from web.chrome_tasks import manual_log_status, start_manual_log

bp = Blueprint("log_job", __name__)


@bp.route("/api/manual-apply/lookup", methods=["POST"])
@login_required
def api_manual_apply_lookup():
    """
    Resolve pasted job URL(s) against jobs / matched_jobs / timeout_jobs.

    Body: {"url": "..."} or {"urls": ["...", ...]}
    Returns one result per URL so Log Job can open an existing Tracker card.
    """
    data = request.get_json(silent=True) or {}
    urls = data.get("urls")
    if urls is None and data.get("url"):
        urls = [data.get("url")]
    if not isinstance(urls, list):
        return jsonify({"error": "urls must be a list (or pass url)"}), 400

    cleaned = [u.strip() for u in urls if isinstance(u, str) and u.strip()]
    if not cleaned:
        return jsonify({"error": "No valid URLs provided"}), 400

    from core.job_url import detect_source, expand_short_job_url, resolve_job_id

    results = []
    for raw in cleaned:
        url = expand_short_job_url(raw) or raw
        source = detect_source(url)
        job_id = resolve_job_id(url, source)
        hit = lookup_known_job(job_id, source, link=url) if job_id else None
        if hit:
            stage = hit.get("stage") or ""
            on_tracker = bool(hit.get("on_tracker"))
            open_path = None
            if stage == "tracker" or hit["collection"] == "matched_jobs":
                open_path = f"/?open={hit['_id']}"
            elif stage == "unmatched":
                # Only AI-scored below-threshold rows appear on /unmatched
                open_path = f"/unmatched?open={hit['_id']}"
            elif stage == "timeout" or hit["collection"] == "timeout_jobs":
                open_path = "/timeouts"
            # awaiting_match: scraped but not AI-scored — nowhere useful to open
            results.append({
                "url": url,
                "found": True,
                "collection": hit["collection"],
                "stage": stage,
                "on_tracker": on_tracker,
                "promotable": not on_tracker,
                "id": hit["_id"],
                "title": hit["title"],
                "company": hit["company"],
                "status": hit["status"],
                "source": hit["source"],
                "job_id": hit["job_id"],
                "match_score": hit.get("match_score"),
                "open_path": open_path,
                "ai_pending": bool(hit.get("ai_pending")),
                "details_missing": job_missing_details(hit) if on_tracker else False,
                "needs_scrape": tracker_needs_scrape(hit) if on_tracker else False,
            })
        else:
            results.append({
                "url": url,
                "found": False,
                "source": source,
                "job_id": job_id or "",
                "on_tracker": False,
                "promotable": True,
            })

    return jsonify({"results": results})


@bp.route("/api/manual-apply", methods=["POST"])
@login_required
def api_manual_apply():
    """
    Accepts a JSON body:
      {
        "urls": [...],
        "status": "pending"|"applied",
        "applied_date": "YYYY-MM-DD",
        "mode": "scrape"|"link_only"   # default scrape
      }
    Runs the manual job logger in a background thread.
    Returns immediately with {"status": "started"} or an error.
    Default tracker status is pending (Not Applied).

    mode=link_only: save URL stubs with ai_pending (no Chrome / no AI).
    Optional recommended_by: claude | cursor | gemini | gpt.
    Optional title / company / location (user-typed; later scrape will not overwrite).
    """
    data = request.get_json(silent=True) or {}
    urls = data.get("urls", [])
    if not isinstance(urls, list):
        return jsonify({"error": "urls must be a list"}), 400
    from core.job_url import expand_short_job_url, is_http_url

    urls = [
        expand_short_job_url(u) or u.strip()
        for u in urls
        if isinstance(u, str) and u.strip()
    ]
    # Saved links become clickable hrefs: only http(s) job URLs are kept
    urls = [u for u in urls if u and is_http_url(u)]
    if not urls:
        return jsonify({"error": "No valid URLs provided"}), 400

    mode = (data.get("mode") or "scrape").strip().lower()
    if mode not in ("scrape", "link_only"):
        return jsonify({"error": "mode must be 'scrape' or 'link_only'"}), 400

    # Tracker status: pending (Not Applied, default) or applied
    job_status = (data.get("status") or "pending").strip().lower()
    if job_status not in ("pending", "applied"):
        return jsonify({"error": "status must be 'pending' or 'applied'"}), 400

    recommended_by = normalize_recommended_by(data.get("recommended_by"))
    if data.get("recommended_by") not in (None, "", "none"):
        raw_rec = str(data.get("recommended_by") or "").strip().lower()
        if raw_rec and raw_rec not in RECOMMENDED_BY_AGENTS and raw_rec != "none":
            return jsonify({
                "error": "recommended_by must be none, claude, cursor, gemini, or gpt",
            }), 400

    identity = normalize_manual_identity(
        data.get("title"), data.get("company"), data.get("location")
    )

    # Parse optional applied_date (only meaningful when status=applied).
    # HTML <input type="date"> is day-only; strptime would yield midnight.
    # If the chosen day is today, stamp the real submit time (e.g. 14:40).
    applied_date = None
    raw_date = (data.get("applied_date") or "").strip()
    if raw_date:
        try:
            applied_date = datetime.strptime(raw_date, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "Invalid applied_date format, expected YYYY-MM-DD"}), 400
        now = clock.now()
        if applied_date.date() == now.date():
            applied_date = now

    payload, status = start_manual_log(
        urls,
        mode=mode,
        status=job_status,
        applied_date=applied_date,
        recommended_by=recommended_by,
        identity=identity,
    )
    return jsonify(payload), status


@bp.route("/api/agent/jobs", methods=["POST"])
def api_agent_jobs():
    """
    Token-authenticated Log Job for scheduled agents (Claude daily job push).

    Header: Authorization: Bearer <AGENT_API_TOKEN>
    Body:   {"jobs": [{"url", "title"?, "company"?, "location"?,
                       "recommended_by"?, "reason"?, "country"?}, ...],
             "recommended_by": "claude"}   # optional, default claude
            (a bare job list is accepted as {"jobs": <list>})
    recommended_by is claude / cursor / gemini / gpt; a per-job value
    overrides the top-level one (each agent should send its own name).
    reason is the agent's one-line "why this job fits" (stored as
    recommend_reason, shown on the Tracker card).
    country is the job's country ("Finland", "FI") or "Remote" for a
    remote role open across countries; it overrides the location guess.
    Saves link-only Tracker stubs (pending, ai_pending) synchronously — no
    Chrome / no AI, so it runs on Render. A job_id already in matched_jobs /
    jobs / timeout_jobs is skipped with no write. Skips on Unmatched
    (below_threshold) are listed separately so the agent does not treat
    them as already on the Tracker.
    Disabled (503) when AGENT_API_TOKEN is not set.
    """
    expected = os.getenv("AGENT_API_TOKEN", "").strip()
    if not expected:
        return jsonify({"error": "Agent API is disabled (AGENT_API_TOKEN not set)"}), 503
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token or not hmac.compare_digest(token, expected):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    # Agents sometimes post the bare job list instead of {"jobs": [...]}
    if isinstance(data, list):
        data = {"jobs": data}
    if not isinstance(data, dict):
        return jsonify({"error": "Body must be {\"jobs\": [...]} or a job list"}), 400
    jobs = data.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        return jsonify({"error": "jobs must be a non-empty list"}), 400
    if len(jobs) > AGENT_JOBS_MAX:
        return jsonify({"error": f"At most {AGENT_JOBS_MAX} jobs per request"}), 400

    rec_error = jsonify({
        "error": "recommended_by must be claude, cursor, gemini, or gpt",
    }), 400
    raw_rec = str(data.get("recommended_by") or "claude").strip().lower()
    if raw_rec not in RECOMMENDED_BY_AGENTS:
        return rec_error
    for item in jobs:
        if isinstance(item, dict) and item.get("recommended_by") \
                and not normalize_recommended_by(item["recommended_by"]):
            return rec_error

    result = log_agent_jobs(jobs, recommended_by=raw_rec)
    below = int(result.get("below_threshold") or 0)
    existing = result.get("existing") or []
    body = {
        "recommended_by": raw_rec,
        "saved": len(result["ok"]),
        "skipped": len(result["skipped"]),
        "failed": len(result["failed"]),
        "already_on_tracker": int(result.get("already_on_tracker") or 0),
        "below_threshold": below,
        "awaiting_match": int(result.get("awaiting_match") or 0),
        "timeout": int(result.get("timeout") or 0),
        "below_threshold_jobs": [
            item for item in existing if item.get("stage") == "unmatched"
        ],
        "urls": {
            "ok": result["ok"],
            "skipped": result["skipped"],
            "failed": result["failed"],
            "existing": existing,
        },
    }
    if below:
        body["hint"] = (
            "below_threshold jobs are already in Unmatched (scored below "
            "the match cut-off). They were not added to the Tracker match list."
        )
    return jsonify(body), 200


@bp.route("/api/manual-apply/status")
@login_required
def api_manual_apply_status():
    """
    Poll progress of the current / last manual-apply run.

    ?since=N returns only log lines after the first N (log_total = all lines),
    so the page can append without missing or repeating lines.
    """
    return jsonify(manual_log_status(request.args.get("since", 0)))
