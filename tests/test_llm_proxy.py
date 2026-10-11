"""Offline request-handler tests; no sockets, credentials, or boto3 calls."""
import importlib.util
import io
import json
import sys
import unittest
from email.message import Message
from pathlib import Path
from unittest import mock

SERVER = Path(__file__).resolve().parents[1] / "server"
sys.path.insert(0, str(SERVER))
import llm_backends  # noqa: E402

spec = importlib.util.spec_from_file_location("llm_proxy", SERVER / "llm_proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)

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

    def test_preflight_rejects_foreign_origin(self):
        h=self.handler("https://unrelated.example");h.headers["Access-Control-Request-Method"]="POST";h.do_OPTIONS()
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
    def test_must_be_loopback(self):
        with self.assertRaises(ValueError): llm_backends.Ollama("http://10.0.0.5:11434", 8192, 60, "5m")
    def test_request_turns_thinking_off(self):
        req = llm_backends.Ollama("http://127.0.0.1:11434", 8192, 60, "5m").request("gemma4:26b", "Sys", "Hi", 300, 0.5)
        self.assertEqual(req["messages"], [{"role": "system", "content": "Sys"}, {"role": "user", "content": "Hi"}])
        self.assertEqual((req["think"], req["stream"]), (False, False))
        self.assertEqual(req["options"], {"num_ctx": 8192, "num_predict": 300, "temperature": 0.5})
    def test_reply_and_failures(self):
        o = llm_backends.Ollama("http://127.0.0.1:11434", 8192, 60, "5m")
        reply = mock.MagicMock(); reply.__enter__.return_value.read.return_value = b'{"message":{"content":" {} "}}'
        with mock.patch.object(llm_backends.urllib.request, "urlopen", return_value=reply):
            self.assertEqual(o.complete("m", "s", "p", 10, 0.1), "{}")
        reply.__enter__.return_value.read.return_value = b'{"message":{"content":""}}'
        with mock.patch.object(llm_backends.urllib.request, "urlopen", return_value=reply):
            with self.assertRaises(llm_backends.BackendError): o.complete("m", "s", "p", 10, 0.1)
        err = llm_backends.urllib.error.URLError("refused")
        with mock.patch.object(llm_backends.urllib.request, "urlopen", side_effect=err):
            with self.assertRaises(llm_backends.BackendError): o.complete("m", "s", "p", 10, 0.1)

if __name__ == '__main__': unittest.main()
