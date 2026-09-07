"""Offline request-handler tests; no sockets, credentials, or boto3 calls."""
import importlib.util
import io
import json
import unittest
from email.message import Message
from pathlib import Path

spec = importlib.util.spec_from_file_location("llm_proxy", Path(__file__).resolve().parents[1] / "server" / "llm_proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)

class Client:
    def __init__(self): self.calls = []
    def converse(self, **kwargs):
        self.calls.append(kwargs)
        return {"output": {"message": {"content": [{"text": '{"variant":"direct"}'}]}}}

class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.client = Client()
        proxy._client = self.client
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
    def test_preflight_rejects_foreign_origin(self):
        h=self.handler("https://unrelated.example");h.headers["Access-Control-Request-Method"]="POST";h.do_OPTIONS()
        self.assertEqual(h.results[0][0],403)
    def test_cors_is_not_wildcard(self):
        h=self.handler();headers={};h.send_header=lambda k,v:headers.update({k:v});h._cors()
        self.assertEqual(headers["Access-Control-Allow-Origin"],"http://localhost:8000")
        h=self.handler("https://unrelated.example");headers={};h.send_header=lambda k,v:headers.update({k:v});h._cors()
        self.assertNotIn("Access-Control-Allow-Origin",headers)

if __name__ == '__main__': unittest.main()
