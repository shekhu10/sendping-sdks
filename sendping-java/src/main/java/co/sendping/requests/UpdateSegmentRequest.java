package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Body of {@code PATCH /segments/:id}. */
public final class UpdateSegmentRequest implements JsonPayload {
    private final Map<String, Object> body;

    private UpdateSegmentRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder name(String name) { m.put("name", name); return this; }
        public Builder filter(SegmentFilter filter) { m.put("filter", filter); return this; }

        public UpdateSegmentRequest build() { return new UpdateSegmentRequest(new LinkedHashMap<>(m)); }
    }
}
