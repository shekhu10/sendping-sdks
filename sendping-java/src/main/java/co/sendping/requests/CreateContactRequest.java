package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Create a contact (DOMAIN-FIRST). Pass {@link Builder#domain(String)} to
 * create the contact in that sending domain's contact pool via the flat
 * {@code POST /contacts} API (where {@code domain} is REQUIRED — the same
 * address on two domains is two records with separate consent), or
 * {@link Builder#audienceId(String)} to target a specific audience via the
 * nested {@code POST /audiences/:id/contacts} API instead.
 */
public final class CreateContactRequest implements JsonPayload {
    private final Map<String, Object> body;
    private final String domain;
    private final String audienceId;

    private CreateContactRequest(Map<String, Object> body, String domain, String audienceId) {
        this.body = body;
        this.domain = domain;
        this.audienceId = audienceId;
    }

    public static Builder builder() { return new Builder(); }

    /** Field map (excludes routing params — the resource adds {@code domain} on the flat route). */
    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public String getDomain() { return domain; }
    public String getAudienceId() { return audienceId; }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();
        private String domain;
        private String audienceId;

        /** The sending domain whose contact pool the contact lands in (REQUIRED unless {@code audienceId} is set). */
        public Builder domain(String domain) { this.domain = domain; return this; }
        /** Target a specific audience via the nested API instead of {@code domain}. */
        public Builder audienceId(String audienceId) { this.audienceId = audienceId; return this; }
        public Builder email(String email) { m.put("email", email); return this; }
        public Builder firstName(String firstName) { m.put("first_name", firstName); return this; }
        public Builder lastName(String lastName) { m.put("last_name", lastName); return this; }
        public Builder unsubscribed(boolean unsubscribed) { m.put("unsubscribed", unsubscribed); return this; }

        /** Set one custom contact property value (string or number). */
        @SuppressWarnings("unchecked")
        public Builder property(String key, Object value) {
            ((Map<String, Object>) m.computeIfAbsent("properties", k -> new LinkedHashMap<String, Object>()))
                    .put(key, value);
            return this;
        }

        public Builder properties(Map<String, Object> properties) {
            m.put("properties", new LinkedHashMap<>(properties));
            return this;
        }

        public CreateContactRequest build() {
            return new CreateContactRequest(new LinkedHashMap<>(m), domain, audienceId);
        }
    }
}
