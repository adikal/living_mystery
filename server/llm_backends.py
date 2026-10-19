"""Model backends for the language-model proxy, and the routing of each in-game role to one of them.

Every in-game model call has a *role* (who is asking, and for what). The proxy maps each role to a *route*, a backend
and a model, so that, for example, the characters can run on a local open-weight model while the director stays on
Bedrock. A backend has one method:

    complete(model, system, prompt, max_tokens, temperature) -> text

Routes come from the environment, as comma-separated ``role=backend:model`` pairs; roles not named keep the defaults:

    LM_ROUTES="character=ollama:gemma4:26b,checker=ollama:gemma4:26b"

Backends:
    bedrock   Amazon Bedrock's Converse API (credentials from the standard AWS chain)
    ollama    a local Ollama server (OLLAMA_URL, default http://127.0.0.1:11434); loopback only, and configured only
              when some route uses it (OLLAMA_NUM_CTX, OLLAMA_TIMEOUT, OLLAMA_KEEP_ALIVE)
"""
from __future__ import annotations

import http.client
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlparse

import boto3
from botocore.config import Config

# The roles of in-game calls. 'dialogue' is the older styling profile; the rest are character-v1 calls.
ROLES = ("dialogue", "character", "checker", "director", "line_critic", "autonomy")
BEDROCK_FAST = os.environ.get("LM_BEDROCK_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
BEDROCK_CHARACTER = os.environ.get("LM_CHARACTER_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
DEFAULT_ROUTES = {"dialogue": ("bedrock", BEDROCK_FAST),
                  **{role: ("bedrock", BEDROCK_CHARACTER) for role in ROLES if role != "dialogue"}}


class BackendError(RuntimeError):
    """The model could not be reached or gave no usable reply; the game falls back to an authored line."""


class Bedrock:
    TRANSIENT = {"InternalServerException", "ServiceUnavailableException", "ThrottlingException",
                 "ModelNotReadyException"}

    def __init__(self, region: str):
        self.region, self._client = region, None

    def client(self):
        if self._client is None:
            # a fresh Session re-reads the credentials file (the default session caches expired keys)
            self._client = boto3.Session().client("bedrock-runtime", region_name=self.region, config=Config(
                connect_timeout=3, read_timeout=30, retries={"max_attempts": 0}))
        return self._client

    def complete_with_metadata(self, model, system, prompt, max_tokens, temperature):
        """Return text plus provider metadata; ``complete`` keeps the historical text-only interface."""
        kwargs = dict(modelId=model, messages=[{"role": "user", "content": [{"text": prompt}]}],
                      inferenceConfig={"maxTokens": max_tokens, "temperature": temperature})
        if system.strip():
            kwargs["system"] = [{"text": system}]
        for attempt in range(3):
            try:
                resp = self.client().converse(**kwargs)
                break
            except Exception as exc:
                code = ((getattr(exc, "response", None) or {}).get("Error") or {}).get("Code", "")
                if code in self.TRANSIENT and attempt < 2:
                    time.sleep(0.6 * (attempt + 1))
                    continue
                if attempt == 0:
                    self._client = None
                    continue
                raise
        metadata = resp.get("ResponseMetadata") or {}
        return {
            "text": "".join(block.get("text", "") for block in resp["output"]["message"]["content"]).strip(),
            "usage": resp.get("usage"),
            "bedrock_request_id": metadata.get("RequestId"),
            "http_status": metadata.get("HTTPStatusCode"),
            "sdk_retry_attempts": metadata.get("RetryAttempts"),
            "effective_serving_model": None,
        }

    def complete(self, model, system, prompt, max_tokens, temperature):
        return self.complete_with_metadata(model, system, prompt, max_tokens, temperature)["text"]


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Keep a validated loopback request from being redirected elsewhere."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Ollama:
    """A local Ollama server. The model's thinking mode is off: it adds latency, and the game's critics, not the model,
    do the checking. Replies are not constrained to JSON (Ollama does not offer structured output for every model);
    the game parses them loosely and asks again, with the reason, when a reply is not the JSON object it asked for."""

    def __init__(self, url: str, num_ctx: int, timeout: float, keep_alive: str):
        if not url or url != url.strip() or any(char.isspace() for char in url) or "?" in url or "#" in url:
            raise ValueError("OLLAMA_URL must be a local HTTP or HTTPS root URL")
        try:
            parsed = urlparse(url)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("OLLAMA_URL is malformed") from exc
        if (parsed.scheme.lower() not in ("http", "https")
                or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment
                or port == 0):
            raise ValueError("OLLAMA_URL must be a local HTTP or HTTPS root URL")
        host = f"[{parsed.hostname}]" if parsed.hostname == "::1" else parsed.hostname
        authority = f"{host}:{port}" if port is not None else host
        self.url = f"{parsed.scheme.lower()}://{authority}"
        self.num_ctx, self.timeout, self.keep_alive = num_ctx, timeout, keep_alive
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirectHandler())

    def request(self, model, system, prompt, max_tokens, temperature):
        messages = ([{"role": "system", "content": system}] if system.strip() else []) + \
                   [{"role": "user", "content": prompt}]
        return {"model": model, "messages": messages, "stream": False, "think": False,
                "keep_alive": self.keep_alive,
                "options": {"num_ctx": self.num_ctx, "num_predict": max_tokens, "temperature": temperature}}

    def complete(self, model, system, prompt, max_tokens, temperature):
        body = json.dumps(self.request(model, system, prompt, max_tokens, temperature)).encode()
        req = urllib.request.Request(self.url + "/api/chat", data=body, headers={"content-type": "application/json"})
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except (OSError, http.client.HTTPException) as exc:   # URLError and timeouts are OSErrors
            raise BackendError(f"ollama: {exc}") from exc
        try:
            reply = json.loads(raw.decode("utf-8"))
        except ValueError as exc:                               # invalid UTF-8 or not JSON
            raise BackendError("ollama: reply is not UTF-8 JSON") from exc
        if not isinstance(reply, dict):
            raise BackendError("ollama: reply is not a JSON object")
        message = reply.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        text = content.strip() if isinstance(content, str) else ""
        if not text:
            raise BackendError("ollama: empty reply")
        return text


@dataclass(frozen=True)
class Route:
    backend: str
    model: str

    def __str__(self):
        return f"{self.backend}:{self.model}"


def parse_routes(spec: str | None) -> dict[str, Route]:
    """Routes for every role: the defaults, overridden by ``role=backend:model`` pairs."""
    routes = {role: Route(*r) for role, r in DEFAULT_ROUTES.items()}
    for pair in filter(None, (p.strip() for p in (spec or "").split(","))):
        role, _, target = pair.partition("=")
        backend, _, model = target.partition(":")
        if role not in ROLES or backend not in ("bedrock", "ollama") or not model:
            raise ValueError(f"Bad route {pair!r}: expected role=backend:model, role one of {', '.join(ROLES)}")
        routes[role] = Route(backend, model)
    return routes


def turn_timeout_ms(routes: dict[str, Route]) -> int:
    """How long the game should wait for a whole character turn (up to three replies, each checked). Local models are
    several times slower than Bedrock on this hardware, so a turn routed to one gets longer; LM_TURN_TIMEOUT_MS
    overrides."""
    if os.environ.get("LM_TURN_TIMEOUT_MS"):
        return int(os.environ["LM_TURN_TIMEOUT_MS"])
    return 240_000 if any(routes[r].backend != "bedrock" for r in ("character", "checker")) else 45_000


def backends_from_env(region: str, routes: dict[str, Route] | None = None) -> dict:
    """The backends ``routes`` use (default: LM_ROUTES). Ollama, and with it OLLAMA_URL, is configured and validated
    only when some route sends a role to it."""
    routes = parse_routes(os.environ.get("LM_ROUTES")) if routes is None else routes
    backends = {"bedrock": Bedrock(region)}
    if any(route.backend == "ollama" for route in routes.values()):
        backends["ollama"] = Ollama(os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"),
                                    num_ctx=int(os.environ.get("OLLAMA_NUM_CTX", "16384")),
                                    timeout=float(os.environ.get("OLLAMA_TIMEOUT", "120")),
                                    keep_alive=os.environ.get("OLLAMA_KEEP_ALIVE", "30m"))
    return backends
