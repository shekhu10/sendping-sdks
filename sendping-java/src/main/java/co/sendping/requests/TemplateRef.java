package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Nested template reference on a send: select by {@code id} OR {@code alias}. */
public final class TemplateRef implements JsonPayload {
    private final Map<String, Object> body;

    private TemplateRef(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder id(String id) { m.put("id", id); return this; }
        public Builder alias(String alias) { m.put("alias", alias); return this; }

        @SuppressWarnings("unchecked")
        public Builder variable(String key, Object value) {
            ((Map<String, Object>) m.computeIfAbsent("variables", k -> new LinkedHashMap<String, Object>()))
                    .put(key, value);
            return this;
        }

        public Builder variables(Map<String, Object> variables) {
            m.put("variables", new LinkedHashMap<>(variables));
            return this;
        }

        public TemplateRef build() { return new TemplateRef(new LinkedHashMap<>(m)); }
    }
}
