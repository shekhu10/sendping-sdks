package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A single email in a batch send ({@code POST /emails/batch}). Identical to
 * {@link SendEmailRequest} minus {@code attachments} and {@code scheduled_at}
 * — the batch endpoint rejects both per item; send those individually via
 * {@code POST /emails}.
 */
public final class BatchEmailRequest implements JsonPayload {
    private final Map<String, Object> body;

    private BatchEmailRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder from(String from) { m.put("from", from); return this; }
        public Builder to(String... to) { m.put("to", Arrays.asList(to)); return this; }
        public Builder to(List<String> to) { m.put("to", new ArrayList<>(to)); return this; }
        public Builder subject(String subject) { m.put("subject", subject); return this; }
        public Builder cc(String... cc) { m.put("cc", Arrays.asList(cc)); return this; }
        public Builder bcc(String... bcc) { m.put("bcc", Arrays.asList(bcc)); return this; }
        public Builder replyTo(String... replyTo) { m.put("reply_to", Arrays.asList(replyTo)); return this; }
        /**
         * HTML body. Ordinary links become tracked redirects at send time; so do
         * URLs in the {@code text} body. Your stored content is never modified.
         */
        public Builder html(String html) { m.put("html", html); return this; }
        public Builder text(String text) { m.put("text", text); return this; }
        /** Inbox preview text (preheader), max 150 characters. */
        public Builder previewText(String previewText) { m.put("preview_text", previewText); return this; }

        /** Set a custom message header. */
        @SuppressWarnings("unchecked")
        public Builder header(String name, String value) {
            ((Map<String, Object>) m.computeIfAbsent("headers", k -> new LinkedHashMap<String, Object>()))
                    .put(name, value);
            return this;
        }

        /** Drop recipients unsubscribed from this topic (topic gating). */
        public Builder topicId(String topicId) { m.put("topic_id", topicId); return this; }
        /** Send using a saved template; its subject/html/text fill any omitted field. */
        public Builder templateId(String templateId) { m.put("template_id", templateId); return this; }
        /** Nested template reference — provide {@code template} OR {@code html}/{@code text}, not both. */
        public Builder template(TemplateRef template) { m.put("template", template); return this; }

        /** Set one {{ placeholder }} variable value. */
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

        public BatchEmailRequest build() { return new BatchEmailRequest(new LinkedHashMap<>(m)); }
    }
}
