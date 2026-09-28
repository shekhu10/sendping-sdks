package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code POST /segments} (DOMAIN-FIRST): {@link Builder#domain(String)}
 * is REQUIRED — the sending domain this segment belongs to. Segment names are
 * unique WITHIN a domain but freely reusable across domains; every domain also
 * carries an auto-created "General" (all contacts) segment.
 */
public final class CreateSegmentRequest implements JsonPayload {
    private final Map<String, Object> body;

    private CreateSegmentRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** REQUIRED. The sending domain this segment belongs to. */
        public Builder domain(String domain) { m.put("domain", domain); return this; }
        public Builder name(String name) { m.put("name", name); return this; }
        public Builder filter(SegmentFilter filter) { m.put("filter", filter); return this; }

        public CreateSegmentRequest build() { return new CreateSegmentRequest(new LinkedHashMap<>(m)); }
    }
}
