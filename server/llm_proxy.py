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

Boundary: this transports dialogue styling or structured character proposals. It cannot and must not
directly change game state — it just calls Bedrock's Converse API (mirroring the
QuickWork Bedrock pattern) and returns text. Not for production use.

Run:
    python3 server/llm_proxy.py
Configuration (env):
    LM_BEDROCK_MODEL   default us.anthropic.claude-haiku-4-5-20251001-v1:0
    AWS_REGION         default us-west-2
    LM_PROXY_HOST      default 127.0.0.1
    LM_PROXY_PORT      default 8787
    LM_TEMPERATURE     default 0.7
    LM_ALLOWED_ORIGINS comma-separated exact game origins; defaults to localhost:8000 and 127.0.0.1:8000
Install boto3 in your Python environment before running. This loopback-only development
proxy checks Host, Origin, and a custom request header. It is not authentication
against local programs and must not be exposed as a public service.
Credentials come from the standard AWS chain (env vars, ~/.aws, SSO, ada, ...).
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-west-2"
MODEL_ID = os.environ.get("LM_BEDROCK_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
CHARACTER_MODEL = os.environ.get("LM_CHARACTER_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
HOST = os.environ.get("LM_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("LM_PROXY_PORT", "8787"))
TEMPERATURE = float(os.environ.get("LM_TEMPERATURE", "0.7"))

_MAX_BODY = 20_000          # request body cap (bytes)
_MAX_FIELD = 6_000          # per-field char cap
_MAX_TOKENS_CAP = 512

ALLOWED_ORIGINS = frozenset(os.environ.get("LM_ALLOWED_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000").split(","))
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
if HOST not in ("127.0.0.1", "localhost"):
    raise ValueError("This development proxy must bind to loopback")
if "*" in ALLOWED_ORIGINS or "null" in ALLOWED_ORIGINS:
    raise ValueError("Configure explicit game origins, not wildcard or null")
_client = None
import logging, time as _time
_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(_LOG_DIR, exist_ok=True)
LOG = logging.getLogger("proxy")
_h = logging.FileHandler(os.path.join(_LOG_DIR, "proxy.log"))
_h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
LOG.addHandler(_h); LOG.setLevel(logging.INFO)

def bedrock_client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config
        # a fresh Session re-reads the credentials file (the default session caches expired keys)
        _client = boto3.Session().client("bedrock-runtime", region_name=REGION,
                              config=Config(connect_timeout=3, read_timeout=7, retries={"max_attempts": 0}))
    return _client

def validate_payload(payload, profile="dialogue-v2"):
    field_cap = 32000 if profile == "character-v1" else _MAX_FIELD
    token_cap = 1500 if profile == "character-v1" else _MAX_TOKENS_CAP
    if not isinstance(payload, dict) or not {"system", "prompt", "max_tokens"} <= set(payload) <= {"system", "prompt", "max_tokens", "temperature"}:
        raise ValueError("Expected system, prompt, max_tokens (optional temperature)")
    for field in ("system", "prompt"):
        if not isinstance(payload[field], str) or not payload[field].strip() or len(payload[field]) > field_cap:
            raise ValueError("Invalid " + field)
    tokens = payload["max_tokens"]
    if type(tokens) is not int or not 1 <= tokens <= token_cap:
        raise ValueError("Invalid max_tokens")
    if "temperature" in payload:
        temp = payload["temperature"]
        if not isinstance(temp, (int, float)) or isinstance(temp, bool) or not 0 <= temp <= 1:
            raise ValueError("Invalid temperature")
    return payload



class Handler(BaseHTTPRequestHandler):
    server_version = "LivingMysteryLLMProxy/1.0"

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, x-living-mystery")

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _allowed(self):
        return self.headers.get("Host") in ALLOWED_HOSTS and self.headers.get("Origin") in ALLOWED_ORIGINS

    def do_OPTIONS(self) -> None:  # CORS preflight
        if not self._allowed() or self.headers.get("Access-Control-Request-Method") != "POST":
            self._send(403, {"error": "origin_not_allowed"})
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # trivial health check
        if self.path.rstrip("/") in ("", "/health"):
            self._send(200, {"ok": True, "model": MODEL_ID, "region": REGION})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if not self._allowed() or self.headers.get("X-Living-Mystery") not in ("dialogue-v2", "character-v1"):
            self._send(403, {"error": "origin_not_allowed"})
            return
        if self.path != "/" or self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            self._send(400, {"error": "invalid_request"})
            return
        try:
            n = int(self.headers.get("content-length", "0") or 0)
            profile = self.headers.get("X-Living-Mystery")
            body_cap = 128000 if profile == "character-v1" else _MAX_BODY
            if n <= 0 or n > body_cap:
                raise ValueError("empty or oversized request body")
            payload = validate_payload(json.loads(self.rfile.read(n)), profile)
            system, prompt, max_tokens = payload["system"], payload["prompt"], payload["max_tokens"]

            kwargs = dict(
                modelId=(CHARACTER_MODEL if profile == "character-v1" else MODEL_ID),
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": max_tokens, "temperature": payload.get("temperature", TEMPERATURE)},
            )
            if system.strip():
                kwargs["system"] = [{"text": system}]

            t0 = _time.time()
            try:
                resp = bedrock_client().converse(**kwargs)
            except Exception:
                # A long-lived cached client can hold stale credentials; rebuild once and retry so the
                # proxy self-heals without a manual restart (still fails cleanly if the creds are truly gone).
                global _client
                _client = None
                resp = bedrock_client().converse(**kwargs)
            text = "".join(
                block.get("text", "")
                for block in resp["output"]["message"]["content"]
            ).strip()
            LOG.info("ok profile=%s model=%s prompt_chars=%d max_tokens=%d reply_chars=%d %.1fs",
                     profile, kwargs["modelId"], len(prompt), max_tokens, len(text), _time.time() - t0)
            self._send(200, {"text": text})
        except (ValueError, TypeError) as exc:
            LOG.warning("invalid request: %s", str(exc)[:200])
            self._send(400, {"error": "invalid_request", "detail": str(exc)[:100]})
        except Exception as exc:  # proxy is fail-soft; the browser falls back to the authored line
            LOG.error("model_unavailable: %s: %s", type(exc).__name__, str(exc)[:300])
            self._send(502, {"error": "model_unavailable"})

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
