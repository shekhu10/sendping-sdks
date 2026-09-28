package co.sendping.tests;

import co.sendping.ListParams;
import co.sendping.SendPing;
import co.sendping.requests.CampaignAbTest;
import co.sendping.requests.CampaignFollowup;
import co.sendping.requests.CreateCampaignRequest;
import co.sendping.requests.CreateSegmentRequest;
import co.sendping.requests.CreateTopicRequest;
import co.sendping.requests.SegmentFilter;
import co.sendping.requests.UpdateCampaignRequest;
import co.sendping.requests.UpdateSegmentRequest;

/** Domain-first segments, topics, and campaigns. */
public final class SegmentsCampaignsTest {
    public static void run() {
        Check.suite("SegmentsCampaignsTest");
        StubTransport t = new StubTransport();
        SendPing mb = new SendPing("mb_test_key", "https://api.test", t);
        t.respond(200, "{\"id\":\"seg_1\"}");

        // --- segments: create requires domain in body ---
        mb.segments().create(CreateSegmentRequest.builder()
                .domain("example.com")
                .name("Pro users")
                .filter(SegmentFilter.builder()
                        .status("subscribed")
                        .propertyFilter("plan", "eq", "pro")
                        .build())
                .build());
        Check.eq("segment create url", "https://api.test/segments", t.lastUrl);
        Check.eq("segment create body",
                "{\"domain\":\"example.com\",\"name\":\"Pro users\",\"filter\":{\"status\":\"subscribed\","
                        + "\"property_filters\":[{\"key\":\"plan\",\"operator\":\"eq\",\"value\":\"pro\"}]}}",
                t.lastBody);

        // --- segments: members_only + the campaign-engagement predicate ---
        // Both are real server values (lib/contacts/segment_body.ts): status
        // accepts members_only, and `filter.engagement` narrows the segment to
        // one campaign's engagement.
        mb.segments().create(CreateSegmentRequest.builder()
                .domain("example.com")
                .name("Re-engage")
                .filter(SegmentFilter.builder()
                        .status("members_only")
                        .engagement("not_opened", "cmp_1")
                        .build())
                .build());
        Check.eq("segment engagement create body",
                "{\"domain\":\"example.com\",\"name\":\"Re-engage\",\"filter\":{\"status\":\"members_only\","
                        + "\"engagement\":{\"event\":\"not_opened\",\"campaign_id\":\"cmp_1\"}}}",
                t.lastBody);
        // Clearing needs an explicit null — an omitted key keeps the stored one.
        mb.segments().update("seg_1", UpdateSegmentRequest.builder()
                .filter(SegmentFilter.builder().clearEngagement().build()).build());
        Check.eq("segment clear engagement body",
                "{\"filter\":{\"engagement\":null}}", t.lastBody);

        // --- segments: list is domain-scoped ---
        mb.segments().list("example.com", ListParams.builder().limit(5).build());
        Check.eq("segment list url", "https://api.test/segments?domain=example.com&limit=5", t.lastUrl);
        mb.segments().contacts("seg_1");
        Check.eq("segment contacts url", "https://api.test/segments/seg_1/contacts", t.lastUrl);
        mb.segments().update("seg_1", UpdateSegmentRequest.builder().name("VIP").build());
        Check.eq("segment update method", "PATCH", t.lastMethod);
        mb.segments().remove("seg_1");
        Check.eq("segment remove method", "DELETE", t.lastMethod);

        // --- topics: domain-required create + list ---
        mb.topics().create(CreateTopicRequest.builder()
                .domain("example.com").name("Product updates").defaultSubscription("opt_in").build());
        Check.eq("topic create url", "https://api.test/topics", t.lastUrl);
        Check.contains("topic create body has domain", t.lastBody, "\"domain\":\"example.com\"");
        Check.contains("topic default_subscription", t.lastBody, "\"default_subscription\":\"opt_in\"");
        mb.topics().list("example.com");
        Check.eq("topic list url", "https://api.test/topics?domain=example.com", t.lastUrl);

        // --- campaigns: domain-first create with A/B + followups ---
        t.respond(200, "{\"id\":\"cmp_1\"}");
        mb.campaigns().create(CreateCampaignRequest.builder()
                .domain("example.com")
                .from("Acme <hi@example.com>")
                .subject("Launch")
                .html("<h1>Go</h1>")
                .segmentId("seg_1")
                .abTest(CampaignAbTest.builder().enabled(true).subjectB("Launch?!").testPct(30).metric("click").build())
                .followup(CampaignFollowup.builder()
                        .condition("not_opened").delay("2 days").html("<p>bump</p>").build())
                .unsubscribePolicy("domain")
                .build());
        Check.eq("campaign create url", "https://api.test/campaigns", t.lastUrl);
        Check.contains("campaign body has domain", t.lastBody, "\"domain\":\"example.com\"");
        Check.contains("campaign ab_test", t.lastBody,
                "\"ab_test\":{\"enabled\":true,\"subject_b\":\"Launch?!\",\"test_pct\":30,\"metric\":\"click\"}");
        Check.contains("campaign followups", t.lastBody,
                "\"followups\":[{\"condition\":\"not_opened\",\"delay\":\"2 days\",\"html\":\"<p>bump</p>\"}]");
        Check.contains("campaign unsubscribe_policy", t.lastBody, "\"unsubscribe_policy\":\"domain\"");

        // --- campaigns: send now vs scheduled ---
        mb.campaigns().send("cmp_1");
        Check.eq("campaign send url", "https://api.test/campaigns/cmp_1/send", t.lastUrl);
        Check.eq("campaign send-now body", "{}", t.lastBody);
        mb.campaigns().send("cmp_1", "2026-08-05T11:00:00Z");
        Check.eq("campaign send-scheduled body", "{\"scheduled_at\":\"2026-08-05T11:00:00Z\"}", t.lastBody);

        // --- campaigns: cancel / stats / ab / update-with-null-clear ---
        mb.campaigns().cancel("cmp_1");
        Check.eq("campaign cancel url", "https://api.test/campaigns/cmp_1/cancel", t.lastUrl);
        mb.campaigns().stats("cmp_1");
        Check.eq("campaign stats url", "https://api.test/campaigns/cmp_1/stats", t.lastUrl);
        mb.campaigns().ab("cmp_1");
        Check.eq("campaign ab url", "https://api.test/campaigns/cmp_1/ab", t.lastUrl);
        mb.campaigns().update("cmp_1", UpdateCampaignRequest.builder()
                .subject("New subject").clearSegment().build());
        Check.eq("campaign update body",
                "{\"subject\":\"New subject\",\"segment_id\":null}", t.lastBody);
        mb.campaigns().remove("cmp_1");
        Check.eq("campaign remove method", "DELETE", t.lastMethod);
    }

    public static void main(String[] args) {
        run();
        Check.finish();
    }
}
