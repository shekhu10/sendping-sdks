package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A/B-test config for a campaign. When {@code enabled}, supply at least one
 * variant-B field ({@code subjectB}, {@code htmlB}, or {@code textB}).
 */
public final class CampaignAbTest implements JsonPayload {
    private final Map<String, Object> body;

    private CampaignAbTest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder enabled(boolean enabled) { m.put("enabled", enabled); return this; }
        public Builder subjectB(String subjectB) { m.put("subject_b", subjectB); return this; }
        public Builder htmlB(String htmlB) { m.put("html_b", htmlB); return this; }
        public Builder textB(String textB) { m.put("text_b", textB); return this; }
        /** Percentage (1-100) of the audience used to pick the winner. Defaults to 20. */
        public Builder testPct(int testPct) { m.put("test_pct", testPct); return this; }
        /** Winner metric: {@code open} (default), {@code click}, or {@code reply}. */
        public Builder metric(String metric) { m.put("metric", metric); return this; }
        /** Hours (1-168) to run the test before evaluating and sending the winner. */
        public Builder evalHours(int evalHours) { m.put("eval_hours", evalHours); return this; }

        public CampaignAbTest build() { return new CampaignAbTest(new LinkedHashMap<>(m)); }
    }
}
