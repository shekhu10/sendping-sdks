package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Body of {@code POST /campaigns} (DOMAIN-FIRST): {@link Builder#domain(String)}
 * is REQUIRED and names the sending domain whose contact pool the campaign
 * targets (it replaces the retired {@code audience_id}; the {@code from}
 * address may be a different verified domain).
 */
public final class CreateCampaignRequest implements JsonPayload {
    private final Map<String, Object> body;

    private CreateCampaignRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** REQUIRED. The sending domain whose contact pool this campaign targets. */
        public Builder domain(String domain) { m.put("domain", domain); return this; }
        public Builder from(String from) { m.put("from", from); return this; }
        public Builder subject(String subject) { m.put("subject", subject); return this; }
        public Builder html(String html) { m.put("html", html); return this; }
        public Builder text(String text) { m.put("text", text); return this; }
        public Builder replyTo(String... replyTo) { m.put("reply_to", Arrays.asList(replyTo)); return this; }
        public Builder previewText(String previewText) { m.put("preview_text", previewText); return this; }
        public Builder name(String name) { m.put("name", name); return this; }
        /** Target a segment (subset of the pool) instead of everyone. */
        public Builder segmentId(String segmentId) { m.put("segment_id", segmentId); return this; }
        /** Gate recipients by a topic subscription. */
        public Builder topicId(String topicId) { m.put("topic_id", topicId); return this; }
        /** Make this recurring: {@code daily}, {@code weekly}, or {@code monthly}. */
        public Builder recurrence(String recurrence) { m.put("recurrence", recurrence); return this; }
        /** Number of periods between recurring sends (1-365). Defaults to 1. */
        public Builder recurrenceEvery(int recurrenceEvery) { m.put("recurrence_every", recurrenceEvery); return this; }
        public Builder abTest(CampaignAbTest abTest) { m.put("ab_test", abTest); return this; }

        @SuppressWarnings("unchecked")
        public Builder followup(CampaignFollowup followup) {
            ((List<Object>) m.computeIfAbsent("followups", k -> new ArrayList<>())).add(followup);
            return this;
        }

        public Builder followups(List<CampaignFollowup> followups) {
            m.put("followups", new ArrayList<>(followups));
            return this;
        }

        /** Show a generated mailing-list address as the visible To. Delivery stays individual. */
        public Builder listTo(boolean listTo) { m.put("list_to", listTo); return this; }
        /** {@code account} (default), {@code domain}, or {@code ignore}. */
        public Builder unsubscribePolicy(String unsubscribePolicy) { m.put("unsubscribe_policy", unsubscribePolicy); return this; }
        /** Send immediately on create (or schedule it when {@code scheduledAt} is given). */
        public Builder send(boolean send) { m.put("send", send); return this; }
        /** ISO 8601 (or natural-language) schedule used when {@code send} is true. */
        public Builder scheduledAt(String scheduledAt) { m.put("scheduled_at", scheduledAt); return this; }
        /**
         * IANA timezone the schedule + daily batching are evaluated in (e.g.
         * {@code "America/New_York"}). Defaults to the account timezone, then UTC.
         */
        public Builder scheduleTimezone(String scheduleTimezone) { m.put("schedule_timezone", scheduleTimezone); return this; }
        /** Max recipients fanned out per batch-day (1-100000). Omitted ⇒ everyone at once. */
        public Builder dailyBatchSize(int dailyBatchSize) { m.put("daily_batch_size", dailyBatchSize); return this; }

        public CreateCampaignRequest build() { return new CreateCampaignRequest(new LinkedHashMap<>(m)); }
    }
}
