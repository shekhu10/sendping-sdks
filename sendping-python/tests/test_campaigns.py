import sendping

from .helpers import RecordingTestCase


class TestCampaigns(RecordingTestCase):
    def test_create_domain_first(self):
        params = {
            "domain": "acme.com",
            "from": "Acme <hello@acme.com>",
            "subject": "Launch",
            "html": "<p>New!</p>",
            "segment_id": "seg_1",
        }
        sendping.Campaigns.create(params)
        self.assertCall("POST", "/campaigns", params)

    def test_get(self):
        sendping.Campaigns.get("cmp_1")
        self.assertCall("GET", "/campaigns/cmp_1")

    def test_list_pagination(self):
        sendping.Campaigns.list({"limit": 25, "after": "cmp_9"})
        self.assertCall("GET", "/campaigns?limit=25&after=cmp_9")

    def test_update(self):
        sendping.Campaigns.update("cmp_1", {"subject": "New subject"})
        self.assertCall("PATCH", "/campaigns/cmp_1", {"subject": "New subject"})

    def test_send_now_defaults_to_empty_body(self):
        sendping.Campaigns.send("cmp_1")
        self.assertCall("POST", "/campaigns/cmp_1/send", {})

    def test_send_scheduled(self):
        sendping.Campaigns.send("cmp_1", {"scheduled_at": "2026-08-01T09:00:00Z"})
        self.assertCall(
            "POST", "/campaigns/cmp_1/send", {"scheduled_at": "2026-08-01T09:00:00Z"}
        )

    def test_cancel(self):
        sendping.Campaigns.cancel("cmp_1")
        self.assertCall("POST", "/campaigns/cmp_1/cancel")

    def test_stats(self):
        sendping.Campaigns.stats("cmp_1")
        self.assertCall("GET", "/campaigns/cmp_1/stats")

    def test_engagement(self):
        sendping.Campaigns.engagement("cmp_1")
        self.assertCall("GET", "/campaigns/cmp_1/engagement")

    def test_ab(self):
        sendping.Campaigns.ab("cmp_1")
        self.assertCall("GET", "/campaigns/cmp_1/ab")

    def test_remove(self):
        sendping.Campaigns.remove("cmp_1")
        self.assertCall("DELETE", "/campaigns/cmp_1")
