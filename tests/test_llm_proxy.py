"""Offline request-handler tests; no sockets, credentials, or boto3 calls."""
import contextlib
import importlib.util
import io
import json
import logging
import os
import subprocess
import sys
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from unittest import mock

SERVER = Path(__file__).resolve().parents[1] / "server"
sys.path.insert(0, str(SERVER))
import llm_backends  # noqa: E402
import local_origins  # noqa: E402

spec = importlib.util.spec_from_file_location("llm_proxy", SERVER / "llm_proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)
QUIET = logging.getLogger("llm_proxy.tests")   # keep test requests out of the live logs/proxy.log
QUIET.addHandler(logging.NullHandler())
QUIET.propagate = False

class Client:
    """A fake Bedrock runtime client."""
    def __init__(self): self.calls = []
    def converse(self, **kwargs):
        self.calls.append(kwargs)
        return {"output": {"message": {"content": [{"text": '{"variant":"direct"}'}]}}}

class FakeBackend:
    def __init__(self): self.calls = []
    def complete(self, model, system, prompt, max_tokens, temperature):
        self.calls.append(model)
        return '{"verdict":"pass"}'

class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.client = Client()
        bedrock = llm_backends.Bedrock("us-west-2")
        bedrock._client = self.client
        self.ollama = FakeBackend()
        proxy.BACKENDS = {"bedrock": bedrock, "ollama": self.ollama}
        proxy.ROUTES = llm_backends.parse_routes(None)
        patcher = mock.patch.object(proxy, "LOG", QUIET)
        patcher.start()
        self.addCleanup(patcher.stop)
    def handler(self, origin="http://localhost:8000", host=None, payload=None):
        h = object.__new__(proxy.Handler)
        h.headers = Message()
        h.headers["Host"] = host or f"localhost:{proxy.PORT}"
        h.headers["Origin"] = origin
        h.headers["X-Living-Mystery"] = "dialogue-v2"
        h.headers["Content-Type"] = "application/json"
        body = json.dumps(payload if payload is not None else {"system": "Select", "prompt": "Approved variants", "max_tokens": 80}).encode()
        h.headers["Content-Length"] = str(len(body))
        h.rfile = io.BytesIO(body)
        h.path = "/"
        h.results = []
        h._send = lambda status, body: h.results.append((status, body))
        return h
    def test_safe_default_origins_are_preserved(self):
        self.assertEqual(proxy.ALLOWED_ORIGINS, {
            "http://127.0.0.1:8000",
            "http://localhost:8000",
        })

    def test_allowed_origin_parser_accepts_explicit_local_http_ports(self):
        self.assertEqual(
            local_origins.parse_allowed_origins(" http://LOCALHOST:8000,http://127.0.0.1:9000,http://[::1]:7000 "),
            frozenset({"http://localhost:8000", "http://127.0.0.1:9000", "http://[::1]:7000"}),
        )

    def test_allowed_origin_parser_writes_port_80_as_browsers_send_it(self):
        self.assertEqual(local_origins.parse_allowed_origins("http://localhost:80,HTTP://127.0.0.1:80,http://[::1]:80"),
                         frozenset({"http://localhost", "http://127.0.0.1", "http://[::1]"}))
        self.assertEqual(local_origins.allowed_hosts(80),
                         frozenset({"127.0.0.1:80", "localhost:80", "127.0.0.1", "localhost"}))
        self.assertEqual(local_origins.allowed_hosts(8787), frozenset({"127.0.0.1:8787", "localhost:8787"}))

    def test_the_proxy_uses_the_shared_parser(self):
        self.assertIs(proxy.parse_allowed_origins, local_origins.parse_allowed_origins)
        self.assertEqual(proxy.ALLOWED_HOSTS, local_origins.allowed_hosts(proxy.PORT))

    def test_importing_the_origin_parser_constructs_no_backend(self):
        code = ("import sys; sys.path.insert(0, sys.argv[1]); import local_origins; "
                "print(sorted(m for m in ('llm_backends', 'llm_proxy', 'boto3', 'botocore') if m in sys.modules))")
        out = subprocess.run([sys.executable, "-c", code, str(SERVER)], check=True, capture_output=True, text=True)
        self.assertEqual(out.stdout.strip(), "[]")

    def test_allowed_origin_parser_rejects_public_and_malformed_origins(self):
        invalid = [
            "https://localhost:8000", "http://unrelated.example:8000", "http://10.0.0.5:8000",
            "http://user@localhost:8000", "http://localhost", "http://localhost:0",
            "http://localhost:65536", "http://localhost:8000/", "http://localhost:8000/path",
            "http://localhost:8000?query", "http://localhost:8000#fragment", "localhost:8000",
            "http://::1:8000", "*", "null", "", "http://localhost:8000,",
        ]
        for origin in invalid:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                local_origins.parse_allowed_origins(origin)

    def test_game_request_reaches_model(self):
        h = self.handler();h.do_POST()
        self.assertEqual(h.results[0][0], 200)
        self.assertEqual(len(self.client.calls), 1)
    def test_foreign_null_and_missing_origins_are_rejected(self):
        for origin in ["https://unrelated.example", "null", ""]:
            h = self.handler(origin);h.do_POST();self.assertEqual(h.results[0][0], 403)
        self.assertEqual(self.client.calls, [])
    def test_host_and_header_checks(self):
        h = self.handler(host=f"unrelated.example:{proxy.PORT}");h.do_POST();self.assertEqual(h.results[0][0],403)
        h = self.handler();del h.headers["X-Living-Mystery"];h.do_POST();self.assertEqual(h.results[0][0],403)
        self.assertEqual(self.client.calls, [])
    def test_health_requires_an_allowed_host_but_not_an_origin(self):
        h = self.handler();h.path = "/health";del h.headers["Origin"];h.do_GET()
        self.assertEqual(h.results[0][0], 200)
        h = self.handler(host=f"unrelated.example:{proxy.PORT}");h.path = "/health";h.do_GET()
        self.assertEqual(h.results[0][0], 403)
    def test_health_advertises_the_character_prompt_cap(self):
        # the morning director fits its prompt to this (dist/morning-director.mjs)
        h = self.handler();h.path = "/health";h.do_GET()
        self.assertEqual(h.results[0][1]["max_prompt_chars"], proxy.CHARACTER_FIELD_CAP)
        payload = {"system": "s", "prompt": "x" * proxy.CHARACTER_FIELD_CAP, "max_tokens": 10, "role": "director"}
        self.assertEqual(proxy.validate_payload(payload, "character-v1")["prompt"], payload["prompt"])
        with self.assertRaises(ValueError):
            proxy.validate_payload({**payload, "prompt": payload["prompt"] + "x"}, "character-v1")
    def test_invalid_payloads_fail_before_model(self):
        for payload in [[], {"prompt":"x"}, {"system":"x","prompt":"x","max_tokens":-1}, {"system":"x","prompt":"x","max_tokens":True}, {"system":"x","prompt":"x"*6001,"max_tokens":80}]:
            h=self.handler(payload=payload);h.do_POST();self.assertEqual(h.results[0][0],400)
        self.assertEqual(self.client.calls, [])
    def test_character_profile_has_separate_bounded_context_and_output_caps(self):
        payload={"system":"Character", "prompt":"x"*16000, "max_tokens":1200}
        h=self.handler(payload=payload);h.headers.replace_header("X-Living-Mystery","character-v1");h.do_POST()
        self.assertEqual(h.results[0][0],200)
        for field,value in [("prompt","x"*32001),("max_tokens",1501)]:
            h=self.handler(payload={**payload,field:value});h.headers.replace_header("X-Living-Mystery","character-v1");h.do_POST()
            self.assertEqual(h.results[0][0],400)
        h=self.handler(payload=payload);h.do_POST();self.assertEqual(h.results[0][0],400)

    def test_each_role_goes_to_its_route(self):
        proxy.ROUTES = llm_backends.parse_routes("checker=ollama:gemma4:26b")
        for role, local in [("character", False), ("checker", True), ("director", False)]:
            h=self.handler(payload={"system":"S","prompt":"P","max_tokens":100,"role":role})
            h.headers.replace_header("X-Living-Mystery","character-v1");h.do_POST()
            self.assertEqual(h.results[-1][0],200)
        self.assertEqual(self.ollama.calls, ["gemma4:26b"])
        self.assertEqual([c["modelId"] for c in self.client.calls], [llm_backends.BEDROCK_CHARACTER]*2)
    def test_a_profile_may_name_only_its_own_roles(self):
        h=self.handler(payload={"system":"S","prompt":"P","max_tokens":80,"role":"character"});h.do_POST()
        self.assertEqual(h.results[0][0],400)
        h=self.handler(payload={"system":"S","prompt":"P","max_tokens":80,"role":"anything"})
        h.headers.replace_header("X-Living-Mystery","character-v1");h.do_POST()
        self.assertEqual(h.results[0][0],400)
        self.assertEqual(self.client.calls, [])
    def test_backend_failure_is_a_502(self):
        proxy.ROUTES = llm_backends.parse_routes("dialogue=ollama:gemma4:26b")
        self.ollama.complete = mock.Mock(side_effect=llm_backends.BackendError("down"))
        h=self.handler();h.do_POST();self.assertEqual(h.results[0][0],502)
    def test_a_value_error_from_the_backend_is_the_models_failure_not_the_requests(self):
        proxy.ROUTES = llm_backends.parse_routes("dialogue=ollama:gemma4:26b")
        self.ollama.complete = mock.Mock(side_effect=ValueError("bad reply"))
        h=self.handler();h.do_POST();self.assertEqual(h.results[0][0],502)
    def test_a_truncated_body_is_refused_before_the_model(self):
        h=self.handler();h.rfile=io.BytesIO(h.rfile.getvalue()[:-3]);h.do_POST()
        self.assertEqual(h.results[0][0],400)
        self.assertEqual(self.client.calls, [])

    @contextlib.contextmanager
    def audit_file(self, path):
        proxy._AUDIT_FAILURE_REPORTED = False
        with mock.patch.dict(os.environ, {"LM_AUDIT_FILE": str(path)}):
            yield
        proxy._AUDIT_FAILURE_REPORTED = False

    def test_audit_records_hashes_and_metadata(self):
        with tempfile.TemporaryDirectory() as tmp, self.audit_file(Path(tmp) / "audit.jsonl"):
            h=self.handler();h.do_POST()
            row = json.loads((Path(tmp) / "audit.jsonl").read_text())
        self.assertEqual((h.results[0][0], row["status"], row["role"]), (200, "completed", "dialogue"))
        self.assertNotIn("Approved variants", json.dumps(row))
    def test_an_audit_write_failure_still_returns_the_reply(self):
        with tempfile.TemporaryDirectory() as tmp:
            blocker = Path(tmp) / "not-a-directory"
            blocker.write_text("")
            stderr = io.StringIO()
            with self.audit_file(blocker / "audit.jsonl"), contextlib.redirect_stderr(stderr):
                h=self.handler();h.do_POST()
                h2=self.handler();h2.do_POST()
                proxy.ROUTES = llm_backends.parse_routes("dialogue=ollama:gemma4:26b")
                self.ollama.complete = mock.Mock(side_effect=llm_backends.BackendError("down"))
                h3=self.handler();h3.do_POST()
        self.assertEqual([h.results[0], h2.results[0][0], h3.results[0][0]],
                         [(200, {"text": '{"variant":"direct"}'}), 200, 502])
        self.assertEqual(stderr.getvalue().count("LM_AUDIT_FILE"), 1, "reported once")
    def test_audit_of_a_failure_keeps_the_class_and_status_not_the_message(self):
        class ProviderError(Exception):
            response = {"ResponseMetadata": {"RequestId": "req-1", "HTTPStatusCode": 400},
                        "Error": {"Code": "ValidationException"}}
        proxy.ROUTES = llm_backends.parse_routes("dialogue=ollama:gemma4:26b")
        self.ollama.complete = mock.Mock(side_effect=ProviderError("the prompt said: Approved variants"))
        with tempfile.TemporaryDirectory() as tmp, self.audit_file(Path(tmp) / "audit.jsonl"):
            h=self.handler();h.do_POST()
            text = (Path(tmp) / "audit.jsonl").read_text()
        row = json.loads(text)
        self.assertEqual(h.results[0][0], 502)
        self.assertEqual(row["error"], {"type": "ProviderError", "http_status": 400})
        self.assertEqual((row["status"], row["bedrock_request_id"], row["http_status"]), ("failed", "req-1", 400))
        self.assertNotIn("Approved variants", text)
        self.assertNotIn("prompt said", text)

    def test_preflight_rejects_foreign_origin_and_host(self):
        h=self.handler("https://unrelated.example");h.headers["Access-Control-Request-Method"]="POST";h.do_OPTIONS()
        self.assertEqual(h.results[0][0],403)
        h=self.handler(host=f"unrelated.example:{proxy.PORT}");h.headers["Access-Control-Request-Method"]="POST";h.do_OPTIONS()
        self.assertEqual(h.results[0][0],403)
    def test_cors_is_not_wildcard(self):
        h=self.handler();headers={};h.send_header=lambda k,v:headers.update({k:v});h._cors()
        self.assertEqual(headers["Access-Control-Allow-Origin"],"http://localhost:8000")
        h=self.handler("https://unrelated.example");headers={};h.send_header=lambda k,v:headers.update({k:v});h._cors()
        self.assertNotIn("Access-Control-Allow-Origin",headers)

    def test_a_role_routed_to_a_hosted_api_reaches_it(self):
        api = FakeBackend()
        proxy.BACKENDS = {"bedrock": proxy.BACKENDS["bedrock"], "anthropic": api}
        proxy.ROUTES = llm_backends.parse_routes("", "anthropic")
        h = self.handler(); h.do_POST()
        self.assertEqual(h.results[-1][0], 200)
        self.assertEqual(api.calls, ["claude-haiku-4-5-20251001"])

class RouteTests(unittest.TestCase):
    def test_defaults_keep_every_role_on_bedrock(self):
        routes = llm_backends.parse_routes("")
        self.assertEqual(set(routes), set(llm_backends.ROLES))
        self.assertTrue(all(r.backend == "bedrock" for r in routes.values()))
    def test_overrides_keep_colons_in_model_names(self):
        routes = llm_backends.parse_routes("character=ollama:gemma4:26b, checker=bedrock:us.x.model-v1:0")
        self.assertEqual(str(routes["character"]), "ollama:gemma4:26b")
        self.assertEqual(routes["checker"].model, "us.x.model-v1:0")
        self.assertEqual(routes["director"].backend, "bedrock")
    def test_turn_timeout_is_longer_for_local_characters(self):
        self.assertEqual(llm_backends.turn_timeout_ms(llm_backends.parse_routes("")), 45_000)
        self.assertEqual(llm_backends.turn_timeout_ms(llm_backends.parse_routes("checker=ollama:m")), 240_000)
        self.assertEqual(llm_backends.turn_timeout_ms(llm_backends.parse_routes("director=ollama:m")), 45_000)
    def test_bad_routes_are_refused(self):
        for spec in ["painter=ollama:x", "character=painter:gpt", "character=ollama:", "character"]:
            with self.assertRaises(ValueError): llm_backends.parse_routes(spec)

class OllamaTests(unittest.TestCase):
    def test_default_url_is_loopback(self):
        with mock.patch.dict(llm_backends.os.environ, {}, clear=True):
            backend = llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes("checker=ollama:m"))["ollama"]
        self.assertEqual(backend.url, "http://127.0.0.1:11434")

    def test_ollama_is_configured_only_when_a_route_uses_it(self):
        with mock.patch.dict(llm_backends.os.environ, {"OLLAMA_URL": "http://ollama.example:11434"}, clear=True), \
                mock.patch.object(llm_backends, "Ollama", wraps=llm_backends.Ollama) as ollama:
            backends = llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes(""))
            self.assertEqual(set(backends), {"bedrock"})
            ollama.assert_not_called()
            with self.assertRaises(ValueError):   # still strictly validated once a route uses it
                llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes("character=ollama:m"))
        with mock.patch.dict(llm_backends.os.environ, {"LM_ROUTES": "character=ollama:m"}, clear=True):
            self.assertEqual(set(llm_backends.backends_from_env("us-west-2")), {"bedrock", "ollama"})

    def test_accepts_only_root_local_http_urls(self):
        accepted = {
            "http://127.0.0.1:11434": "http://127.0.0.1:11434",
            "https://localhost:11434/": "https://localhost:11434",
            "http://[::1]:11434": "http://[::1]:11434",
        }
        for url, expected in accepted.items():
            with self.subTest(url=url):
                self.assertEqual(llm_backends.Ollama(url, 8192, 60, "5m").url, expected)

    def test_rejects_public_or_malformed_urls(self):
        invalid = [
            "http://10.0.0.5:11434", "http://ollama.example:11434", "ftp://localhost:11434",
            "http://user@localhost:11434", "http://localhost:11434/api", "http://localhost:11434/api/",
            "http://localhost:11434?query", "http://localhost:11434#fragment", "http://localhost:65536",
            "http://::1:11434", "localhost:11434", "", " http://localhost:11434",
        ]
        for url in invalid:
            with self.subTest(url=url), self.assertRaises(ValueError):
                llm_backends.Ollama(url, 8192, 60, "5m")

    def test_transport_ignores_proxies_and_refuses_redirects(self):
        with mock.patch.object(llm_backends.urllib.request, "build_opener",
                               wraps=llm_backends.urllib.request.build_opener) as build_opener:
            o = llm_backends.Ollama("http://127.0.0.1:11434", 8192, 60, "5m")
        configured_handlers = build_opener.call_args.args
        proxy_handlers = [h for h in configured_handlers if isinstance(h, llm_backends.urllib.request.ProxyHandler)]
        self.assertEqual(len(proxy_handlers), 1)
        self.assertEqual(proxy_handlers[0].proxies, {})
        redirect_handlers = [h for h in o._opener.handlers if isinstance(h, llm_backends._NoRedirectHandler)]
        self.assertEqual(len(redirect_handlers), 1)
        self.assertIsNone(redirect_handlers[0].redirect_request(None, None, 302, "Found", {}, "http://example.com"))

    def test_request_turns_thinking_off(self):
        req = llm_backends.Ollama("http://127.0.0.1:11434", 8192, 60, "5m").request("gemma4:26b", "Sys", "Hi", 300, 0.5)
        self.assertEqual(req["messages"], [{"role": "system", "content": "Sys"}, {"role": "user", "content": "Hi"}])
        self.assertEqual((req["think"], req["stream"]), (False, False))
        self.assertEqual(req["options"], {"num_ctx": 8192, "num_predict": 300, "temperature": 0.5})
    def test_reply_and_failures(self):
        o = llm_backends.Ollama("http://127.0.0.1:11434", 8192, 60, "5m")
        reply = mock.MagicMock(); reply.__enter__.return_value.read.return_value = b'{"message":{"content":" {} "}}'
        with mock.patch.object(o._opener, "open", return_value=reply):
            self.assertEqual(o.complete("m", "s", "p", 10, 0.1), "{}")
        reply.__enter__.return_value.read.return_value = b'{"message":{"content":""}}'
        with mock.patch.object(o._opener, "open", return_value=reply):
            with self.assertRaises(llm_backends.BackendError): o.complete("m", "s", "p", 10, 0.1)
        err = llm_backends.urllib.error.URLError("refused")
        with mock.patch.object(o._opener, "open", side_effect=err):
            with self.assertRaises(llm_backends.BackendError): o.complete("m", "s", "p", 10, 0.1)
    def test_unreadable_replies_are_backend_errors(self):
        o = llm_backends.Ollama("http://127.0.0.1:11434", 8192, 60, "5m")
        for raw in [b'{"message":{"content":"\xff\xfe"}}', b'\xff\xfe', b'not json', b'[1, 2]', b'"text"',
                    b'{"message":"text"}', b'{"message":{"content":7}}', b'{}']:
            reply = mock.MagicMock(); reply.__enter__.return_value.read.return_value = raw
            with self.subTest(raw=raw), mock.patch.object(o._opener, "open", return_value=reply):
                with self.assertRaises(llm_backends.BackendError): o.complete("m", "s", "p", 10, 0.1)
        reply = mock.MagicMock(); reply.__enter__.return_value.read.side_effect = ConnectionResetError()
        with mock.patch.object(o._opener, "open", return_value=reply):
            with self.assertRaises(llm_backends.BackendError): o.complete("m", "s", "p", 10, 0.1)


