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
        for spec in ["painter=ollama:x", "character=openai:gpt", "character=ollama:", "character"]:
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

if __name__ == '__main__': unittest.main()
