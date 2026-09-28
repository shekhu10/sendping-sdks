import http.client
import http.server
import io
import json
from pathlib import Path
import threading
import unittest
import urllib.error
from unittest import mock

import sendping
from sendping import http_client
from sendping.exceptions import SendPingError
from .test_http_client import FakeResponse


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        sendping.api_key = "mb_test"
        sendping.base_url = "http://127.0.0.1"
        sendping.max_retries = 2
        self.addCleanup(setattr, sendping, "api_key", None)
        self.addCleanup(setattr, sendping, "base_url", None)
        self.addCleanup(setattr, sendping, "max_retries", None)

    def test_shared_recovery_corpus(self):
        local = (Path(__file__).parent / "fixtures/http-recovery-corpus.json").read_text()
        shared = Path(__file__).parents[2] / "scripts/http-recovery-corpus.json"
        if shared.is_file():
            self.assertEqual(local, shared.read_text(), "Refresh the package corpus from scripts/http-recovery-corpus.json")
        cases = json.loads(local)
        for case in cases:
            with self.subTest(case=case["name"]):
                calls = []
                def respond(req, **kwargs):
                    calls.append(req)
                    if case.get("key"):
                        self.assertEqual(req.get_header("Idempotency-key"), case["key"])
                    if len(calls) == 1:
                        raise urllib.error.HTTPError(req.full_url, case["status"], "failure", {"Retry-After": "0"}, io.BytesIO(json.dumps(case["body"]).encode()))
                    return FakeResponse(b'{"id":"em_retry"}')
                with mock.patch.object(http_client._opener, "open", side_effect=respond), mock.patch("time.sleep"):
                    if case["attempts"] == 1:
                        with self.assertRaises(SendPingError) as caught:
                            http_client.request(case["method"], case["path"], {}, {"idempotency_key": case.get("key")})
                        self.assertEqual(caught.exception.status_code, case["status"])
                    else:
                        http_client.request(case["method"], case["path"], {}, {"idempotency_key": case.get("key")})
                self.assertEqual(len(calls), case["attempts"])

    def test_direct_timeout_and_truncated_reads_keep_sdk_error(self):
        for error in (TimeoutError("read timed out"), http.client.IncompleteRead(b"partial", 20)):
            for raw in (False, True):
                with mock.patch.object(http_client._opener, "open", side_effect=error) as opened:
                    with self.assertRaises(SendPingError) as caught:
                        (http_client.request_raw if raw else http_client.request)("GET", "/domains")
                    self.assertEqual(caught.exception.name, "network_error")
                    self.assertEqual(opened.call_count, 1)

    def test_error_body_read_failure_closes_response(self):
        body = mock.Mock()
        body.read.side_effect = TimeoutError("error response stalled")
        error = urllib.error.HTTPError("http://127.0.0.1", 503, "failure", {}, body)
        with mock.patch.object(http_client._opener, "open", side_effect=error):
            with self.assertRaises(SendPingError): http_client.request("POST", "/emails", {})
        body.close.assert_called_once()

    def test_redirect_never_forwards_credentials(self):
        seen = []
        class Target(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(self.headers.get("Authorization"))
                self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
            def log_message(self, *args): pass
        target = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Target)
        class Origin(Target):
            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{target.server_port}/target")
                self.end_headers()
        origin = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Origin)
        for server in (target, origin): threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            sendping.base_url = f"http://127.0.0.1:{origin.server_port}"
            with self.assertRaises(SendPingError) as caught: sendping.Domains.list()
            self.assertEqual(caught.exception.status_code, 302)
            self.assertEqual(seen, [])
        finally:
            for server in (origin, target): server.shutdown(); server.server_close()

    def test_reply_forward_health_and_recovery_metadata(self):
        seen = []
        def respond(req, **kwargs):
            seen.append(req)
            return FakeResponse(b'{"custom_host":null,"status":"shared","checked_at":"2026-09-10T00:00:00Z"}')
        with mock.patch.object(http_client._opener, "open", side_effect=respond):
            sendping.Emails.Receiving.reply("rcv_one", {"text": "a  b\n\n c"}, {"idempotency_key": "reply-1"})
            sendping.Emails.Receiving.forward("rcv_one", {}, {"idempotency_key": "forward-1"})
            self.assertEqual(sendping.Domains.tracking_health("domain one")["status"], "shared")
        self.assertEqual(seen[0].get_header("Idempotency-key"), "reply-1")
        self.assertEqual(seen[1].get_header("Idempotency-key"), "forward-1")
        self.assertTrue(seen[2].full_url.endswith("/domains/domain%20one/tracking-health"))
        self.assertEqual(json.loads(seen[0].data)["text"], "a  b\n\n c")
        error = http_client._error_from(422, b'{"statusCode":503,"id":"em_one","reserved":[{"id":"em_one"}],"unsent_count":0}')
        self.assertEqual((error.status_code, error.id, error.reserved, error.unsent_count), (422, "em_one", [{"id":"em_one"}], 0))
