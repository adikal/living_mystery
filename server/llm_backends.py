"""Model backends for the language-model proxy, and the routing of each in-game role to one of them.

Every in-game model call has a *role* (who is asking, and for what). The proxy maps each role to a *route*, a backend
and a model, so that, for example, the characters can run on a local open-weight model while the director stays on
Bedrock. A backend has one method:

    complete(model, system, prompt, max_tokens, temperature) -> text

Routes come from the environment, as comma-separated ``role=backend:model`` pairs; roles not named keep the defaults:

    LM_ROUTES="character=ollama:gemma4:26b,checker=ollama:gemma4:26b"

LM_PROVIDER picks the backend every role defaults to (bedrock, anthropic or openai; default bedrock), with that
provider's default models; LM_ROUTES then overrides single roles.

Backends:
    bedrock   Amazon Bedrock's Converse API (credentials from the standard AWS chain)
    anthropic the Claude API (Messages), with ANTHROPIC_API_KEY; ANTHROPIC_BASE_URL (default https://api.anthropic.com)
              for a gateway. Default models: the ones the game was tuned on (LM_ANTHROPIC_MODEL, LM_ANTHROPIC_FAST_MODEL)
    openai    the OpenAI API (Chat Completions), with OPENAI_API_KEY; OPENAI_BASE_URL (default https://api.openai.com/v1)
              for any OpenAI-compatible service, or a local server on loopback (which needs no key). Default model
              LM_OPENAI_MODEL (and LM_OPENAI_FAST_MODEL); LM_OPENAI_REASONING_EFFORT (default low; empty to omit)
    ollama    a local Ollama server (OLLAMA_URL, default http://127.0.0.1:11434); loopback only, and configured only
              when some route uses it (OLLAMA_NUM_CTX, OLLAMA_TIMEOUT, OLLAMA_KEEP_ALIVE)

The anthropic and openai backends are configured, and their keys read, only when some route uses them. A key is sent
only in the request header to its own provider's base URL (redirects are refused) and never logged or returned.
Parameters a model rejects (a custom temperature, a reasoning effort, the newer token-limit name) are dropped and the
request retried, and remembered for that model; a reasoning model that spends the whole token budget thinking is asked
once more with room to answer.
"""
from __future__ import annotations

import http.client
import json
import os
import re
import threading
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
BACKEND_NAMES = ("bedrock", "anthropic", "openai", "ollama")
# The models each provider's roles default to: (the 'dialogue' styling role, every other role). Anthropic's are the
# models the game was tuned on (the same as on Bedrock); OpenAI's is a fast, inexpensive general model.
PROVIDER_MODELS = {
    "bedrock": (BEDROCK_FAST, BEDROCK_CHARACTER),
    "anthropic": (os.environ.get("LM_ANTHROPIC_FAST_MODEL", "claude-haiku-4-5-20251001"),
                  os.environ.get("LM_ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")),
    "openai": (os.environ.get("LM_OPENAI_FAST_MODEL", os.environ.get("LM_OPENAI_MODEL", "gpt-6-luna")),
               os.environ.get("LM_OPENAI_MODEL", "gpt-6-luna")),
}


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


_KEY_LIKE = re.compile(r"(sk-[A-Za-z0-9_\-]{6,}|[A-Za-z0-9_\-]{32,})")


def _redact(text) -> str:
    """A provider's error message, safe to log: anything that looks like a key is masked."""
    return _KEY_LIKE.sub("[redacted]", str(text or ""))[:200]


def _api_base_url(url: str, name: str) -> str:
    """A provider root URL: HTTPS anywhere, or plain HTTP to a loopback server; no credentials, query or fragment."""
    if not url or url != url.strip() or any(char.isspace() for char in url) or "?" in url or "#" in url:
        raise ValueError(f"{name} must be an https:// URL (or http:// on loopback)")
    try:
        parsed = urlparse(url)
        parsed.port
    except ValueError as exc:
        raise ValueError(f"{name} is malformed") from exc
    loopback = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if (parsed.scheme.lower() not in ("https",) + (("http",) if loopback else ())
            or not parsed.hostname or parsed.username is not None or parsed.password is not None
            or parsed.params or parsed.query or parsed.fragment):
        raise ValueError(f"{name} must be an https:// URL (or http:// on loopback)")
    return url.rstrip("/")


