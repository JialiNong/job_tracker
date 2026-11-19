#!/usr/bin/env python3
"""
A local stand-in for the OpenAI Responses API, for the Run AI e2e test.

The Next.js app's OpenAI SDK is pointed here with OPENAI_BASE_URL, so the
test runs the real route, SDK and Lingua gate without a key, cost or any
data leaving the machine. Answers are fixed: layer-1 labels for a plain
request, a company profile for one that asks for web search.

    python3 tests/e2e/fake_openai.py PORT
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SUMMARY = "E2E fake AI summary"
LABELS = {
    "description_usable": True, "hard_fail": False, "hard_fail_kind": "none", "hard_fail_evidence": "",
    "german_required": False, "german_evidence": "", "role_type": "fullstack_balanced", "stack_fit": "strong",
    "seniority": "mid", "backend_language_ask": "js_only", "ai_product_work": False, "english_team": "true",
    "stack": "Node.js", "stack_matched": ["Node.js"], "stack_missing": [], "summary": SUMMARY, "watch_outs": "none",
}
COMPANY = {
    "business": "E2E fake company profile", "product_type": "b2b_saas", "vertical": "logistics", "markets": "europe",
    "markets_detail": "", "is_recruiter_for_other_company": False, "sources": ["https://example.com"],
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        answer = COMPANY if body.get("tools") else LABELS
        data = json.dumps({
            "id": "resp_e2e", "object": "response", "created_at": 0, "status": "completed", "model": body.get("model"),
            "output": [{"type": "message", "id": "msg_e2e", "role": "assistant", "status": "completed",
                        "content": [{"type": "output_text", "text": json.dumps(answer), "annotations": []}]}],
            "usage": {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
