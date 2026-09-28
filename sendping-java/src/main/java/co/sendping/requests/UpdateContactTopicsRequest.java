package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Body of {@code PATCH /contacts/:id/topics} — per-topic subscription updates:
 * {@code { topics: [{ id, subscription: "opt_in" | "opt_out" }] }}.
 */
public final class UpdateContactTopicsRequest implements JsonPayload {
    private final List<Object> topics;

    private UpdateContactTopicsRequest(List<Object> topics) { this.topics = topics; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("topics", Collections.unmodifiableList(topics));
        return m;
    }

    public static final class Builder {
        private final List<Object> topics = new ArrayList<>();

        /** Set one topic's subscription: {@code "opt_in"} or {@code "opt_out"}. */
        public Builder topic(String topicId, String subscription) {
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("id", topicId);
            t.put("subscription", subscription);
            topics.add(t);
            return this;
        }

        public Builder optIn(String topicId) { return topic(topicId, "opt_in"); }
        public Builder optOut(String topicId) { return topic(topicId, "opt_out"); }

        public UpdateContactTopicsRequest build() {
            return new UpdateContactTopicsRequest(new ArrayList<>(topics));
        }
    }
}
