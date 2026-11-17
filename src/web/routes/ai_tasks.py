"""Run AI and Fetch details: per card and in batches (Chrome, background)."""
from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_login import login_required

from core.db_mongo import get_collection
from web.chrome_tasks import (
    FETCH_DETAILS_BATCH_MAX,
    _chrome_busy_reason,
    _fetch_batch_state,
    collect_fetch_detail_targets,
    guard_fetch_details_playwright,
    load_tracker_docs_in_order,
    parse_batch_job_oids,
    run_ai_batch_jobs,
    run_ai_status,
    run_fetch_details_batch_jobs,
    run_fetch_job_details,
    start_chrome_batch,
    start_run_ai,
)
from web.list_query import _jobs_list_query_from_args

bp = Blueprint("ai_tasks", __name__)


@bp.route("/api/jobs/<job_id>/run-ai", methods=["POST"])
@login_required
def api_job_run_ai(job_id: str):
    """
    Run AI matching on a Tracker card and update analysis fields (preserves
    notes / timeline / status). A complete stored JD is used as-is; otherwise
    the link is scraped via CDP first (requires debug Chrome).
    """
    try:
        oid = ObjectId(job_id)
    except Exception:
        return jsonify({"error": "Invalid id"}), 400

    matched_col = get_collection("matched_jobs")
    doc = matched_col.find_one({"_id": oid})
    if not doc:
        return jsonify({"error": "Job not found"}), 404

    payload, status = start_run_ai(doc, job_id)
    return jsonify(payload), status


@bp.route("/api/jobs/<job_id>/fetch-details", methods=["POST"])
@login_required
def api_job_fetch_details(job_id: str):
    """
    Scrape title/company/location/description for a missing-details (or
    agent-tagged) Tracker job. Does not run AI. Requires debug Chrome
    locally; on Render returns a friendly Playwright-missing error.
    """
    try:
        oid = ObjectId(job_id)
    except Exception:
        return jsonify({"error": "Invalid id"}), 400

    doc = get_collection("matched_jobs").find_one({"_id": oid})
    if not doc:
        return jsonify({"error": "Job not found"}), 404

    busy = _chrome_busy_reason()
    if busy:
        return jsonify({"ok": False, "error": busy}), 429

    payload, status = run_fetch_job_details(doc)
    return jsonify(payload), status


@bp.route("/api/fetch-details/ids")
@login_required
def api_fetch_details_ids():
    """
    IDs of Tracker cards that can Fetch details for the current list filters.

    ?missing=1 limits to link-only / empty-JD stubs (including jobs
    logged before recommended_by existed). Used by Select missing details.
    ?missing_ai=1 limits to cards with no AI result yet (Select missing AI result).
    """
    missing = (request.args.get("missing") or "").strip().lower() in ("1", "true", "yes")
    missing_ai = (request.args.get("missing_ai") or "").strip().lower() in ("1", "true", "yes")
    query = _jobs_list_query_from_args(request.args)
    targets = collect_fetch_detail_targets(query, missing_only=missing, missing_ai=missing_ai)
    return jsonify({
        "ids": [t["id"] for t in targets],
        "jobs": targets,
        "total": len(targets),
        "missing_only": missing,
        "limit": FETCH_DETAILS_BATCH_MAX,
    })


@bp.route("/api/fetch-details/batch", methods=["POST"])
@login_required
def api_fetch_details_batch():
    """
    Fetch details for many Tracker cards, sequentially (no AI).

    Playwright is checked once up front so Render returns the friendly
    error immediately instead of failing per job. One scrape failure
    does not stop the rest. Poll GET /api/fetch-details/batch/status.
    """
    data = request.get_json(silent=True) or {}
    raw_ids = data.get("ids") or []
    oids, err = parse_batch_job_oids(raw_ids)
    if err:
        payload, status = err
        return jsonify(payload), status

    busy = _chrome_busy_reason()
    if busy:
        return jsonify({"ok": False, "error": busy}), 429

    guard, guard_status = guard_fetch_details_playwright()
    if guard:
        return jsonify(guard), guard_status

    docs, missing = load_tracker_docs_in_order(oids)
    if not docs:
        return jsonify({"ok": False, "error": "No matching Tracker jobs"}), 404

    return start_chrome_batch(
        docs,
        runner=run_fetch_details_batch_jobs,
        mode="fetch",
        missing=missing,
        raw_count=len(raw_ids),
        oid_count=len(oids),
    )


@bp.route("/api/run-ai/batch", methods=["POST"])
@login_required
def api_run_ai_batch():
    """
    Scrape + AI-match many Tracker cards, sequentially.

    Same Chrome lock as batch Fetch details. Playwright is checked once
    up front (Render-safe). One failure does not stop the rest.
    Poll GET /api/fetch-details/batch/status (shared progress).
    """
    data = request.get_json(silent=True) or {}
    raw_ids = data.get("ids") or []
    oids, err = parse_batch_job_oids(raw_ids)
    if err:
        payload, status = err
        return jsonify(payload), status

    busy = _chrome_busy_reason()
    if busy:
        return jsonify({"ok": False, "error": busy}), 429

    guard, guard_status = guard_fetch_details_playwright()
    if guard:
        return jsonify(guard), guard_status

    docs, missing = load_tracker_docs_in_order(oids)
    if not docs:
        return jsonify({"ok": False, "error": "No matching Tracker jobs"}), 404

    return start_chrome_batch(
        docs,
        runner=run_ai_batch_jobs,
        mode="run_ai",
        missing=missing,
        raw_count=len(raw_ids),
        oid_count=len(oids),
    )


@bp.route("/api/fetch-details/batch/status")
@login_required
def api_fetch_details_batch_status():
    """Poll progress for the current / last batch Fetch details or Run AI."""
    state = _fetch_batch_state
    return jsonify({
        "running": state["running"],
        "mode": state.get("mode") or "fetch",
        "total": state.get("total") or 0,
        "current": state.get("current") or 0,
        "done_count": state.get("done_count") or 0,
        "fail_count": state.get("fail_count") or 0,
        "skip_count": state.get("skip_count") or 0,
        "results": state.get("results") or [],
        "error": state.get("error"),
    })


@bp.route("/api/jobs/<job_id>/run-ai/status")
@login_required
def api_job_run_ai_status(job_id: str):
    """Poll progress for the current / last Run AI job."""
    return jsonify(run_ai_status(job_id))
