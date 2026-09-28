package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Body of {@code POST /contact-properties}. Types: {@code string} | {@code number}. */
public final class CreateContactPropertyRequest implements JsonPayload {
    private final Map<String, Object> body;

    private CreateContactPropertyRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** Canonical merge-tag key. ({@code name} is accepted as an alias.) */
        public Builder key(String key) { m.put("key", key); return this; }
        /** Alias for {@code key}. */
        public Builder name(String name) { m.put("name", name); return this; }
        /** {@code "string"} or {@code "number"}. */
        public Builder type(String type) { m.put("type", type); return this; }
        public Builder fallbackValue(Object fallbackValue) { m.put("fallback_value", fallbackValue); return this; }

        public CreateContactPropertyRequest build() { return new CreateContactPropertyRequest(new LinkedHashMap<>(m)); }
    }
}
