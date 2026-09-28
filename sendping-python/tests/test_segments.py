import sendping

from .helpers import RecordingTestCase


class TestSegments(RecordingTestCase):
    def test_create_domain_required_in_body(self):
        params = {"domain": "acme.com", "name": "VIP", "filter": {"status": "subscribed"}}
        sendping.Segments.create(params)
        self.assertCall("POST", "/segments", params)

    def test_get(self):
        sendping.Segments.get("seg_1")
        self.assertCall("GET", "/segments/seg_1")

    def test_list_domain_scoped(self):
        sendping.Segments.list({"domain": "acme.com", "limit": 10, "after": "seg_9"})
        self.assertCall("GET", "/segments?domain=acme.com&limit=10&after=seg_9")

    def test_list_requires_domain(self):
        with self.assertRaises(KeyError):
            sendping.Segments.list({})

    def test_contacts_preview(self):
        sendping.Segments.contacts("seg_1")
        self.assertCall("GET", "/segments/seg_1/contacts")

    def test_contacts_preview_paginated(self):
        sendping.Segments.contacts("seg_1", {"limit": 100, "after": "con_9"})
        self.assertCall("GET", "/segments/seg_1/contacts?limit=100&after=con_9")

    def test_update(self):
        sendping.Segments.update("seg_1", {"name": "VIP+"})
        self.assertCall("PATCH", "/segments/seg_1", {"name": "VIP+"})

    def test_remove(self):
        sendping.Segments.remove("seg_1")
        self.assertCall("DELETE", "/segments/seg_1")


class TestTopics(RecordingTestCase):
    def test_create_domain_required_in_body(self):
        params = {"domain": "acme.com", "name": "Product updates", "default_subscription": "opt_in"}
        sendping.Topics.create(params)
        self.assertCall("POST", "/topics", params)

    def test_list_domain_scoped(self):
        sendping.Topics.list({"domain": "acme.com", "limit": 50})
        self.assertCall("GET", "/topics?domain=acme.com&limit=50")

    def test_get_update_remove(self):
        sendping.Topics.get("top_1")
        self.assertCall("GET", "/topics/top_1")
        sendping.Topics.update("top_1", {"visibility": "private"})
        self.assertCall("PATCH", "/topics/top_1", {"visibility": "private"})
        sendping.Topics.remove("top_1")
        self.assertCall("DELETE", "/topics/top_1")
