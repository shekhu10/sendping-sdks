import sendping

from .helpers import RecordingTestCase


class TestDomains(RecordingTestCase):
    def test_create(self):
        params = {"name": "acme.com", "capabilities": {"receiving": "enabled"}}
        sendping.Domains.create(params)
        self.assertCall("POST", "/domains", params)

    def test_get(self):
        sendping.Domains.get("dom_1")
        self.assertCall("GET", "/domains/dom_1")

    def test_list(self):
        sendping.Domains.list({"limit": 10})
        self.assertCall("GET", "/domains?limit=10")

    def test_update(self):
        sendping.Domains.update("dom_1", {"click_tracking": True})
        self.assertCall("PATCH", "/domains/dom_1", {"click_tracking": True})

    def test_verify(self):
        sendping.Domains.verify("dom_1")
        self.assertCall("POST", "/domains/dom_1/verify")

    def test_claim_flow(self):
        sendping.Domains.claim({"name": "acme.com"})
        self.assertCall("POST", "/domains/claim", {"name": "acme.com"})
        sendping.Domains.get_claim("dom_1")
        self.assertCall("GET", "/domains/dom_1/claim")
        sendping.Domains.verify_claim("dom_1")
        self.assertCall("POST", "/domains/dom_1/claim/verify")

    def test_dns_providers(self):
        sendping.Domains.detect_dns("dom_1")
        self.assertCall("GET", "/domains/dom_1/dns/detect")
        sendping.Domains.apply_cloudflare_dns("dom_1", {"token": "cf_tok"})
        self.assertCall("POST", "/domains/dom_1/dns/cloudflare", {"token": "cf_tok"})
        sendping.Domains.apply_godaddy_dns("dom_1", {"key": "k", "secret": "s"})
        self.assertCall("POST", "/domains/dom_1/dns/godaddy", {"key": "k", "secret": "s"})
        sendping.Domains.apply_namecheap_dns("dom_1", {"apiUser": "u", "apiKey": "k"})
        self.assertCall("POST", "/domains/dom_1/dns/namecheap", {"apiUser": "u", "apiKey": "k"})

    def test_mx_check(self):
        sendping.Domains.mx_check("acme.com")
        self.assertCall("GET", "/domains/mx-check?name=acme.com")

    def test_records_csv_is_binary(self):
        data = sendping.Domains.records_csv("dom_1")
        self.assertEqual(self.last["path"], "/domains/dom_1/records.csv")
        self.assertEqual(self.last["method"], "GET")
        self.assertTrue(self.last.get("raw"))
        self.assertEqual(data, self.raw_response)

    def test_remove_escapes_id(self):
        sendping.Domains.remove("dom_x/../../admin")
        self.assertCall("DELETE", "/domains/dom_x%2F..%2F..%2Fadmin")