def _api_key(name: str, required: bool = True) -> str:
    key = os.environ.get(name, "").strip()
    if required and not key:
        raise ValueError(f"{name} is not set: export it in the terminal that starts the proxy")
    if any(char.isspace() or ord(char) < 32 for char in key):
        raise ValueError(f"{name} contains whitespace or control characters")
    return key


class _HttpApi:
    """JSON over HTTPS to a hosted model API, with retries for rate limits and transient failures. Proxies from the
    environment (HTTPS_PROXY) are honoured; redirects are refused, so a key never follows one."""
    name = "api"
    RETRY = {408, 409, 429, 500, 502, 503, 504, 529}

    def __init__(self, base_url: str, timeout: float):
        self.base_url, self.timeout = base_url, timeout
        self._opener = urllib.request.build_opener(_NoRedirectHandler())
        self._dropped: dict[str, set[str]] = {}   # per model: request parameters it rejected
        self._lock = threading.Lock()

    def dropped(self, model: str) -> set[str]:
        with self._lock:
            return set(self._dropped.get(model, ()))

    def drop(self, model: str, param: str) -> None:
        with self._lock:
            self._dropped.setdefault(model, set()).add(param)

    def post(self, path: str, body: dict, headers: dict) -> tuple[int, dict | None, int]:
        """(HTTP status, JSON reply or None, retries used). Raises BackendError when the API cannot be reached."""
        data = json.dumps(body).encode()
        for attempt in range(3):
            req = urllib.request.Request(self.base_url + path, data=data, method="POST",
                                         headers={"content-type": "application/json", **headers})
            try:
                with self._opener.open(req, timeout=self.timeout) as resp:
                    return resp.status, self._json(resp.read()), attempt
            except urllib.error.HTTPError as exc:
                try:
                    raw = exc.read()
                except (OSError, http.client.HTTPException):
                    raw = b""
                if exc.code in self.RETRY and attempt < 2:
                    time.sleep(self._backoff(exc.headers, attempt))
                    continue
                return exc.code, self._json(raw), attempt
            except (OSError, http.client.HTTPException) as exc:   # URLError and timeouts are OSErrors
                if attempt < 2:
                    time.sleep(0.6 * (attempt + 1))
                    continue
                raise BackendError(f"{self.name}: cannot reach {urlparse(self.base_url).hostname} ({type(exc).__name__})") from exc
        raise BackendError(f"{self.name}: no reply")

    @staticmethod
    def _backoff(headers, attempt: int) -> float:
        try:
            return min(5.0, max(0.0, float((headers or {}).get("retry-after", ""))))
        except (TypeError, ValueError):
            return 0.8 * (attempt + 1)

    @staticmethod
    def _json(raw: bytes):
        try:
            value = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def failure(self, status: int, reply, model: str, key_name: str, model_setting: str) -> BackendError:
        error = (reply or {}).get("error")
        message = error.get("message") if isinstance(error, dict) else error
        if status in (401, 403):
            return BackendError(f"{self.name}: the API key was refused (HTTP {status}); check {key_name}")
        if status == 404:
            return BackendError(f"{self.name}: model {model!r} was not found (HTTP 404); choose another with {model_setting}")
        return BackendError(f"{self.name}: HTTP {status}: {_redact(message)}")

    @staticmethod
    def mentions(reply, param: str) -> bool:
        error = (reply or {}).get("error")
        if not isinstance(error, dict):
            return False
        return error.get("param") == param or param in str(error.get("message", ""))


