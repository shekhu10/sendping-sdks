package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * An engagement follow-up (max 5 per campaign): sent {@code delay} after the
 * campaign finishes to recipients matching {@code condition}, threaded as a
 * reply to the original email.
 */
public final class CampaignFollowup implements JsonPayload {
    private final Map<String, Object> body;

    private CampaignFollowup(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** {@code opened}, {@code clicked}, {@code not_opened}, {@code not_clicked}, {@code replied}, or {@code not_replied}. */
        public Builder condition(String condition) { m.put("condition", condition); return this; }
        /** Natural-language duration, e.g. {@code "5 hours"} or {@code "4 days"} (max 30 days). */
        public Builder delay(String delay) { m.put("delay", delay); return this; }
        /** Defaults to {@code Re: <campaign subject>} (keeps the thread). */
        public Builder subject(String subject) { m.put("subject", subject); return this; }
        public Builder html(String html) { m.put("html", html); return this; }

        public CampaignFollowup build() { return new CampaignFollowup(new LinkedHashMap<>(m)); }
    }
}
