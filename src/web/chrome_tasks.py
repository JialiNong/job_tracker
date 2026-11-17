"""
Background Chrome work started from the Tracker: Log Job, Run AI, batch
Fetch details / Run AI.

Holds the in-memory state + locks for each task so routes can report
progress and refuse to start a second Chrome scrape.

Single process by design: the state and locks below live in this process's
memory, so the web server must run ONE worker (threads are fine). With more
workers, a status poll can land on a worker that never saw the task, and the
locks no longer stop two Chrome scrapes. render.yaml pins `--workers 1`;
tests/test_architecture.py guards that.
"""
from __future__ import annotations

import threading
from typing import Optional

from bson import ObjectId
from flask import jsonify

from core.db_mongo import get_collection
from core.manual_log import (
    PLAYWRIGHT_UNAVAILABLE_MSG,
    RECOMMENDED_BY_AGENTS,
    can_fetch_details,
    save_link_only_urls,
)
from services.browser_session import playwright_available
from services.log_job import process_urls
from services.tracker_jobs import (
    fetch_job_details_for_matched_job,
    run_ai_on_matched_job,
    stored_jd_usable,
)
from web.list_query import JOBS_LIST_PROJECTION, combine_job_list_query
from web.serialize import _serialize
from web.task_log import capture_thread_output

FETCH_DETAILS_BATCH_MAX = 80


# Background task state (one run at a time)
_manual_apply_lock = threading.Lock()
_manual_apply_state: dict = {
    "running": False,
    "log": [],
    "done_count": 0,
    "fail_count": 0,
    "skip_count": 0,
}


_run_ai_lock = threading.Lock()
_run_ai_state: dict = {
    "running": False,
    "job_id": None,
    "log": [],
    "ok": False,
    "error": None,
    "match_score": None,
    "match_gate": None,
    "gate_reason": None,
}

_fetch_batch_lock = threading.Lock()
_fetch_batch_state: dict = {
    "running": False,
    "mode": "fetch",
    "total": 0,
    "current": 0,
    "done_count": 0,
    "fail_count": 0,
    "skip_count": 0,
    "results": [],
    "error": None,
}
BATCH_BUSY_MSG = "A batch Fetch details / Run AI is already running."
MANUAL_LOG_BUSY_MSG = "A manual job log run is already in progress. Please wait."
RUN_AI_BUSY_MSG = "Another Run AI is already in progress. Please wait."


def _chrome_busy_reason(*, ignore_run_ai: bool = False) -> Optional[str]:
    """Why a Chrome scrape cannot start now, or None if idle."""
    if _fetch_batch_state.get("running"):
        return BATCH_BUSY_MSG
    if not ignore_run_ai and _run_ai_state.get("running"):
        return "Run AI is already in progress. Please wait."
    if _manual_apply_state.get("running"):
        return "Manual Log Job is running — wait for it to finish."
    return None


def log_since(lines: list, since) -> tuple[list, int]:
    """Lines after index `since` plus the total, so pollers append without gaps."""
    try:
        start = max(0, int(since or 0))
    except (TypeError, ValueError):
        start = 0
    snapshot = list(lines)
    return snapshot[start:], len(snapshot)


# ── Log Job ───────────────────────────────────────────────────────────────────

def start_manual_log(
    urls: list,
    *,
    mode: str,
    status: str,
    applied_date,
    recommended_by,
    identity,
    save=None,
) -> tuple:
    """
    Run Log Job in a background thread. Returns (payload, http_status).

    mode=link_only never touches Chrome or AI (safe on Render). `save` is
    injectable for tests; by default it is process_urls / save_link_only_urls,
    which both return {"ok", "skipped", "failed"} URL lists.
    """
    busy = _chrome_busy_reason()
    if busy:
        return {"error": busy}, 429
    if not _manual_apply_lock.acquire(blocking=False):
        return {"error": MANUAL_LOG_BUSY_MSG}, 429

    save = save or (save_link_only_urls if mode == "link_only" else process_urls)
    log: list = []
    _manual_apply_state.update(
        running=True, log=log, done_count=0, fail_count=0, skip_count=0,
    )

    def run():
        try:
            with capture_thread_output(log):
                results = save(
                    urls,
                    applied_date=applied_date,
                    status=status,
                    recommended_by=recommended_by,
                    identity=identity,
                ) or {}
            _manual_apply_state.update(
                done_count=len(results.get("ok") or []),
                skip_count=len(results.get("skipped") or []),
                fail_count=len(results.get("failed") or []),
            )
        except Exception as e:
            log.append(f"❌ Fatal error: {e}")
            _manual_apply_state["fail_count"] = len(urls)
        finally:
            _manual_apply_state["running"] = False
            _manual_apply_lock.release()

    threading.Thread(target=run, daemon=True).start()
    return {"status": "started", "total": len(urls), "job_status": status, "mode": mode}, 200


