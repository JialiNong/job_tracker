#!/usr/bin/env python3
"""API contract snapshots: what each Tracker endpoint returns for a fixed
dataset at a fixed time. The safety net for the Next.js + Postgres rewrite.

It talks to the server over HTTP only, so it can check any implementation:

  Current Flask app (default): starts a throwaway mongod + the real server,
  seeds tests/contract/fixture.json, pins the clock to fixture["now"].

      python3 tests/contract/run_contract.py            # compare
      python3 tests/contract/run_contract.py --update   # rewrite snapshots

  Any other server: point it at a running instance and give a command that
  resets its database to the fixture. The server must honour
  TRACKER_ALLOW_FIXED_NOW=1 + TRACKER_FIXED_NOW (see src/core/clock.py) and
  accept the same login form.

      python3 tests/contract/run_contract.py \\
          --base-url http://127.0.0.1:3000 --seed-cmd "pnpm contract:seed"

Snapshots live in tests/contract/snapshots/<case>.json. Cases are in
tests/contract/cases.json. Never touches the real database.
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))

FIXTURE_PATH = HERE / "fixture.json"
CASES_PATH = HERE / "cases.json"
SNAPSHOTS = HERE / "snapshots"
TZ = "Europe/Berlin"  # wall clock the app (and GitHub Actions) runs on

OID_RE = re.compile(r"\b[0-9a-f]{24}\b")


# ── Fixture lookups ──────────────────────────────────────────────────────────

def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def fixture_ids(fixture: dict) -> dict[str, list[str]]:
    out = {}
    for name, docs in fixture["collections"].items():
        out[name] = [d["_id"]["$oid"] if isinstance(d["_id"], dict) else str(d["_id"]) for d in docs]
    return out


def resolve(text: str, ids: dict[str, list[str]]) -> str:
    """"{matched_jobs:5}" -> the 5th fixture document's id (1-based)."""
    return re.sub(
        r"\{(\w+):(\d+)\}",
        lambda m: ids[m.group(1)][int(m.group(2)) - 1],
        text,
    )


def resolve_obj(value, ids):
    if isinstance(value, str):
        return resolve(value, ids)
    if isinstance(value, list):
        return [resolve_obj(v, ids) for v in value]
    if isinstance(value, dict):
        return {k: resolve_obj(v, ids) for k, v in value.items()}
    return value


# ── Normalisation ────────────────────────────────────────────────────────────

class Normalizer:
    """Stable output: known ids become "{collection:n}", new ids "<new-id-k>"."""

    def __init__(self, ids: dict[str, list[str]]):
        self.known = {oid: f"{{{name}:{i + 1}}}" for name, lst in ids.items() for i, oid in enumerate(lst)}
        self.new: dict[str, str] = {}

    def _oid(self, m):
        oid = m.group(0)
        if oid in self.known:
            return self.known[oid]
        self.new.setdefault(oid, f"<new-id-{len(self.new) + 1}>")
        return self.new[oid]

    def __call__(self, value):
        if isinstance(value, str):
            return OID_RE.sub(self._oid, value)
        if isinstance(value, list):
            return [self(v) for v in value]
        if isinstance(value, dict):
            return {self(k): self(v) for k, v in sorted(value.items())}
        return value


# ── HTTP client ──────────────────────────────────────────────────────────────

