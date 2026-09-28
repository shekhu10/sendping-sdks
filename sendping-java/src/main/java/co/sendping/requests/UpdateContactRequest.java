package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Update a contact. {@link Builder#id(String)} is a contact id OR email; on
 * the flat API pass {@link Builder#domain(String)} when {@code id} is an EMAIL
 * (disambiguates across domain pools). Pass {@link Builder#audienceId(String)}
 * to use the nested {@code PATCH /audiences/:id/contacts/:id} API instead.
 */
public final class UpdateContactRequest implements JsonPayload {
    private final Map<String, Object> body;
    private final String id;
    private final String domain;
    private final String audienceId;

    private UpdateContactRequest(Map<String, Object> body, String id, String domain, String audienceId) {
        this.body = body;
        this.id = id;
        this.domain = domain;
        this.audienceId = audienceId;
    }

    public static Builder builder() { return new Builder(); }

    /** Field map (excludes routing params — the resource adds {@code domain} on the flat route). */
    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public String getId() { return id; }
    public String getDomain() { return domain; }
    public String getAudienceId() { return audienceId; }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();
        private String id;
        private String domain;
        private String audienceId;

        /** Contact id OR email. */
        public Builder id(String id) { this.id = id; return this; }
        /** Disambiguates an EMAIL id across domain pools (a contact id is exact and needs no domain). */
        public Builder domain(String domain) { this.domain = domain; return this; }
        /** Audience the contact belongs to. OMIT for the flat {@code /contacts/:id} API. */
        public Builder audienceId(String audienceId) { this.audienceId = audienceId; return this; }
        public Builder firstName(String firstName) { m.put("first_name", firstName); return this; }
        public Builder lastName(String lastName) { m.put("last_name", lastName); return this; }
        public Builder unsubscribed(boolean unsubscribed) { m.put("unsubscribed", unsubscribed); return this; }

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

        public UpdateContactRequest build() {
            if (id == null) throw new IllegalStateException("UpdateContactRequest: id is required");
            return new UpdateContactRequest(new LinkedHashMap<>(m), id, domain, audienceId);
        }
    }
}
