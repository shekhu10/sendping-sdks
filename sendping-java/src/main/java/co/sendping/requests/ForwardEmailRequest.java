package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Body of {@code POST /emails/receiving/:id/forward}. */
public final class ForwardEmailRequest implements JsonPayload {
    private final Map<String, Object> body;

    private ForwardEmailRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** A verified sending address to forward from (required by the backend). */
        public Builder from(String from) { m.put("from", from); return this; }
        public Builder to(String... to) { m.put("to", Arrays.asList(to)); return this; }
        public Builder subject(String subject) { m.put("subject", subject); return this; }

        public ForwardEmailRequest build() { return new ForwardEmailRequest(new LinkedHashMap<>(m)); }
    }
}
