package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** A single contact in a bulk import (no audienceId — it's on the call). */
public final class ContactInput implements JsonPayload {
    private final Map<String, Object> body;

    private ContactInput(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder email(String email) { m.put("email", email); return this; }
        public Builder firstName(String firstName) { m.put("first_name", firstName); return this; }
        public Builder lastName(String lastName) { m.put("last_name", lastName); return this; }
        public Builder unsubscribed(boolean unsubscribed) { m.put("unsubscribed", unsubscribed); return this; }

        @SuppressWarnings("unchecked")
        public Builder property(String key, Object value) {
            ((Map<String, Object>) m.computeIfAbsent("properties", k -> new LinkedHashMap<String, Object>()))
                    .put(key, value);
            return this;
        }

        public ContactInput build() { return new ContactInput(new LinkedHashMap<>(m)); }
    }
}
