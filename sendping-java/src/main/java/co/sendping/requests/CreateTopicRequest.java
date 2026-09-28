package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code POST /topics} (DOMAIN-FIRST): {@link Builder#domain(String)}
 * is REQUIRED — the sending domain this topic belongs to. Topic names are
 * reusable across domains.
 */
public final class CreateTopicRequest implements JsonPayload {
    private final Map<String, Object> body;

    private CreateTopicRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** REQUIRED. The sending domain this topic belongs to. */
        public Builder domain(String domain) { m.put("domain", domain); return this; }
        public Builder name(String name) { m.put("name", name); return this; }
        /**
         * REQUIRED. {@code "opt_in"} or {@code "opt_out"} — omitting it is a
         * {@code 422 validation_error}. It is IMMUTABLE afterwards, which is
         * why {@link UpdateTopicRequest} exposes no setter for it.
         */
        public Builder defaultSubscription(String defaultSubscription) { m.put("default_subscription", defaultSubscription); return this; }
        /** {@code "public"} or {@code "private"}. */
        public Builder visibility(String visibility) { m.put("visibility", visibility); return this; }
        public Builder description(String description) { m.put("description", description); return this; }

        public CreateTopicRequest build() { return new CreateTopicRequest(new LinkedHashMap<>(m)); }
    }
}
