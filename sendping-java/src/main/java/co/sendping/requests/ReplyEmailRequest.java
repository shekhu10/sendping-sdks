package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code POST /emails/receiving/:id/reply} — replies to a received
 * email's sender, threaded into the same conversation (subject defaults to
 * {@code Re: …}).
 */
public final class ReplyEmailRequest implements JsonPayload {
    private final Map<String, Object> body;

    private ReplyEmailRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder from(String from) { m.put("from", from); return this; }
        public Builder html(String html) { m.put("html", html); return this; }
        public Builder text(String text) { m.put("text", text); return this; }
        public Builder subject(String subject) { m.put("subject", subject); return this; }

        public ReplyEmailRequest build() { return new ReplyEmailRequest(new LinkedHashMap<>(m)); }
    }
}