def manual_log_status(since=0) -> dict:
    # Read `running` first: the task appends its last lines before it clears
    # the flag, so running=False here guarantees the snapshot is complete.
    running = _manual_apply_state["running"]
    lines, total = log_since(_manual_apply_state["log"], since)
    return {
        "running": running,
        "log": lines,
        "log_total": total,
        "done_count": _manual_apply_state["done_count"],
        "fail_count": _manual_apply_state["fail_count"],
        "skip_count": _manual_apply_state.get("skip_count", 0),
    }


# ── Run AI (one card) ─────────────────────────────────────────────────────────

def start_run_ai(doc: dict, job_id: str, *, run_one=None) -> tuple:
    """
    Run AI on one Tracker card in a background thread. Returns (payload, http_status).

    A complete stored JD is matched without Chrome; only a scrape needs
    Chrome to be free of Log Job / batch Fetch details.
    """
    if not _run_ai_lock.acquire(blocking=False):
        return {"error": RUN_AI_BUSY_MSG, "busy_job_id": _run_ai_state.get("job_id")}, 429

    uses_stored_jd = stored_jd_usable(doc)
    if not uses_stored_jd:
        busy = _chrome_busy_reason(ignore_run_ai=True)
        if busy:
            _run_ai_lock.release()
            return {"error": busy}, 429

    run_one = run_one or run_ai_on_matched_job
    log: list = []
    _run_ai_state.update(
        running=True, job_id=job_id, log=log, ok=False, error=None,
        match_score=None, match_gate=None, gate_reason=None,
    )

    def run():
        try:
            with capture_thread_output(log):
                result = run_one(doc)
            _run_ai_state.update(
                ok=bool(result.get("ok")),
                error=result.get("error"),
                match_score=result.get("match_score"),
                match_gate=result.get("match_gate"),
                gate_reason=result.get("gate_reason"),
            )
        except Exception as e:
            _run_ai_state.update(ok=False, error=str(e))
            log.append(f"❌ Fatal error: {e}")
        finally:
            _run_ai_state["running"] = False
            _run_ai_lock.release()

    threading.Thread(target=run, daemon=True).start()
    return {"status": "started", "job_id": job_id, "uses_stored_jd": uses_stored_jd}, 200


def run_ai_status(job_id: str) -> dict:
    state = _run_ai_state
    mine = state.get("job_id") == job_id
    return {
        "running": state["running"] and mine,
        "job_id": state.get("job_id"),
        "log": state["log"][-80:],
        "ok": state["ok"] if mine and not state["running"] else None,
        "error": state.get("error") if mine else None,
        "match_score": state.get("match_score") if mine else None,
        "match_gate": state.get("match_gate") if mine else None,
        "gate_reason": state.get("gate_reason") if mine else None,
    }


# ── Fetch details / Run AI: one card, and batches ─────────────────────────────

def guard_fetch_details_playwright() -> tuple:
    """
    Check Playwright once for Fetch details.

    Returns (error_payload, http_status) when scrape cannot run on this
    host (Render), otherwise (None, None).
    """
    if not playwright_available():
        return {"ok": False, "error": PLAYWRIGHT_UNAVAILABLE_MSG}, 503
    return None, None


def _to_http(result: dict, default_error: str) -> tuple:
    """Map a service result dict to (payload, http_status)."""
    if result.get("ok"):
        return result, 200
    err = result.get("error") or default_error
    code = 503 if PLAYWRIGHT_UNAVAILABLE_MSG in err else 502
    return {**result, "error": err}, code


def run_ai_on_tracker_job(doc: dict) -> tuple:
    """Scrape JD (if needed) and run AI matching on one Tracker card. (payload, http_status)."""
    try:
        result = run_ai_on_matched_job(doc)
    except Exception as e:
        return {"ok": False, "error": str(e)}, 500
    return _to_http(result, "Run AI failed")


