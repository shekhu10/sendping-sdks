package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code POST /events/send} (DOMAIN-FIRST):
 * {@link Builder#domain(String)} is REQUIRED — only automations belonging to
 * that domain are triggered, so the same event name across several products
 * can never double-fire. Identify the contact by {@code contactId} OR
 * {@code email} (contacts auto-created by an event land in the domain's own
 * contact pool).
 */
public final class SendEventRequest implements JsonPayload {
    private final Map<String, Object> body;

    private SendEventRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** The custom event name automations trigger on. ({@code name} is an accepted alias.) */
        public Builder event(String event) { m.put("event", event); return this; }
        /** Alias for {@link #event(String)}. */
        public Builder name(String name) { m.put("name", name); return this; }
        /** REQUIRED. The sending domain this event belongs to. */
        public Builder domain(String domain) { m.put("domain", domain); return this; }
        /** Identify the contact by id. Provide {@code contactId} OR {@code email}. */
        public Builder contactId(String contactId) { m.put("contact_id", contactId); return this; }
        /** Identify the contact by email. Provide {@code contactId} OR {@code email}. */
        public Builder email(String email) { m.put("email", email); return this; }

        /** Set one event payload entry. */
        @SuppressWarnings("unchecked")
        public Builder payload(String key, Object value) {
            ((Map<String, Object>) m.computeIfAbsent("payload", k -> new LinkedHashMap<String, Object>()))
                    .put(key, value);
            return this;
        }

        public Builder payload(Map<String, Object> payload) {
            m.put("payload", new LinkedHashMap<>(payload));
            return this;
        }

        public SendEventRequest build() { return new SendEventRequest(new LinkedHashMap<>(m)); }
    }
}
