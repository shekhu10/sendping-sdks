package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Body of {@code PATCH /templates/:id}. */
public final class UpdateTemplateRequest implements JsonPayload {
    private final Map<String, Object> body;

    private UpdateTemplateRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder name(String name) { m.put("name", name); return this; }
        public Builder alias(String alias) { m.put("alias", alias); return this; }
        public Builder subject(String subject) { m.put("subject", subject); return this; }
        public Builder from(String from) { m.put("from", from); return this; }
        public Builder replyTo(String... replyTo) { m.put("reply_to", Arrays.asList(replyTo)); return this; }
        public Builder html(String html) { m.put("html", html); return this; }
        public Builder text(String text) { m.put("text", text); return this; }

        @SuppressWarnings("unchecked")
        public Builder variable(TemplateVariable variable) {
            ((List<Object>) m.computeIfAbsent("variables", k -> new ArrayList<>())).add(variable);
            return this;
        }

        public Builder variables(List<TemplateVariable> variables) {
            m.put("variables", new ArrayList<>(variables));
            return this;
        }

        public UpdateTemplateRequest build() { return new UpdateTemplateRequest(new LinkedHashMap<>(m)); }
    }
}