def run_fetch_job_details(doc: dict) -> tuple:
    """
    Fetch scraped job fields for a Tracker card that still needs a JD
    (or is agent-tagged). Returns (payload, http_status).
    """
    if not can_fetch_details(doc):
        return {"ok": False, "error": "This card already has job details"}, 400
    try:
        result = fetch_job_details_for_matched_job(doc)
    except Exception as e:
        return {"ok": False, "error": str(e)}, 500
    return _to_http(result, "Fetch failed")


def _payload_of(out) -> dict:
    """Normalise a runner's return value ((payload, status) or payload) to a dict."""
    payload = out[0] if isinstance(out, tuple) and out else out
    if not isinstance(payload, dict):
        payload = {"ok": False, "error": str(payload)}
    return payload


def _reset_batch_counts(total: int) -> list:
    results: list = []
    _fetch_batch_state.update(
        total=total, results=results, done_count=0, fail_count=0, skip_count=0, error=None,
    )
    return results


def run_fetch_details_batch_jobs(docs: list, fetch_one=None) -> dict:
    """
    Sequentially fetch details for Tracker docs. One failure does not stop
    the rest. fetch_one(doc) -> (payload, http_status); default is
    run_fetch_job_details. Updates _fetch_batch_state as it goes.
    """
    fetch_one = fetch_one or run_fetch_job_details
    done = failed = skipped = 0
    total = len(docs)
    results = _reset_batch_counts(total)

    for i, doc in enumerate(docs, 1):
        _fetch_batch_state["current"] = i
        title = doc.get("title") or doc.get("job_id") or "job"
        job_key = str(doc.get("_id") or doc.get("job_id") or i)
        if not can_fetch_details(doc):
            skipped += 1
            results.append({
                "id": job_key,
                "title": title,
                "ok": False,
                "error": "This card already has job details",
            })
            _fetch_batch_state.update(skip_count=skipped, fail_count=failed)
            continue
        try:
            payload = _payload_of(fetch_one(doc))
        except Exception as e:
            payload = {"ok": False, "error": str(e)}
        ok = bool(payload.get("ok"))
        if ok:
            done += 1
            title = payload.get("title") or title
        else:
            failed += 1
        results.append({
            "id": job_key,
            "title": title,
            "ok": ok,
            "error": None if ok else (payload.get("error") or "Fetch failed"),
        })
        _fetch_batch_state.update(done_count=done, fail_count=failed, skip_count=skipped)

    return {
        "ok": failed == 0 and skipped == 0,
        "total": total,
        "done_count": done,
        "fail_count": failed,
        "skip_count": skipped,
        "results": results,
        "error": None,
        "mode": "fetch",
    }


def run_ai_batch_jobs(docs: list, run_one=None) -> dict:
    """
    Sequentially Run AI (scrape + match) for Tracker docs. One failure
    does not stop the rest. run_one(doc) -> (payload, http_status).
    Updates _fetch_batch_state as it goes.
    """
    run_one = run_one or run_ai_on_tracker_job
    done = failed = 0
    total = len(docs)
    _fetch_batch_state["mode"] = "run_ai"
    results = _reset_batch_counts(total)

    for i, doc in enumerate(docs, 1):
        _fetch_batch_state["current"] = i
        title = doc.get("title") or doc.get("job_id") or "job"
        job_key = str(doc.get("_id") or doc.get("job_id") or i)
        try:
            payload = _payload_of(run_one(doc))
        except Exception as e:
            payload = {"ok": False, "error": str(e)}
        ok = bool(payload.get("ok"))
        if ok:
            done += 1
            title = payload.get("title") or title
        else:
            failed += 1
        results.append({
            "id": job_key,
            "title": title,
            "ok": ok,
            "error": None if ok else (payload.get("error") or "Run AI failed"),
            "match_score": payload.get("match_score"),
            "match_gate": payload.get("match_gate") or "",
            "used_stored_jd": bool(payload.get("used_stored_jd")),
        })
        _fetch_batch_state.update(done_count=done, fail_count=failed, skip_count=0)

    return {
        "ok": failed == 0,
        "total": total,
        "done_count": done,
        "fail_count": failed,
        "skip_count": 0,
        "results": results,
        "error": None,
        "mode": "run_ai",
    }


