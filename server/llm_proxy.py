#!/usr/bin/env python3
"""Local Bedrock proxy for Living Mystery's optional AI-voiced dialogue.

Why this exists
---------------
The game is a zero-dependency static site, so the browser must NOT hold AWS
credentials. This tiny proxy holds them server-side and exposes exactly the
contract the browser's ``dist/llm.mjs`` expects:

    POST /  {"system": "...", "prompt": "...", "max_tokens": 300}
    -> 200  {"text": "<restyled line>"}
    -> 502  {"error": "...", "detail": "..."}

Boundary: this ONLY restyles an already-authored line. It cannot and must not
change game state — it just calls Bedrock's Converse API (mirroring the
QuickWork Bedrock pattern) and returns text. Not for production use.

Run:
    python3 server/llm_proxy.py
Configuration (env):
    LM_BEDROCK_MODEL   default us.anthropic.claude-haiku-4-5-20251001-v1:0
    AWS_REGION         default us-west-2
    LM_PROXY_HOST      default 127.0.0.1
    LM_PROXY_PORT      default 8787
    LM_TEMPERATURE     default 0.7
Credentials come from the standard AWS chain (env vars, ~/.aws, SSO, ada, ...).
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import boto3

REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-west-2"
MODEL_ID = os.environ.get("LM_BEDROCK_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
HOST = os.environ.get("LM_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("LM_PROXY_PORT", "8787"))
TEMPERATURE = float(os.environ.get("LM_TEMPERATURE", "0.7"))

_MAX_BODY = 20_000          # request body cap (bytes)
_MAX_FIELD = 6_000          # per-field char cap
_MAX_TOKENS_CAP = 512

_client = boto3.client("bedrock-runtime", region_name=REGION)


class Handler(BaseHTTPRequestHandler):
    server_version = "LivingMysteryLLMProxy/1.0"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # CORS preflight
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # trivial health check
        if self.path.rstrip("/") in ("", "/health"):
            self._send(200, {"ok": True, "model": MODEL_ID, "region": REGION})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:
        try:
            n = int(self.headers.get("content-length", "0") or 0)
            if n <= 0 or n > _MAX_BODY:
                raise ValueError("empty or oversized request body")
            payload = json.loads(self.rfile.read(n))
            system = str(payload.get("system") or "")[:_MAX_FIELD]
            prompt = str(payload.get("prompt") or "")[:_MAX_FIELD]
            if not prompt.strip():
                raise ValueError("missing 'prompt'")
            max_tokens = min(int(payload.get("max_tokens") or 300), _MAX_TOKENS_CAP)

            kwargs = dict(
                modelId=MODEL_ID,
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": max_tokens, "temperature": TEMPERATURE},
            )
            if system.strip():
                kwargs["system"] = [{"text": system}]

            resp = _client.converse(**kwargs)
            text = "".join(
                block.get("text", "")
                for block in resp["output"]["message"]["content"]
            ).strip()
            self._send(200, {"text": text})
        except Exception as exc:  # proxy is fail-soft; the browser falls back to the authored line
            self._send(502, {"error": type(exc).__name__, "detail": str(exc)[:300]})

    def log_message(self, *args) -> None:  # keep the console quiet
        pass


def main() -> None:
    print(
        f"Living Mystery Bedrock proxy → http://{HOST}:{PORT}  "
        f"(model={MODEL_ID}, region={REGION}, temp={TEMPERATURE})",
        flush=True,
    )
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