class Anthropic(_HttpApi):
    """The Claude API's Messages endpoint. The API version is pinned, so the request shape stays the one tested."""
    name = "anthropic"
    VERSION = "2023-06-01"
    HEADROOM = 4096   # extra tokens for a model that thinks before it answers

    def __init__(self, key: str, base_url: str = "https://api.anthropic.com", timeout: float = 45):
        super().__init__(_api_base_url(base_url, "ANTHROPIC_BASE_URL"), timeout)
        self._key = key

    def request(self, model, system, prompt, max_tokens, temperature):
        body = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
        if system.strip():
            body["system"] = system
        if "temperature" not in self.dropped(model):
            body["temperature"] = temperature
        return body

    def complete_with_metadata(self, model, system, prompt, max_tokens, temperature):
        body, retries, roomy = self.request(model, system, prompt, max_tokens, temperature), 0, False
        for _ in range(4):
            status, reply, used = self.post("/v1/messages", body, {"x-api-key": self._key, "anthropic-version": self.VERSION})
            retries += used
            if status == 400 and "temperature" in body and self.mentions(reply, "temperature"):
                self.drop(model, "temperature")   # newer models accept only their own sampling
                body.pop("temperature")
                continue
            if status != 200 or reply is None:
                raise self.failure(status, reply, model, "ANTHROPIC_API_KEY", "LM_ANTHROPIC_MODEL")
            content = reply.get("content") if isinstance(reply.get("content"), list) else []
            text = "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
                           and isinstance(b.get("text"), str)).strip()
            if not text and reply.get("stop_reason") == "max_tokens" and not roomy:
                body, roomy = {**body, "max_tokens": max_tokens + self.HEADROOM}, True
                continue
            if not text:
                raise BackendError("anthropic: empty reply")
            return {"text": text, "usage": reply.get("usage"), "bedrock_request_id": None, "http_status": status,
                    "sdk_retry_attempts": retries, "effective_serving_model": reply.get("model")}
        raise BackendError("anthropic: the request was refused after adjusting it")

    def complete(self, model, system, prompt, max_tokens, temperature):
        return self.complete_with_metadata(model, system, prompt, max_tokens, temperature)["text"]


class OpenAI(_HttpApi):
    """OpenAI's Chat Completions, which OpenAI-compatible services and local servers also offer."""
    name = "openai"
    HEADROOM = 4096
    ADJUSTABLE = ("temperature", "reasoning_effort", "max_completion_tokens")

    def __init__(self, key: str, base_url: str = "https://api.openai.com/v1", reasoning_effort: str = "low",
                 timeout: float = 45):
        super().__init__(_api_base_url(base_url, "OPENAI_BASE_URL"), timeout)
        self._key, self.reasoning_effort = key, reasoning_effort

    def request(self, model, system, prompt, max_tokens, temperature):
        dropped = self.dropped(model)
        body = {"model": model, "messages": ([{"role": "system", "content": system}] if system.strip() else [])
                + [{"role": "user", "content": prompt}]}
        # the newer token-limit name, or the older one for a service that does not know it
        body["max_tokens" if "max_completion_tokens" in dropped else "max_completion_tokens"] = max_tokens
        if "temperature" not in dropped:
            body["temperature"] = temperature
        if self.reasoning_effort and "reasoning_effort" not in dropped:
            body["reasoning_effort"] = self.reasoning_effort
        return body

    def rejected(self, reply, body) -> str | None:
        """The parameter a 400 reply rejects, when it is one the request can do without."""
        error = (reply or {}).get("error")
        if not isinstance(error, dict):
            return None
        if error.get("param") in self.ADJUSTABLE and error.get("param") in body:
            return error["param"]
        message = str(error.get("message", "")).lower()
        if any(w in message for w in ("unsupported", "not supported", "unrecognized", "unknown", "invalid", "does not support")):
            return next((p for p in self.ADJUSTABLE if p in message and p in body), None)
        return None

    def complete_with_metadata(self, model, system, prompt, max_tokens, temperature):
        headers = {"authorization": f"Bearer {self._key}"} if self._key else {}
        body, retries, roomy = self.request(model, system, prompt, max_tokens, temperature), 0, False
        for _ in range(5):
            status, reply, used = self.post("/chat/completions", body, headers)
            retries += used
            param = self.rejected(reply, body) if status == 400 else None
            if param:
                self.drop(model, param)
                limit = body.pop(param)
                if param == "max_completion_tokens":
                    body["max_tokens"] = limit
                continue
            if status != 200 or reply is None:
                raise self.failure(status, reply, model, "OPENAI_API_KEY", "LM_OPENAI_MODEL")
            choices = reply.get("choices") if isinstance(reply.get("choices"), list) else []
            choice = choices[0] if choices and isinstance(choices[0], dict) else {}
            message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
            content = message.get("content")
            if isinstance(content, list):   # some compatible services return parts
                content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
            text = content.strip() if isinstance(content, str) else ""
            if not text and choice.get("finish_reason") == "length" and not roomy:
                limit = "max_tokens" if "max_tokens" in body else "max_completion_tokens"
                body, roomy = {**body, limit: body[limit] + self.HEADROOM}, True
                continue
            if not text:
                raise BackendError("openai: empty reply")
            return {"text": text, "usage": reply.get("usage"), "bedrock_request_id": None, "http_status": status,
                    "sdk_retry_attempts": retries, "effective_serving_model": reply.get("model")}
        raise BackendError("openai: the request was refused after adjusting it")

    def complete(self, model, system, prompt, max_tokens, temperature):
        return self.complete_with_metadata(model, system, prompt, max_tokens, temperature)["text"]