def _reply(status, body):
    """A fake urllib response (status 200) or HTTPError (any other status) carrying a JSON body."""
    raw = json.dumps(body).encode() if not isinstance(body, bytes) else body
    if status != 200:
        return llm_backends.urllib.error.HTTPError("https://api.example/x", status, "error", Message(), io.BytesIO(raw))
    reply = mock.MagicMock(); reply.__enter__.return_value.read.return_value = raw; reply.__enter__.return_value.status = 200
    return reply


class FakeApi:
    """Replays replies in order and records each request (URL, headers, JSON body)."""
    def __init__(self, *replies): self.replies, self.requests = list(replies), []
    def __call__(self, req, timeout=None):
        self.requests.append({"url": req.full_url, "headers": {k.lower(): v for k, v in req.header_items()},
                              "body": json.loads(req.data)})
        r = self.replies.pop(0)
        if isinstance(r, BaseException): raise r
        return r


KEY = "sk-ant-test-0123456789abcdefghijklmnop"


class ProviderRouteTests(unittest.TestCase):
    def test_a_provider_moves_every_role_with_its_own_models(self):
        anthropic = llm_backends.parse_routes("", "anthropic")
        self.assertTrue(all(r.backend == "anthropic" for r in anthropic.values()))
        self.assertEqual(anthropic["character"].model, "claude-sonnet-4-5-20250929")
        self.assertEqual(anthropic["dialogue"].model, "claude-haiku-4-5-20251001")
        openai = llm_backends.parse_routes("checker=bedrock:us.m", "OpenAI")
        self.assertEqual(openai["character"].backend, "openai")
        self.assertEqual(openai["checker"], llm_backends.Route("bedrock", "us.m"))
        with self.assertRaises(ValueError): llm_backends.parse_routes("", "gemini")
    def test_routes_from_env_read_the_provider_and_the_overrides(self):
        with mock.patch.dict(llm_backends.os.environ, {"LM_PROVIDER": "openai", "LM_ROUTES": "dialogue=anthropic:claude-x"}, clear=True):
            routes = llm_backends.routes_from_env()
        self.assertEqual(str(routes["dialogue"]), "anthropic:claude-x")
        self.assertEqual(routes["director"].backend, "openai")
    def test_turn_timeouts(self):
        with mock.patch.dict(llm_backends.os.environ, {}, clear=True):
            self.assertEqual(llm_backends.turn_timeout_ms(llm_backends.parse_routes("", "anthropic")), 45_000)
            self.assertEqual(llm_backends.turn_timeout_ms(llm_backends.parse_routes("", "openai")), 90_000)
        with mock.patch.dict(llm_backends.os.environ, {"OPENAI_BASE_URL": "http://127.0.0.1:1234/v1"}, clear=True):
            self.assertEqual(llm_backends.turn_timeout_ms(llm_backends.parse_routes("", "openai")), 240_000)

