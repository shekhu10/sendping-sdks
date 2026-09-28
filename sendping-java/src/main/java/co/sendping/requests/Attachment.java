package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * An email attachment. Provide {@code content} (base64) OR {@code path}
 * (a hosted URL fetched at send time).
 */
public final class Attachment implements JsonPayload {
    private final Map<String, Object> body;

    private Attachment(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder filename(String filename) { m.put("filename", filename); return this; }
        /** Base64-encoded file content. Provide {@code content} OR {@code path}. */
        public Builder content(String base64Content) { m.put("content", base64Content); return this; }
        /** A hosted URL to fetch the file from. Provide {@code content} OR {@code path}. */
        public Builder path(String url) { m.put("path", url); return this; }
        public Builder contentType(String contentType) { m.put("content_type", contentType); return this; }
        /** Content-ID for inline/related parts (renders as {@code cid:} references). */
        public Builder contentId(String contentId) { m.put("content_id", contentId); return this; }

        public Attachment build() { return new Attachment(new LinkedHashMap<>(m)); }
    }
}
