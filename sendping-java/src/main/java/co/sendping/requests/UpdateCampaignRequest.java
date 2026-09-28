package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Body of {@code PATCH /campaigns/:id}. */
public final class UpdateCampaignRequest implements JsonPayload {
    private final Map<String, Object> body;

    private UpdateCampaignRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder name(String name) { m.put("name", name); return this; }
        public Builder from(String from) { m.put("from", from); return this; }
        public Builder subject(String subject) { m.put("subject", subject); return this; }
        public Builder html(String html) { m.put("html", html); return this; }
        public Builder text(String text) { m.put("text", text); return this; }
        public Builder replyTo(String... replyTo) { m.put("reply_to", Arrays.asList(replyTo)); return this; }
        public Builder previewText(String previewText) { m.put("preview_text", previewText); return this; }
        /** Re-point at another of your domains' contact pools (draft campaigns only). */
        public Builder domain(String domain) { m.put("domain", domain); return this; }
        /** Re-target a segment. */
        public Builder segmentId(String segmentId) { m.put("segment_id", segmentId); return this; }
        /** Clear the segment target (sends {@code segment_id: null}). */
        public Builder clearSegment() { m.put("segment_id", null); return this; }
        /** Re-target a topic gate. */
        public Builder topicId(String topicId) { m.put("topic_id", topicId); return this; }
        /** Clear the topic gate (sends {@code topic_id: null}). */
        public Builder clearTopic() { m.put("topic_id", null); return this; }
        public Builder recurrence(String recurrence) { m.put("recurrence", recurrence); return this; }
        public Builder recurrenceEvery(int recurrenceEvery) { m.put("recurrence_every", recurrenceEvery); return this; }
        public Builder abTest(CampaignAbTest abTest) { m.put("ab_test", abTest); return this; }

        /** Append a follow-up to the replacement set (replaces the pending follow-ups; max 5). */
        @SuppressWarnings("unchecked")
        public Builder followup(CampaignFollowup followup) {
            ((List<Object>) m.computeIfAbsent("followups", k -> new ArrayList<>())).add(followup);
            return this;
        }

        /** Replace the pending follow-ups wholesale (an empty list clears them). */
        public Builder followups(List<CampaignFollowup> followups) {
            m.put("followups", new ArrayList<>(followups));
            return this;
        }

        /** Enable ({@code true}) or clear ({@code false}) the generated mailing-list To address. */
        public Builder listTo(boolean listTo) { m.put("list_to", listTo); return this; }
        /** {@code account} (default), {@code domain}, or {@code ignore}. */
        public Builder unsubscribePolicy(String unsubscribePolicy) { m.put("unsubscribe_policy", unsubscribePolicy); return this; }
        /**
         * IANA timezone the schedule + daily batching are evaluated in (e.g.
         * {@code "America/New_York"}).
         */
        public Builder scheduleTimezone(String scheduleTimezone) { m.put("schedule_timezone", scheduleTimezone); return this; }
        /** Clear the schedule timezone (sends {@code schedule_timezone: null}). */
        public Builder clearScheduleTimezone() { m.put("schedule_timezone", null); return this; }
        /** Max recipients fanned out per batch-day (1-100000). */
        public Builder dailyBatchSize(int dailyBatchSize) { m.put("daily_batch_size", dailyBatchSize); return this; }
        /** Clear daily batching (sends {@code daily_batch_size: null}). */
        public Builder clearDailyBatchSize() { m.put("daily_batch_size", null); return this; }

        public UpdateCampaignRequest build() { return new UpdateCampaignRequest(new LinkedHashMap<>(m)); }
    }
}