class ProviderConfigTests(unittest.TestCase):
    def test_keys_are_required_only_when_a_route_uses_the_provider(self):
        with mock.patch.dict(llm_backends.os.environ, {}, clear=True):
            self.assertEqual(set(llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes(""))), {"bedrock"})
            with self.assertRaisesRegex(ValueError, "ANTHROPIC_API_KEY"):
                llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes("", "anthropic"))
            with self.assertRaisesRegex(ValueError, "OPENAI_API_KEY"):
                llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes("", "openai"))
        with mock.patch.dict(llm_backends.os.environ, {"ANTHROPIC_API_KEY": KEY}, clear=True):
            b = llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes("", "anthropic"))
            self.assertIsInstance(b["anthropic"], llm_backends.Anthropic)
        with mock.patch.dict(llm_backends.os.environ, {"ANTHROPIC_API_KEY": KEY + "\nx-evil: 1"}, clear=True):
            with self.assertRaisesRegex(ValueError, "whitespace"):
                llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes("", "anthropic"))
    def test_a_local_openai_compatible_server_needs_no_key(self):
        with mock.patch.dict(llm_backends.os.environ, {"OPENAI_BASE_URL": "http://localhost:1234/v1"}, clear=True):
            b = llm_backends.backends_from_env("us-west-2", llm_backends.parse_routes("", "openai"))["openai"]
        self.assertEqual(b.base_url, "http://localhost:1234/v1")
    def test_base_urls_are_https_or_loopback(self):
        for url in ["https://api.openai.com/v1/", "https://gateway.example/openai", "http://127.0.0.1:8080/v1"]:
            with self.subTest(url=url): llm_backends.OpenAI("k", url)
        for url in ["http://api.openai.com/v1", "https://user:pw@api.example/v1", "https://api.example/v1?x=1",
                    "ftp://api.example", "", " https://api.example", "https://"]:
            with self.subTest(url=url), self.assertRaises(ValueError): llm_backends.OpenAI("k", url)
    def test_the_transport_refuses_redirects(self):
        b = llm_backends.Anthropic(KEY)
        self.assertTrue(any(isinstance(h, llm_backends._NoRedirectHandler) for h in b._opener.handlers))