def parse_batch_job_oids(raw_ids) -> tuple:
    """
    Parse POST ids into ObjectIds.

    Returns (oids, None) or (None, (error_payload, http_status)).
    """
    if not isinstance(raw_ids, list) or not raw_ids:
        return None, ({"ok": False, "error": "Select at least one job"}, 400)
    oids = []
    seen = set()
    for raw in raw_ids:
        text = str(raw or "").strip()
        if not text or text in seen:
            continue
        try:
            oids.append(ObjectId(text))
        except Exception:
            return None, ({"ok": False, "error": f"Invalid id: {text}"}, 400)
        seen.add(text)
        if len(oids) >= FETCH_DETAILS_BATCH_MAX:
            break
    if not oids:
        return None, ({"ok": False, "error": "Select at least one job"}, 400)
    return oids, None


def load_tracker_docs_in_order(oids: list) -> tuple:
    """Return (docs, missing_id_strings) in the requested order."""
    matched_col = get_collection("matched_jobs")
    docs_by_id = {
        doc["_id"]: doc
        for doc in matched_col.find({"_id": {"$in": oids}})
    }
    docs = []
    missing = []
    for oid in oids:
        doc = docs_by_id.get(oid)
        if not doc:
            missing.append(str(oid))
            continue
        docs.append(doc)
    return docs, missing


def start_chrome_batch(docs: list, *, runner, mode: str, missing: list, raw_count: int, oid_count: int):
    """Start a sequential Chrome batch on the shared fetch/run-ai lock."""
    if not _fetch_batch_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": BATCH_BUSY_MSG}), 429

    def run():
        try:
            runner(docs)
        except Exception as e:
            _fetch_batch_state["error"] = str(e)
            _fetch_batch_state["results"].append({
                "id": "",
                "title": "batch",
                "ok": False,
                "error": str(e),
            })
            _fetch_batch_state["fail_count"] = _fetch_batch_state.get("fail_count", 0) + 1
        finally:
            _fetch_batch_state["running"] = False
            _fetch_batch_lock.release()

    _fetch_batch_state.update(
        running=True, mode=mode, total=len(docs), current=0,
        done_count=0, fail_count=0, skip_count=0, results=[], error=None,
    )
    threading.Thread(target=run, daemon=True).start()
    return jsonify({
        "ok": True,
        "status": "started",
        "mode": mode,
        "total": len(docs),
        "skipped_missing": missing,
        "truncated": raw_count > oid_count,
        "limit": FETCH_DETAILS_BATCH_MAX,
    })


def _missing_details_mongo_clause() -> dict:
    """Link-only / empty-JD stubs, including jobs logged before recommended_by."""
    return {
        "$or": [
            {"title": {"$regex": r"^\(Link only\)"}},
            {"ai_pending": True, "details_fetched_at": {"$exists": False}},
            {
                "details_fetched_at": {"$exists": False},
                "$or": [
                    {"summary": {"$exists": False}},
                    {"summary": {"$in": [None, ""]}},
                ],
            },
        ]
    }


def _missing_ai_mongo_clause() -> dict:
    """Cards without an AI result yet (same rule as the card's Run AI hint)."""
    return {
        "$or": [
            {"ai_pending": True},
            {"match_score": {"$in": [None, ""]}},
            {"summary": {"$in": [None, ""]}},
        ]
    }


def collect_fetch_detail_targets(
    query: dict,
    *,
    missing_only: bool = False,
    missing_ai: bool = False,
    limit: int = FETCH_DETAILS_BATCH_MAX,
) -> list:
    """Tracker rows that can Fetch details / Run AI, matching the list filters, newest first."""
    collection = get_collection("matched_jobs")
    missing_clause = _missing_details_mongo_clause()
    if missing_ai:
        fetch_clause = _missing_ai_mongo_clause()
    else:
        fetch_clause = (
            missing_clause
            if missing_only
            else {
                "$or": [
                    {"recommended_by": {"$in": list(RECOMMENDED_BY_AGENTS)}},
                    missing_clause,
                ]
            }
        )
    full_query = combine_job_list_query([query, fetch_clause])
    cap = max(1, min(int(limit or FETCH_DETAILS_BATCH_MAX), FETCH_DETAILS_BATCH_MAX))
    docs = list(
        collection.find(full_query, JOBS_LIST_PROJECTION)
        .sort("matched_at", -1)
        .limit(cap * 3)
    )
    out = []
    for doc in docs:
        serialized = _serialize(dict(doc))
        if missing_only and not serialized.get("details_missing"):
            continue
        out.append({
            "id": serialized["_id"],
            "title": serialized.get("title") or "",
            "details_missing": bool(serialized.get("details_missing")),
        })
        if len(out) >= cap:
            break
    return out
