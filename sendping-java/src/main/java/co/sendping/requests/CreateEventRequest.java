package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code POST /events} — a custom-event definition (name + optional
 * flat payload schema). The name cannot start with the reserved
 * {@code sendping:} prefix.
 */
public final class CreateEventRequest implements JsonPayload {
    private final Map<String, Object> body;

    private CreateEventRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder name(String name) { m.put("name", name); return this; }

        /** Add one schema field; {@code type} is 'string' | 'number' | 'boolean' | 'date'. */
        @SuppressWarnings("unchecked")
        public Builder schema(String key, String type) {
            ((Map<String, Object>) m.computeIfAbsent("schema", k -> new LinkedHashMap<String, Object>()))
                    .put(key, type);
            return this;
        }

        public Builder schema(Map<String, String> schema) {
            m.put("schema", new LinkedHashMap<>(schema));
            return this;
        }

        public CreateEventRequest build() { return new CreateEventRequest(new LinkedHashMap<>(m)); }
    }
}