class AnthropicTests(unittest.TestCase):
    def setUp(self):
        self.api = llm_backends.Anthropic(KEY)
        patcher = mock.patch.object(llm_backends.time, "sleep"); patcher.start(); self.addCleanup(patcher.stop)
    def run_with(self, *replies):
        fake = FakeApi(*replies)
        with mock.patch.object(self.api._opener, "open", side_effect=fake):
            result = self.api.complete_with_metadata("claude-m", "Sys", "Hi", 300, 0.85)
        return result, fake.requests
    def test_request_shape_headers_and_reply(self):
        result, reqs = self.run_with(_reply(200, {"model": "claude-m", "usage": {"input_tokens": 3},
            "content": [{"type": "thinking", "thinking": "..."}, {"type": "text", "text": " {\"ok\":1} "}]}))
        self.assertEqual(result["text"], '{"ok":1}')
        self.assertEqual(reqs[0]["url"], "https://api.anthropic.com/v1/messages")
        self.assertEqual(reqs[0]["headers"]["x-api-key"], KEY)
        self.assertEqual(reqs[0]["headers"]["anthropic-version"], "2023-06-01")
        self.assertEqual(reqs[0]["body"], {"model": "claude-m", "max_tokens": 300, "system": "Sys", "temperature": 0.85,
                                           "messages": [{"role": "user", "content": "Hi"}]})
    def test_a_rejected_temperature_is_dropped_and_remembered(self):
        refusal = _reply(400, {"type": "error", "error": {"type": "invalid_request_error", "message": "temperature is not supported for this model"}})
        result, reqs = self.run_with(refusal, _reply(200, {"content": [{"type": "text", "text": "ok"}]}))
        self.assertEqual(result["text"], "ok")
        self.assertNotIn("temperature", reqs[1]["body"])
        self.assertNotIn("temperature", self.api.request("claude-m", "s", "p", 10, .5))
        self.assertIn("temperature", self.api.request("other", "s", "p", 10, .5))
    def test_a_reply_used_up_by_thinking_is_asked_again_with_room(self):
        result, reqs = self.run_with(_reply(200, {"stop_reason": "max_tokens", "content": [{"type": "thinking", "thinking": "..."}]}),
                                     _reply(200, {"content": [{"type": "text", "text": "ok"}]}))
        self.assertEqual(reqs[1]["body"]["max_tokens"], 300 + llm_backends.Anthropic.HEADROOM)
    def test_rate_limits_are_retried(self):
        result, reqs = self.run_with(_reply(429, {"error": {"message": "slow down"}}), _reply(529, {}),
                                     _reply(200, {"content": [{"type": "text", "text": "ok"}]}))
        self.assertEqual((result["text"], result["sdk_retry_attempts"], len(reqs)), ("ok", 2, 3))
    def test_failures_name_the_setting_and_never_the_key(self):
        cases = [(_reply(401, {"error": {"message": f"invalid x-api-key {KEY}"}}), "ANTHROPIC_API_KEY"),
                 (_reply(404, {"error": {"message": "model: claude-m"}}), "LM_ANTHROPIC_MODEL"),
                 (_reply(400, {"error": {"message": f"bad request {KEY}"}}), "HTTP 400"),
                 (_reply(200, {"content": []}), "empty"),
                 (llm_backends.urllib.error.URLError("refused"), "cannot reach")]
        for reply, expected in cases:
            with self.subTest(expected=expected):
                replies = [reply] * 3 if isinstance(reply, BaseException) else [reply]
                with self.assertRaises(llm_backends.BackendError) as ctx: self.run_with(*replies)
                self.assertIn(expected, str(ctx.exception))
                self.assertNotIn(KEY, str(ctx.exception))

