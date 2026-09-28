package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Body of {@code POST /templates/:id/duplicate}. */
public final class DuplicateTemplateRequest implements JsonPayload {
    private final Map<String, Object> body;

    private DuplicateTemplateRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder name(String name) { m.put("name", name); return this; }
        public Builder alias(String alias) { m.put("alias", alias); return this; }

        public DuplicateTemplateRequest build() { return new DuplicateTemplateRequest(new LinkedHashMap<>(m)); }
    }
}
