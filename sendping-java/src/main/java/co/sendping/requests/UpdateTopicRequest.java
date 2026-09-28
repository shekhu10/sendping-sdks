package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code PATCH /topics/:id}. All fields optional; the response is the
 * FULL updated topic object.
 *
 * <p>{@code default_subscription} is <strong>immutable</strong> after creation
 * and is silently ignored by the API, so this builder deliberately does not
 * expose it.
 */
public final class UpdateTopicRequest implements JsonPayload {
    private final Map<String, Object> body;

    private UpdateTopicRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** Trimmed; must be 1–255 characters. */
        public Builder name(String name) { m.put("name", name); return this; }
        /** Max 200 characters; {@code null} clears it. */
        public Builder description(String description) { m.put("description", description); return this; }
        /** {@code "public"} or {@code "private"}. */
        public Builder visibility(String visibility) { m.put("visibility", visibility); return this; }

        public UpdateTopicRequest build() { return new UpdateTopicRequest(new LinkedHashMap<>(m)); }
    }
}