class OpenAITests(unittest.TestCase):
    def setUp(self):
        self.api = llm_backends.OpenAI("sk-proj-test0123456789abcdef", reasoning_effort="low")
        patcher = mock.patch.object(llm_backends.time, "sleep"); patcher.start(); self.addCleanup(patcher.stop)
    def run_with(self, *replies, api=None):
        api = api or self.api
        fake = FakeApi(*replies)
        with mock.patch.object(api._opener, "open", side_effect=fake):
            result = api.complete_with_metadata("gpt-m", "Sys", "Hi", 300, 0.85)
        return result, fake.requests
    def ok(self, text="ok", finish="stop"):
        return _reply(200, {"model": "gpt-m-2026", "choices": [{"finish_reason": finish, "message": {"content": text}}]})
    def test_request_shape_and_reply(self):
        result, reqs = self.run_with(self.ok(" {} "))
        self.assertEqual((result["text"], result["effective_serving_model"]), ("{}", "gpt-m-2026"))
        self.assertEqual(reqs[0]["url"], "https://api.openai.com/v1/chat/completions")
        self.assertEqual(reqs[0]["headers"]["authorization"], "Bearer sk-proj-test0123456789abcdef")
        self.assertEqual(reqs[0]["body"], {"model": "gpt-m", "max_completion_tokens": 300, "temperature": 0.85,
            "reasoning_effort": "low", "messages": [{"role": "system", "content": "Sys"}, {"role": "user", "content": "Hi"}]})
    def test_rejected_parameters_are_dropped_or_renamed_and_remembered(self):
        temp = _reply(400, {"error": {"message": "Unsupported value: 'temperature' does not support 0.85 with this model.", "param": "temperature"}})
        effort = _reply(400, {"error": {"message": "Unrecognized request argument supplied: reasoning_effort"}})
        limit = _reply(400, {"error": {"message": "Unsupported parameter: 'max_completion_tokens'", "param": "max_completion_tokens"}})
        result, reqs = self.run_with(temp, effort, limit, self.ok())
        self.assertEqual(reqs[-1]["body"], {"model": "gpt-m", "max_tokens": 300,
            "messages": [{"role": "system", "content": "Sys"}, {"role": "user", "content": "Hi"}]})
        _, again = self.run_with(self.ok())
        self.assertEqual(again[0]["body"], reqs[-1]["body"], "the model's rejections are remembered")
    def test_an_unrelated_bad_request_is_not_retried(self):
        with self.assertRaises(llm_backends.BackendError): self.run_with(_reply(400, {"error": {"message": "context too long"}}))
    def test_a_reply_used_up_by_reasoning_is_asked_again_with_room(self):
        result, reqs = self.run_with(self.ok("", "length"), self.ok("done"))
        self.assertEqual(reqs[1]["body"]["max_completion_tokens"], 300 + llm_backends.OpenAI.HEADROOM)
        self.assertEqual(result["text"], "done")
    def test_content_parts_and_a_keyless_local_server(self):
        local = llm_backends.OpenAI("", "http://127.0.0.1:1234/v1", reasoning_effort="")
        parts = _reply(200, {"choices": [{"message": {"content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}}]})
        result, reqs = self.run_with(parts, api=local)
        self.assertEqual(result["text"], "ab")
        self.assertNotIn("authorization", reqs[0]["headers"])
        self.assertNotIn("reasoning_effort", reqs[0]["body"])
    def test_failures_name_the_setting_and_never_the_key(self):
        for status, expected in [(401, "OPENAI_API_KEY"), (404, "LM_OPENAI_MODEL")]:
            with self.subTest(status=status), self.assertRaises(llm_backends.BackendError) as ctx:
                self.run_with(_reply(status, {"error": {"message": "Incorrect API key provided: sk-proj-test0123456789abcdef"}}))
            self.assertIn(expected, str(ctx.exception)); self.assertNotIn("sk-proj-test0123456789abcdef", str(ctx.exception))
        with self.assertRaises(llm_backends.BackendError) as ctx:
            self.run_with(_reply(500, {"error": {"message": "oops sk-proj-test0123456789abcdef"}}), _reply(500, {}), _reply(500, {"error": {"message": "sk-proj-test0123456789abcdef"}}))
        self.assertNotIn("sk-proj-test0123456789abcdef", str(ctx.exception))

if __name__ == '__main__': unittest.main()