class Client:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method: str, path: str, body=None, headers=None, form=None):
        data = None
        hdrs = dict(headers or {})
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            hdrs["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=hdrs)
        try:
            with self.opener.open(req, timeout=60) as res:
                return res.status, res.read(), res.headers.get("Content-Type", "")
        except urllib.error.HTTPError as err:
            return err.code, err.read(), err.headers.get("Content-Type", "")

    def json(self, method, path, body=None, headers=None):
        status, raw, ctype = self.request(method, path, body=body, headers=headers)
        if "json" in ctype:
            return status, json.loads(raw or b"null")
        return status, {"__non_json__": ctype.split(";")[0]}

    def login(self, username: str, password: str):
        self.request("POST", "/login", form={"username": username, "password": password})
        status, _ = self.json("GET", "/api/stats")
        if status != 200:
            raise RuntimeError(f"login failed: /api/stats returned {status}")


# ── Targets ──────────────────────────────────────────────────────────────────

class FlaskTarget:
    """Throwaway mongod + the real Flask server with the clock pinned."""

    def __init__(self, fixture: dict):
        from harness import DB_NAME, Mongo, Server  # tests/e2e/harness.py
        from mongo_seed import load_fixture, read_fixture

        self._load, self._read = load_fixture, read_fixture
        self.mongo = Mongo()
        self.db_name = DB_NAME
        self.seed()
        extra = {
            "TRACKER_ALLOW_FIXED_NOW": "1",
            "TRACKER_FIXED_NOW": fixture["now"],
            "TZ": TZ,
        }
        try:
            self.server = Server(self.mongo.uri, extra_env=extra)
        except Exception:
            self.mongo.stop()
            raise
        self.base = self.server.base

    def seed(self):
        self._load(self.mongo.db, self._read())

    def stop(self):
        self.server.stop()
        self.mongo.stop()


class ExternalTarget:
    def __init__(self, base: str, seed_cmd: str):
        self.base = base
        self.seed_cmd = seed_cmd
        self.seed()

    def seed(self):
        env = {**os.environ, "CONTRACT_FIXTURE": str(FIXTURE_PATH)}
        subprocess.run(shlex.split(self.seed_cmd), check=True, env=env, cwd=ROOT)

    def stop(self):
        pass


# ── Runner ───────────────────────────────────────────────────────────────────

def settle(client: Client, spec: dict, ids):
    """Wait for background work (e.g. Log Job) before reading the result."""
    deadline = time.time() + float(spec.get("timeout", 30))
    path = resolve(spec["path"], ids)
    while time.time() < deadline:
        _, body = client.json("GET", path)
        if isinstance(body, dict) and not body.get(spec["key"]):
            return
        time.sleep(0.3)
    raise RuntimeError(f"settle timed out on {path} ({spec['key']})")


def run_case(client: Client, case: dict, ids) -> dict:
    norm = Normalizer(ids)
    headers = resolve_obj(case.get("headers"), ids)
    status, body = client.json(case.get("method", "GET"), resolve(case["path"], ids),
                               body=resolve_obj(case.get("body"), ids), headers=headers)
    out = {"request": {k: case[k] for k in ("method", "path", "body") if k in case},
           "status": status, "body": body}
    if case.get("settle"):
        settle(client, case["settle"], ids)
    if case.get("after"):
        out["after"] = {}
        for path in case["after"]:
            st, b = client.json("GET", resolve(path, ids))
            out["after"][path] = {"status": st, "body": b}
    for key in case.get("drop_keys", []):
        _drop(out, key)
    return norm(out)


def _drop(value, key):
    if isinstance(value, dict):
        value.pop(key, None)
        for v in value.values():
            _drop(v, key)
    elif isinstance(value, list):
        for v in value:
            _drop(v, key)


def diff_summary(expected, actual, path="$", out=None, limit=12):
    out = out if out is not None else []
    if len(out) >= limit:
        return out
    if type(expected) is not type(actual):
        out.append(f"{path}: {json.dumps(expected)[:80]} != {json.dumps(actual)[:80]}")
    elif isinstance(expected, dict):
        for k in sorted(set(expected) | set(actual)):
            if k not in actual:
                out.append(f"{path}.{k}: missing")
            elif k not in expected:
                out.append(f"{path}.{k}: unexpected")
            else:
                diff_summary(expected[k], actual[k], f"{path}.{k}", out, limit)
    elif isinstance(expected, list):
        if len(expected) != len(actual):
            out.append(f"{path}: length {len(expected)} != {len(actual)}")
        for i, (e, a) in enumerate(zip(expected, actual)):
            diff_summary(e, a, f"{path}[{i}]", out, limit)
    elif expected != actual:
        out.append(f"{path}: {json.dumps(expected)[:80]} != {json.dumps(actual)[:80]}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--update", action="store_true", help="rewrite snapshots instead of comparing")
    ap.add_argument("--base-url", help="check an already running server instead of the Flask app")
    ap.add_argument("--seed-cmd", help="with --base-url: command that loads fixture.json into its DB")
    ap.add_argument("-k", dest="only", help="run cases whose name contains this text")
    args = ap.parse_args()
    if args.base_url and not args.seed_cmd:
        ap.error("--base-url needs --seed-cmd")

    from harness import PASSWORD, USERNAME

    fixture = load_fixture()
    ids = fixture_ids(fixture)
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    if args.only:
        cases = [c for c in cases if args.only in c["name"]]

    target = ExternalTarget(args.base_url, args.seed_cmd) if args.base_url else FlaskTarget(fixture)
    failed, written = [], 0
    try:
        client = Client(target.base)
        client.login(USERNAME, PASSWORD)
        dirty = False
        for case in cases:
            if dirty:
                target.seed()
                dirty = False
            result = run_case(client, case, ids)
            if case.get("method", "GET") != "GET":
                dirty = True
            snap = SNAPSHOTS / f"{case['name']}.json"
            if args.update:
                SNAPSHOTS.mkdir(exist_ok=True)
                snap.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
                written += 1
                continue
            if not snap.exists():
                failed.append((case["name"], ["no snapshot (run with --update)"]))
                continue
            expected = json.loads(snap.read_text(encoding="utf-8"))
            if expected != result:
                failed.append((case["name"], diff_summary(expected, result)))
            else:
                print(f"  ok   {case['name']}")
    finally:
        target.stop()

    if args.update:
        print(f"wrote {written} snapshots to {SNAPSHOTS.relative_to(ROOT)}")
        return 0
    for name, lines in failed:
        print(f"  FAIL {name}")
        for line in lines:
            print(f"         {line}")
    print(f"\n{len(cases) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
