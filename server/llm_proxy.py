#!/usr/bin/env python3
"""Loopback-only model proxy for Living Mystery's optional AI dialogue (Bedrock, or a local open-weight model).

The game is a static site, so the browser must not hold AWS credentials. This proxy holds them, calls the model each
request's role is routed to (``llm_backends``), and returns text. It never changes game state. It is a development
server: it binds to loopback and checks Host, Origin and a custom header, which restricts browser pages but is not
authentication against local programs. Do not expose it.

Request contract
    POST /   with headers
        Host               127.0.0.1:<port> or localhost:<port> (the proxy's own port; anything else is 403)
        Origin             one of LM_ALLOWED_ORIGINS (403 otherwise; CORS echoes only an allowed origin)
        X-Living-Mystery   the request profile: dialogue-v2 (role 'dialogue') or character-v1 (roles character,
                           checker, director, line_critic, autonomy; the first is the default)
        Content-Type       application/json
    and a JSON object body with exactly
        system, prompt     non-empty strings (at most 6,000 characters each; 32,000 for character-v1)
        max_tokens         an integer from 1 to 512 (1,500 for character-v1)
        temperature        optional, a number from 0 to 1 (default LM_TEMPERATURE)
        role               optional, one of the profile's roles
    The body is at most 20,000 bytes (128,000 for character-v1).
    -> 200 {"text": "..."}   400 {"error": "invalid_request", ...}   403 {"error": "origin_not_allowed"}
       502 {"error": "model_unavailable"} (the game falls back to an authored line)
    GET /health (Host checked, no Origin needed) -> routes, region, temperature and turn timeout.
    Each connection's socket reads and writes time out after Handler.timeout seconds, so a client that declares a body
    and stalls cannot hold a thread; the model call itself is not a socket operation on that connection and is bounded
    by its backend's own timeouts.

Environment
    LM_PROXY_HOST       bind address, 127.0.0.1 (default) or localhost; anything else is refused
    LM_PROXY_PORT       default 8787
    LM_ALLOWED_ORIGINS  comma-separated explicit local game origins (local_origins.py); default
                        http://127.0.0.1:8000,http://localhost:8000
    LM_ROUTES           role=backend:model pairs, e.g. character=ollama:gemma4:26b (default: every role on Bedrock)
    LM_BEDROCK_MODEL    Bedrock model for 'dialogue' (default us.anthropic.claude-haiku-4-5-20251001-v1:0)
    LM_CHARACTER_MODEL  Bedrock model for the character-v1 roles (default us.anthropic.claude-sonnet-4-5-20250929-v1:0)
    LM_TEMPERATURE      default temperature, 0.7
    LM_TURN_TIMEOUT_MS  the character-turn timeout /health advertises (default 45 s; 240 s with a local character or
                        checker)
    AWS_REGION, AWS_DEFAULT_REGION   Bedrock region (default us-west-2); credentials come from the standard AWS chain
    OLLAMA_URL, OLLAMA_NUM_CTX, OLLAMA_TIMEOUT, OLLAMA_KEEP_ALIVE   the local Ollama backend, read only when a route
                        uses it; OLLAMA_URL must be a loopback root URL (default http://127.0.0.1:11434)
    LM_AUDIT_FILE       optional JSON-lines ledger of model calls: metadata and SHA-256 hashes of the prompts and reply,
                        never their text; failures record the exception class and HTTP status, not its message. A
                        failure to write it is reported once on stderr and never affects the response.
Logs go to logs/proxy.log.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import sys
import threading
import time as _time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from llm_backends import ROLES, backends_from_env, parse_routes, turn_timeout_ms
from local_origins import DEFAULT_ALLOWED_ORIGINS, allowed_hosts, parse_allowed_origins

REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-west-2"
ROUTES = parse_routes(os.environ.get("LM_ROUTES"))
BACKENDS = backends_from_env(REGION, ROUTES)
PROFILE_ROLES = {"dialogue-v2": ("dialogue",), "character-v1": tuple(r for r in ROLES if r != "dialogue")}
HOST = os.environ.get("LM_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("LM_PROXY_PORT", "8787"))
TEMPERATURE = float(os.environ.get("LM_TEMPERATURE", "0.7"))

_MAX_BODY = 20_000
_MAX_FIELD = 6_000
_MAX_TOKENS_CAP = 512
SOCKET_TIMEOUT = 30   # seconds per socket read or write on a client connection

ALLOWED_ORIGINS = parse_allowed_origins(os.environ.get("LM_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS))
ALLOWED_HOSTS = allowed_hosts(PORT)
if HOST not in ("127.0.0.1", "localhost"):
    raise ValueError("This development proxy must bind to loopback")
_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(_LOG_DIR, exist_ok=True)
LOG = logging.getLogger("proxy")
_h = logging.FileHandler(os.path.join(_LOG_DIR, "proxy.log"))
_h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
LOG.addHandler(_h)
LOG.setLevel(logging.INFO)
_AUDIT_LOCK = threading.Lock()
_AUDIT_FAILURE_REPORTED = False


def _utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _sha256(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _audit(record):
    """Append one record to LM_AUDIT_FILE. A write failure is reported once on stderr and otherwise ignored: the audit
    must never cost the player a reply, nor raise inside an error handler."""
    global _AUDIT_FAILURE_REPORTED
    path = os.environ.get("LM_AUDIT_FILE")
    if not path:
        return
    line = json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
    with _AUDIT_LOCK:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            with open(path, "a", encoding="utf-8") as handle:
                handle.write(line)
        except OSError as exc:
            if not _AUDIT_FAILURE_REPORTED:
                _AUDIT_FAILURE_REPORTED = True
                print(f"llm_proxy: cannot write LM_AUDIT_FILE ({type(exc).__name__}); audit records are being dropped",
                      file=sys.stderr, flush=True)


def _error_record(exc):
    """What the audit keeps of a failure: the exception class and the provider's HTTP status, never the message
    (which may echo the prompt)."""
    response = getattr(exc, "response", None)
    response = response if isinstance(response, dict) else {}
    metadata = response.get("ResponseMetadata") or {}
    return {"bedrock_request_id": metadata.get("RequestId"), "http_status": metadata.get("HTTPStatusCode"),
            "provider_error_code": (response.get("Error") or {}).get("Code"),
            "error": {"type": type(exc).__name__, "http_status": metadata.get("HTTPStatusCode")}}


def validate_payload(payload, profile="dialogue-v2"):
    field_cap = 32000 if profile == "character-v1" else _MAX_FIELD
    token_cap = 1500 if profile == "character-v1" else _MAX_TOKENS_CAP
    if not isinstance(payload, dict) or not {"system", "prompt", "max_tokens"} <= set(payload) <= {"system", "prompt", "max_tokens", "temperature", "role"}:
        raise ValueError("Expected system, prompt, max_tokens (optional temperature, role)")
    if payload.get("role", PROFILE_ROLES[profile][0]) not in PROFILE_ROLES[profile]:
        raise ValueError("Invalid role")
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
    timeout = SOCKET_TIMEOUT

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

    def _host_allowed(self):
        return self.headers.get("Host") in ALLOWED_HOSTS

    def _allowed(self):
        return self._host_allowed() and self.headers.get("Origin") in ALLOWED_ORIGINS

    def do_OPTIONS(self) -> None:
        if not self._allowed() or self.headers.get("Access-Control-Request-Method") != "POST":
            self._send(403, {"error": "origin_not_allowed"})
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if not self._host_allowed():
            self._send(403, {"error": "host_not_allowed"})
            return
        if self.path.rstrip("/") in ("", "/health"):
            self._send(200, {"ok": True, "routes": {role: str(r) for role, r in ROUTES.items()}, "region": REGION,
                             "temperature": TEMPERATURE, "turn_timeout_ms": turn_timeout_ms(ROUTES)})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if not self._allowed() or self.headers.get("X-Living-Mystery") not in PROFILE_ROLES:
            self._send(403, {"error": "origin_not_allowed"})
            return
        if self.path != "/" or self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            self._send(400, {"error": "invalid_request"})
            return
        profile = self.headers.get("X-Living-Mystery")
        # 1. the request: a socket timeout while reading the body propagates, and the server closes the connection
        try:
            n = int(self.headers.get("content-length", "0") or 0)
            body_cap = 128000 if profile == "character-v1" else _MAX_BODY
            if n <= 0 or n > body_cap:
                raise ValueError("empty or oversized request body")
            raw = self.rfile.read(n)
            if len(raw) != n:
                raise ValueError("truncated request body")
            payload = validate_payload(json.loads(raw), profile)
        except (ValueError, TypeError) as exc:
            LOG.warning("invalid request: %s", str(exc)[:200])
            self._send(400, {"error": "invalid_request", "detail": str(exc)[:100]})
            return
        # 2. the model call: any failure here is the model's, never the request's
        role = payload.get("role", PROFILE_ROLES[profile][0])
        route = ROUTES[role]
        temperature = payload.get("temperature", TEMPERATURE)
        audit = {"profile": profile, "role": role, "route": str(route), "backend": route.backend,
                 "requested_model": route.model, "effective_serving_model": "unknown", "region": REGION,
                 "inference_config": {"maxTokens": payload["max_tokens"], "temperature": temperature},
                 "prompt_hashes": {"system_sha256": _sha256(payload["system"]),
                                   "user_sha256": _sha256(payload["prompt"]),
                                   "combined_sha256": _sha256(payload["system"] + "\0" + payload["prompt"])},
                 "started_at": _utc_now()}
        t0 = _time.time()
        try:
            backend = BACKENDS[route.backend]
            if hasattr(backend, "complete_with_metadata"):
                result = backend.complete_with_metadata(route.model, payload["system"], payload["prompt"],
                                                        payload["max_tokens"], temperature)
                text = result["text"]
            else:
                text = backend.complete(route.model, payload["system"], payload["prompt"], payload["max_tokens"], temperature)
                result = {"usage": None, "bedrock_request_id": None, "http_status": None,
                          "sdk_retry_attempts": None, "effective_serving_model": None}
            if not isinstance(text, str):
                raise TypeError("backend returned no text")
        except Exception as exc:
            _audit({**audit, "finished_at": _utc_now(), "status": "failed", "usage": None, **_error_record(exc)})
            LOG.error("model_unavailable: %s: %s", type(exc).__name__, str(exc)[:300])
            self._send(502, {"error": "model_unavailable"})
            return
        elapsed = _time.time() - t0
        _audit({**audit, "finished_at": _utc_now(), "status": "completed", "seconds": round(elapsed, 6),
                "usage": result.get("usage"), "bedrock_request_id": result.get("bedrock_request_id"),
                "http_status": result.get("http_status"), "sdk_retry_attempts": result.get("sdk_retry_attempts"),
                "effective_serving_model": result.get("effective_serving_model") or "unknown", "response_sha256": _sha256(text)})
        LOG.info("ok profile=%s role=%s model=%s prompt_chars=%d max_tokens=%d reply_chars=%d %.1fs",
                 profile, role, route, len(payload["prompt"]), payload["max_tokens"], len(text), elapsed)
        self._send(200, {"text": text})

    def log_message(self, *args) -> None:
        pass


def main() -> None:
    print(f"Living Mystery model proxy → http://{HOST}:{PORT}  (region={REGION}, temp={TEMPERATURE})\n"
          + "\n".join(f"  {role:<12} {route}" for role, route in ROUTES.items()), flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