@dataclass(frozen=True)
class Route:
    backend: str
    model: str

    def __str__(self):
        return f"{self.backend}:{self.model}"


def parse_routes(spec: str | None, provider: str | None = None) -> dict[str, Route]:
    """Routes for every role: the provider's defaults (Bedrock unless named), overridden by ``role=backend:model``
    pairs."""
    provider = (provider or "bedrock").strip().lower()
    if provider not in PROVIDER_MODELS:
        raise ValueError(f"Bad LM_PROVIDER {provider!r}: expected one of {', '.join(PROVIDER_MODELS)}")
    fast, main = PROVIDER_MODELS[provider]
    routes = {role: Route(provider, fast if role == "dialogue" else main) for role in ROLES}
    for pair in filter(None, (p.strip() for p in (spec or "").split(","))):
        role, _, target = pair.partition("=")
        backend, _, model = target.partition(":")
        if role not in ROLES or backend not in BACKEND_NAMES or not model:
            raise ValueError(f"Bad route {pair!r}: expected role=backend:model, role one of {', '.join(ROLES)}, "
                             f"backend one of {', '.join(BACKEND_NAMES)}")
        routes[role] = Route(backend, model)
    return routes


def routes_from_env() -> dict[str, Route]:
    """The routes the environment asks for: LM_PROVIDER's defaults, overridden by LM_ROUTES."""
    return parse_routes(os.environ.get("LM_ROUTES"), os.environ.get("LM_PROVIDER"))


def _local_openai() -> bool:
    try:
        return urlparse(os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")).hostname in ("127.0.0.1", "localhost", "::1")
    except ValueError:
        return False


def turn_timeout_ms(routes: dict[str, Route]) -> int:
    """How long the game should wait for a whole character turn (up to three replies, each checked). Local models are
    several times slower than Bedrock on this hardware, so a turn routed to one gets longer, and OpenAI's reasoning
    models think before they answer; LM_TURN_TIMEOUT_MS overrides."""
    if os.environ.get("LM_TURN_TIMEOUT_MS"):
        return int(os.environ["LM_TURN_TIMEOUT_MS"])
    used = {routes[r].backend for r in ("character", "checker")}
    if "ollama" in used or ("openai" in used and _local_openai()):
        return 240_000
    return 90_000 if "openai" in used else 45_000


def backends_from_env(region: str, routes: dict[str, Route] | None = None) -> dict:
    """The backends ``routes`` use (default: LM_PROVIDER and LM_ROUTES). Ollama, Anthropic and OpenAI, with their URLs
    and keys, are configured and validated only when some route sends a role to them."""
    routes = routes_from_env() if routes is None else routes
    used = {route.backend for route in routes.values()}
    backends = {"bedrock": Bedrock(region)}
    if "anthropic" in used:
        backends["anthropic"] = Anthropic(_api_key("ANTHROPIC_API_KEY"),
                                          os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com"))
    if "openai" in used:
        base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
        backends["openai"] = OpenAI(_api_key("OPENAI_API_KEY", required=not _local_openai()), base,
                                    os.environ.get("LM_OPENAI_REASONING_EFFORT", "low").strip())
    if any(route.backend == "ollama" for route in routes.values()):
        backends["ollama"] = Ollama(os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"),
                                    num_ctx=int(os.environ.get("OLLAMA_NUM_CTX", "16384")),
                                    timeout=float(os.environ.get("OLLAMA_TIMEOUT", "120")),
                                    keep_alive=os.environ.get("OLLAMA_KEEP_ALIVE", "30m"))
    return backends
