package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code PATCH /events/:id} — updates a custom-event definition's
 * payload schema.
 *
 * <p>The event <strong>name is immutable</strong> (automations reference it):
 * sending a {@code name} is a {@code 422 validation_error}, so this builder
 * deliberately exposes no way to set one. Create a new event instead.
 */
public final class UpdateEventRequest implements JsonPayload {
    private final Map<String, Object> body;

    private UpdateEventRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** Add one schema field; {@code type} is 'string' | 'number' | 'boolean' | 'date'. */
        @SuppressWarnings("unchecked")
        public Builder schema(String key, String type) {
            Object existing = m.get("schema");
            Map<String, Object> schema = existing instanceof Map
                    ? (Map<String, Object>) existing
                    : new LinkedHashMap<String, Object>();
            schema.put(key, type);
            m.put("schema", schema);
            return this;
        }

        /** Replace the whole schema. */
        public Builder schema(Map<String, String> schema) {
            m.put("schema", new LinkedHashMap<String, Object>(schema));
            return this;
        }

        /** Clear the schema entirely (sends {@code "schema": null}). */
        public Builder clearSchema() { m.put("schema", null); return this; }

        public UpdateEventRequest build() { return new UpdateEventRequest(new LinkedHashMap<>(m)); }
    }
}
