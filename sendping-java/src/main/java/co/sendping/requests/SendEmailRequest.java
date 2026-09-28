package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Body of {@code POST /emails} — a single transactional send.
 *
 * <pre>{@code
 * SendEmailRequest req = SendEmailRequest.builder()
 *     .from("Acme <hi@yourdomain.com>")
 *     .to("a@b.com")
 *     .subject("hello")
 *     .html("<p>hi</p>")
 *     .build();
 * sendping.emails().send(req);
 * }</pre>
 */
public final class SendEmailRequest implements JsonPayload {
    private final Map<String, Object> body;

    private SendEmailRequest(Map<String, Object> body) { this.body = body; }

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
         * HTML body. Write ordinary links — every destination becomes a tracked
         * redirect at send time (when the sending domain has click tracking on):
         * anchor targets, markdown-style links, and bare URLs or domains in the
         * body text. Link text is preserved and opt-out links are never wrapped.
         * The content you send is stored and returned UNCHANGED — only the
         * delivered copy carries the tracking URL.
         */
        public Builder html(String html) { m.put("html", html); return this; }
        /**
         * Plain-text body (the text/plain alternative). URLs in it are rewritten
         * to tracked redirects at send time under the same rule as html, so a
         * click counts whichever alternative the recipient's client renders.
         */
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

        @SuppressWarnings("unchecked")
        public Builder attachment(Attachment attachment) {
            ((List<Object>) m.computeIfAbsent("attachments", k -> new ArrayList<>())).add(attachment);
            return this;
        }

        public Builder attachments(List<Attachment> attachments) {
            m.put("attachments", new ArrayList<>(attachments));
            return this;
        }

        /** ISO 8601 timestamp to schedule the send. */
        public Builder scheduledAt(String scheduledAt) { m.put("scheduled_at", scheduledAt); return this; }
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

        public SendEmailRequest build() { return new SendEmailRequest(new LinkedHashMap<>(m)); }
    }
}
